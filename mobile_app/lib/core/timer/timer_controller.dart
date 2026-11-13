import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../date/planner_dates.dart';
import '../database/local_database.dart';
import '../models/planner_models.dart';

const focusDurationMs = 25 * 60 * 1000;
const breakDurationMs = 5 * 60 * 1000;

class TimerState {
  const TimerState({this.active, this.elapsedMs = 0});
  final JsonMap? active;
  final int elapsedMs;
  bool get isRunning => active != null && active!['isRunning'] == true;
  String get title => active?['taskTitle']?.toString() ?? '';
  String get mode => active?['mode']?.toString() ?? 'focus';
  String get displayTime {
    final remaining = max(
      0,
      (jsonInt(active?['targetDurationMs'], focusDurationMs) - elapsedMs) ~/
          1000,
    );
    final minutes = (remaining ~/ 60).toString().padLeft(2, '0');
    final seconds = (remaining % 60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }
}

class TimerController extends Notifier<TimerState> {
  Timer? _ticker;
  bool _transitioning = false;
  LocalDatabase get _database => ref.read(localDatabaseProvider);

  @override
  TimerState build() {
    ref.onDispose(() => _ticker?.cancel());
    return const TimerState();
  }

  Future<void> initialize() async {
    final saved = await _database.getMeta('activeTimer');
    if (saved == null) return;
    try {
      final active = jsonMap(jsonDecode(saved));
      final elapsed = active['isRunning'] == true
          ? jsonInt(active['accumulatedMs']) +
                DateTime.now().millisecondsSinceEpoch -
                jsonInt(active['startedAt'])
          : jsonInt(active['accumulatedMs']);
      state = TimerState(active: active, elapsedMs: max(0, elapsed));
      _ensureTicker();
    } catch (_) {
      await _database.deleteMeta('activeTimer');
    }
  }

  Future<bool> start(JsonMap task) async {
    if (state.active != null) return false;
    final estimated = max(1, jsonInt(task['estimatedMinutes'], 25));
    final totalSessions = max(1, (estimated / 25).ceil());
    final now = DateTime.now().millisecondsSinceEpoch;
    final active = <String, dynamic>{
      'taskId': task['id']?.toString() ?? '',
      'taskTitle': task['title']?.toString() ?? 'Focus session',
      'startedAt': now,
      'accumulatedMs': 0,
      'isRunning': true,
      'mode': 'focus',
      'targetDurationMs': focusDurationMs,
      'completedPomodoros': 0,
      'totalSessionsPlanned': totalSessions,
    };
    state = TimerState(active: active, elapsedMs: 0);
    await _persist(active);
    _ensureTicker();
    return true;
  }

  Future<void> pause() async {
    final active = state.active;
    if (active == null || active['isRunning'] != true) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    final elapsed =
        jsonInt(active['accumulatedMs']) + now - jsonInt(active['startedAt']);
    final next = {
      ...active,
      'isRunning': false,
      'accumulatedMs': elapsed,
      'startedAt': now,
    };
    state = TimerState(active: next, elapsedMs: elapsed);
    await _persist(next);
  }

  Future<void> resume() async {
    final active = state.active;
    if (active == null || active['isRunning'] == true) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    final next = {...active, 'isRunning': true, 'startedAt': now};
    state = TimerState(active: next, elapsedMs: jsonInt(next['accumulatedMs']));
    await _persist(next);
    _ensureTicker();
  }

  Future<void> stop() async {
    final active = state.active;
    if (active == null) return;
    final elapsed = state.elapsedMs;
    if (active['mode'] != 'break' &&
        elapsed > 0 &&
        (active['taskId']?.toString().isNotEmpty ?? false)) {
      final now = DateTime.now().millisecondsSinceEpoch;
      await _database.putLocalRecord('timeLogs', {
        'id': _newId(),
        'taskId': active['taskId'],
        'date': traditionalDayKey(),
        'minutes': max(1, (elapsed / 60000).round()),
        'source': 'timer',
        'createdAt': now,
        'updatedAt': now,
        'deleted': false,
        'isSample': false,
      });
    }
    state = const TimerState();
    await _database.deleteMeta('activeTimer');
    _ticker?.cancel();
  }

  void _ensureTicker() {
    _ticker ??= Timer.periodic(const Duration(seconds: 1), (_) => _tick());
  }

  Future<void> _tick() async {
    final active = state.active;
    if (active == null || active['isRunning'] != true || _transitioning) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    final elapsed =
        jsonInt(active['accumulatedMs']) + now - jsonInt(active['startedAt']);
    final target = jsonInt(active['targetDurationMs'], focusDurationMs);
    if (elapsed < target) {
      state = TimerState(active: active, elapsedMs: max(0, elapsed));
      return;
    }

    _transitioning = true;
    try {
      if (active['mode'] == 'break') {
        final next = {
          ...active,
          'mode': 'focus',
          'isRunning': false,
          'startedAt': now,
          'accumulatedMs': 0,
          'targetDurationMs': focusDurationMs,
        };
        state = TimerState(active: next, elapsedMs: 0);
        await _persist(next);
      } else {
        final nextCompleted = jsonInt(active['completedPomodoros']) + 1;
        final logTime = DateTime.now().millisecondsSinceEpoch;
        if ((active['taskId']?.toString().isNotEmpty ?? false)) {
          await _database.putLocalRecord('timeLogs', {
            'id': _newId(),
            'taskId': active['taskId'],
            'date': traditionalDayKey(),
            'minutes': 25,
            'source': 'timer',
            'createdAt': logTime,
            'updatedAt': logTime,
            'deleted': false,
            'isSample': false,
          });
        }
        final next = {
          ...active,
          'mode': 'break',
          'isRunning': true,
          'startedAt': now,
          'accumulatedMs': 0,
          'targetDurationMs': breakDurationMs,
          'completedPomodoros': nextCompleted,
        };
        state = TimerState(active: next, elapsedMs: 0);
        await _persist(next);
      }
      unawaited(ref.read(syncControllerProvider.notifier).refreshPending());
    } finally {
      _transitioning = false;
    }
  }

  Future<void> _persist(JsonMap active) =>
      _database.setMeta('activeTimer', jsonEncode(active));

  String _newId() =>
      '${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}-${Random.secure().nextInt(1 << 32).toRadixString(36)}';
}
