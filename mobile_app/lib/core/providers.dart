import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth/auth_repository.dart';
import 'database/local_database.dart';
import 'models/planner_models.dart';
import 'network/api_client.dart';
import 'storage/token_store.dart';
import 'sync/sync_service.dart';

final localDatabaseProvider = Provider<LocalDatabase>(
  (ref) =>
      throw UnimplementedError('LocalDatabase must be provided at bootstrap.'),
);
final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore());
final apiClientProvider = Provider<ApiClient>((ref) {
  final api = ApiClient(
    tokenStore: ref.watch(tokenStoreProvider),
    baseUrl: const String.fromEnvironment('API_BASE_URL'),
  );
  api.onUnauthorized = () => ref.read(sessionProvider.notifier).expireSession();
  return api;
});
final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(
    ref.watch(apiClientProvider),
    ref.watch(tokenStoreProvider),
  ),
);
final syncServiceProvider = Provider<SyncService>(
  (ref) => SyncService(
    ref.watch(apiClientProvider),
    ref.watch(localDatabaseProvider),
  ),
);

enum SessionStatus { loading, signedOut, signedIn }

class SessionState {
  const SessionState({
    required this.status,
    this.offline = false,
    this.apiUrl = '',
    this.error,
  });
  final SessionStatus status;
  final bool offline;
  final String apiUrl;
  final String? error;
}

final sessionProvider = NotifierProvider<SessionController, SessionState>(
  SessionController.new,
);

class SessionController extends Notifier<SessionState> {
  late final LocalDatabase _database;
  late final ApiClient _api;
  late final AuthRepository _auth;

  @override
  SessionState build() {
    _database = ref.watch(localDatabaseProvider);
    _api = ref.watch(apiClientProvider);
    _auth = ref.watch(authRepositoryProvider);
    return const SessionState(status: SessionStatus.loading);
  }

  Future<void> initialize() async {
    final savedUrl = await _database.getMeta('apiBaseUrl');
    final configuredUrl = (savedUrl?.isNotEmpty == true)
        ? savedUrl!
        : const String.fromEnvironment('API_BASE_URL');
    if (configuredUrl.isNotEmpty) {
      try {
        _api.configureBaseUrl(configuredUrl);
      } on FormatException catch (error) {
        state = SessionState(
          status: SessionStatus.signedOut,
          apiUrl: configuredUrl,
          error: error.message,
        );
        return;
      }
    }
    final check = await _auth.checkSession();
    state = SessionState(
      status: check.authenticated
          ? SessionStatus.signedIn
          : SessionStatus.signedOut,
      offline: check.offline,
      apiUrl: configuredUrl,
    );
    if (check.authenticated && !check.offline)
      unawaited(ref.read(syncControllerProvider.notifier).sync());
  }

  Future<void> login({required String apiUrl, required String password}) async {
    state = SessionState(status: SessionStatus.loading, apiUrl: apiUrl.trim());
    try {
      _api.configureBaseUrl(apiUrl);
      await _database.setMeta('apiBaseUrl', _api.dio.options.baseUrl);
      await _auth.login(password);
      state = SessionState(
        status: SessionStatus.signedIn,
        apiUrl: _api.dio.options.baseUrl,
      );
      unawaited(ref.read(syncControllerProvider.notifier).sync());
    } catch (error) {
      final message = error is ApiFailure ? error.message : error.toString();
      state = SessionState(
        status: SessionStatus.signedOut,
        apiUrl: apiUrl.trim(),
        error: message,
      );
    }
  }

  Future<void> logout() async {
    final url = state.apiUrl;
    await _auth.logout();
    state = SessionState(status: SessionStatus.signedOut, apiUrl: url);
  }

  Future<void> expireSession() async {
    state = SessionState(
      status: SessionStatus.signedOut,
      apiUrl: state.apiUrl,
      error: 'Your session expired. Sign in again to sync with the planner.',
    );
  }
}

class SyncState {
  const SyncState({
    this.pending = 0,
    this.syncing = false,
    this.offline = false,
    this.lastSyncedAt,
    this.error,
  });
  final int pending;
  final bool syncing;
  final bool offline;
  final DateTime? lastSyncedAt;
  final String? error;
}

final syncControllerProvider = NotifierProvider<SyncController, SyncState>(
  SyncController.new,
);

class SyncController extends Notifier<SyncState> {
  Timer? _retryTimer;
  int _retryAttempt = 0;

  @override
  SyncState build() {
    ref.onDispose(() => _retryTimer?.cancel());
    unawaited(refreshPending());
    return const SyncState();
  }

  Future<void> refreshPending() async {
    final pending = await ref.read(localDatabaseProvider).countDirty();
    if (!state.syncing)
      state = SyncState(
        pending: pending,
        offline: state.offline,
        lastSyncedAt: state.lastSyncedAt,
        error: state.error,
      );
  }

  Future<void> sync() async {
    if (state.syncing) return;
    state = SyncState(
      pending: await ref.read(localDatabaseProvider).countDirty(),
      syncing: true,
      lastSyncedAt: state.lastSyncedAt,
    );
    try {
      final result = await ref.read(syncServiceProvider).sync();
      _retryTimer?.cancel();
      _retryTimer = null;
      _retryAttempt = 0;
      state = SyncState(
        pending: result.pendingCount,
        lastSyncedAt: result.syncedAt,
      );
      ref.invalidate(taskListProvider);
    } catch (error) {
      final message = error is ApiFailure ? error.message : error.toString();
      state = SyncState(
        pending: await ref.read(localDatabaseProvider).countDirty(),
        offline: true,
        lastSyncedAt: state.lastSyncedAt,
        error: message,
      );
      _scheduleRetry();
    }
  }

  void _scheduleRetry() {
    if (ref.read(sessionProvider).status != SessionStatus.signedIn ||
        _retryTimer?.isActive == true) {
      return;
    }
    const delays = [15, 30, 60, 120, 240, 300];
    final seconds = delays[_retryAttempt.clamp(0, delays.length - 1).toInt()];
    _retryAttempt++;
    _retryTimer = Timer(Duration(seconds: seconds), () {
      if (ref.read(sessionProvider).status == SessionStatus.signedIn) {
        unawaited(sync());
      }
    });
  }
}

final taskListProvider = FutureProvider.family<List<JsonMap>, String>((
  ref,
  date,
) async {
  final all = await ref
      .watch(localDatabaseProvider)
      .getRecords('tasks', dateKey: date);
  return all.where((task) => task['deleted'] != true).toList()
    ..sort((a, b) => jsonInt(a['order']).compareTo(jsonInt(b['order'])));
});

final sectionListProvider = FutureProvider<List<JsonMap>>((ref) async {
  final all = await ref.watch(localDatabaseProvider).getRecords('sections');
  return all.where((section) => section['deleted'] != true).toList()
    ..sort((a, b) => jsonInt(a['order']).compareTo(jsonInt(b['order'])));
});

final timeLogsByDateProvider = FutureProvider.family<List<JsonMap>, String>((
  ref,
  date,
) async {
  final all = await ref
      .watch(localDatabaseProvider)
      .getRecords('timeLogs', dateKey: date);
  return all.where((log) => log['deleted'] != true).toList();
});

final allTasksProvider = FutureProvider<List<JsonMap>>((ref) async {
  final all = await ref.watch(localDatabaseProvider).getRecords('tasks');
  return all.where((task) => task['deleted'] != true).toList()
    ..sort((a, b) => jsonInt(a['order']).compareTo(jsonInt(b['order'])));
});

final allTimeLogsProvider = FutureProvider<List<JsonMap>>((ref) async {
  final all = await ref.watch(localDatabaseProvider).getRecords('timeLogs');
  return all.where((log) => log['deleted'] != true).toList();
});

final themeModeProvider = NotifierProvider<ThemeController, ThemeMode>(
  ThemeController.new,
);

final calendarModeProvider = NotifierProvider<CalendarModeController, String>(
  CalendarModeController.new,
);

class CalendarModeController extends Notifier<String> {
  @override
  String build() => 'ethiopian';

  Future<void> load() async {
    final stored = await ref
        .read(localDatabaseProvider)
        .getMeta('calendarMode');
    state = stored == 'gregorian' ? 'gregorian' : 'ethiopian';
  }

  Future<void> setMode(String mode) async {
    state = mode == 'gregorian' ? 'gregorian' : 'ethiopian';
    await ref.read(localDatabaseProvider).setMeta('calendarMode', state);
  }
}

class ThemeController extends Notifier<ThemeMode> {
  @override
  ThemeMode build() => ThemeMode.dark;

  Future<void> load() async {
    final stored = await ref.read(localDatabaseProvider).getMeta('theme');
    state = stored == 'light' ? ThemeMode.light : ThemeMode.dark;
  }

  Future<void> toggle() async {
    state = state == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark;
    await ref
        .read(localDatabaseProvider)
        .setMeta('theme', state == ThemeMode.dark ? 'dark' : 'light');
  }
}

void invalidatePlanningViews(WidgetRef ref) {
  ref.invalidate(taskListProvider);
  ref.invalidate(sectionListProvider);
  unawaited(ref.read(syncControllerProvider.notifier).refreshPending());
}
