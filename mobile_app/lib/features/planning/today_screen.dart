import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../app/theme.dart';
import '../../core/date/planner_dates.dart';
import '../../core/models/planner_models.dart';
import '../../core/providers.dart';
import '../../core/timer/timer_providers.dart';

class TodayScreen extends ConsumerStatefulWidget {
  const TodayScreen({super.key});
  @override
  ConsumerState<TodayScreen> createState() => _TodayScreenState();
}

class _TodayScreenState extends ConsumerState<TodayScreen>
    with WidgetsBindingObserver {
  late String _date;

  @override
  void initState() {
    super.initState();
    _date = traditionalDayKey();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      ref.invalidate(taskListProvider(_date));
      ref.read(timerControllerProvider.notifier).initialize();
      unawaited(ref.read(syncControllerProvider.notifier).sync());
    }
  }

  Future<void> _setComplete(JsonMap task) async {
    final completed = task['isCompleted'] != true;
    final now = DateTime.now().millisecondsSinceEpoch;
    await ref.read(localDatabaseProvider).putLocalRecord('tasks', {
      ...task,
      'isCompleted': completed,
      'status': completed ? 'completed' : 'not_started',
      'completedAt': completed ? now : null,
      'updatedAt': now,
    });
    invalidatePlanningViews(ref);
  }

  Future<void> _deleteTask(JsonMap task) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete this task?'),
        content: Text(
          '“${task['title'] ?? 'Task'}” will be removed from your planner on this device and synced when online.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await ref.read(localDatabaseProvider).putLocalRecord('tasks', {
      ...task,
      'deleted': true,
      'updatedAt': DateTime.now().millisecondsSinceEpoch,
    });
    invalidatePlanningViews(ref);
  }

  Future<void> _startTimer(JsonMap task) async {
    final started = await ref
        .read(timerControllerProvider.notifier)
        .start(task);
    if (!started && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Finish or stop the current focus timer first.'),
        ),
      );
    }
  }

  Future<void> _logManualTime(JsonMap task) async {
    final minutes = TextEditingController(text: '30');
    final value = await showDialog<int>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Log time · ${task['title'] ?? 'Task'}'),
        content: TextField(
          controller: minutes,
          autofocus: true,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(
            labelText: 'Minutes',
            suffixText: 'min',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final parsed = int.tryParse(minutes.text.trim());
              if (parsed != null && parsed > 0 && parsed <= 1440)
                Navigator.pop(context, parsed);
            },
            child: const Text('Save time'),
          ),
        ],
      ),
    );
    minutes.dispose();
    if (value == null) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    await ref.read(localDatabaseProvider).putLocalRecord('timeLogs', {
      'id': '${now.toRadixString(36)}-${task['id']}',
      'taskId': task['id'],
      'date': _date,
      'minutes': value,
      'source': 'manual',
      'createdAt': now,
      'updatedAt': now,
      'deleted': false,
      'isSample': false,
    });
    ref.invalidate(timeLogsByDateProvider(_date));
    unawaited(ref.read(syncControllerProvider.notifier).refreshPending());
  }

  @override
  Widget build(BuildContext context) {
    final tasks = ref.watch(taskListProvider(_date));
    final sections = ref.watch(sectionListProvider);
    final logs = ref.watch(timeLogsByDateProvider(_date));
    final sync = ref.watch(syncControllerProvider);
    final timer = ref.watch(timerControllerProvider);
    final calendarMode = ref.watch(calendarModeProvider);
    final sectionNames = <String, String>{};
    sections.whenData((items) {
      for (final item in items) {
        sectionNames[item['id'].toString()] =
            item['name']?.toString() ?? 'Other';
      }
    });

    return RefreshIndicator(
      onRefresh: () async {
        await ref.read(syncControllerProvider.notifier).sync();
        ref.invalidate(taskListProvider(_date));
      },
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 14, 20, 24),
            sliver: SliverList.list(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Sam\'Space',
                            style: Theme.of(context).textTheme.labelLarge
                                ?.copyWith(
                                  color: Theme.of(context)
                                      .colorScheme
                                      .onSurfaceVariant,
                                  letterSpacing: 1.2,
                                ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Today',
                            style: Theme.of(context).textTheme.headlineMedium
                                ?.copyWith(fontWeight: FontWeight.w800),
                          ),
                        ],
                      ),
                    ),
                    _SyncBadge(sync: sync),
                    const SizedBox(width: 8),
                    IconButton(
                      onPressed: () => context.push('/settings'),
                      icon: const Icon(Icons.settings_outlined),
                      tooltip: 'Settings',
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                GlassCard(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                  child: Row(
                    children: [
                      IconButton(
                        onPressed: () =>
                            setState(() => _date = shiftDateKey(_date, -1)),
                        icon: const Icon(Icons.chevron_left),
                        tooltip: 'Previous day',
                      ),
                      Expanded(
                        child: InkWell(
                          borderRadius: BorderRadius.circular(12),
                          onTap: () async {
                            final selected = await showDatePicker(
                              context: context,
                              initialDate: dateFromKey(_date),
                              firstDate: DateTime.utc(2000),
                              lastDate: DateTime.utc(2100),
                            );
                            if (selected != null)
                              setState(() => _date = toDateKey(selected));
                          },
                          child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: 8),
                            child: Column(
                              children: [
                                Text(
                                  DateFormat('EEEE, MMM d')
                                      .format(dateFromKey(_date)),
                                  style: Theme.of(context).textTheme.titleMedium
                                      ?.copyWith(fontWeight: FontWeight.w700),
                                ),
                                Text(
                                  '${plannerDateLabel(_date, calendarMode)}${_date == traditionalDayKey() ? ' · Planning day, Addis Ababa time' : ''}',
                                  style: Theme.of(context).textTheme.labelSmall
                                      ?.copyWith(
                                        color: Theme.of(context)
                                            .colorScheme
                                            .onSurfaceVariant,
                                      ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      IconButton(
                        onPressed: () =>
                            setState(() => _date = shiftDateKey(_date, 1)),
                        icon: const Icon(Icons.chevron_right),
                        tooltip: 'Next day',
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                tasks.when(
                  loading: () => const LinearProgressIndicator(),
                  error: (error, stack) => _InlineError(
                    message: 'Could not load local tasks: $error',
                    onRetry: () => ref.invalidate(taskListProvider(_date)),
                  ),
                  data: (items) {
                    final completeCount = items
                        .where((task) => task['isCompleted'] == true)
                        .length;
                    final spent =
                        logs.value?.fold<int>(
                          0,
                          (total, log) => total + jsonInt(log['minutes']),
                        ) ??
                        0;
                    final estimated = items.fold<int>(
                      0,
                      (total, task) =>
                          total + jsonInt(task['estimatedMinutes']),
                    );
                    final progress = items.isEmpty
                        ? 0.0
                        : completeCount / items.length;
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: _MetricCard(
                                label: 'Tasks done',
                                value: '$completeCount/${items.length}',
                                icon: Icons.check_circle_outline,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: _MetricCard(
                                label: 'Time tracked',
                                value: _minutesLabel(spent),
                                icon: Icons.timer_outlined,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: _MetricCard(
                                label: 'Planned',
                                value: _minutesLabel(estimated),
                                icon: Icons.schedule,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 15),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: LinearProgressIndicator(
                            value: progress,
                            minHeight: 7,
                          ),
                        ),
                        const SizedBox(height: 20),
                        if (timer.active != null) ...[
                          _TimerCard(state: timer),
                          const SizedBox(height: 18),
                        ],
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                'Your tasks',
                                style: Theme.of(context).textTheme.titleLarge
                                    ?.copyWith(fontWeight: FontWeight.w700),
                              ),
                            ),
                            TextButton.icon(
                              onPressed: () => context.push('/add?date=$_date'),
                              icon: const Icon(Icons.add, size: 18),
                              label: const Text('Add'),
                            ),
                          ],
                        ),
                        if (items.isEmpty)
                          GlassCard(
                            child: Column(
                              children: [
                                const Icon(Icons.event_note_outlined, size: 30),
                                const SizedBox(height: 10),
                                Text(
                                  'No tasks planned for this day',
                                  style: Theme.of(context).textTheme.titleMedium
                                      ?.copyWith(fontWeight: FontWeight.w600),
                                ),
                                const SizedBox(height: 5),
                                Text(
                                  'Add a task to start building your day.',
                                  style: Theme.of(context).textTheme.bodySmall
                                      ?.copyWith(
                                        color: Theme.of(context)
                                            .colorScheme
                                            .onSurfaceVariant,
                                      ),
                                ),
                                const SizedBox(height: 12),
                                FilledButton.icon(
                                  onPressed: () =>
                                      context.push('/add?date=$_date'),
                                  icon: const Icon(Icons.add),
                                  label: const Text('Add a task'),
                                ),
                              ],
                            ),
                          )
                        else
                          ...items.map(
                            (task) => Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: _TaskCard(
                                task: task,
                                section:
                                    sectionNames[task['sectionId']
                                        ?.toString()] ??
                                    'Other',
                                onComplete: () => _setComplete(task),
                                onStart: () => _startTimer(task),
                                onManualTime: () => _logManualTime(task),
                                onEdit: () => context.push(
                                  '/add?date=$_date&taskId=${Uri.encodeComponent(task['id'].toString())}',
                                ),
                                onDelete: () => _deleteTask(task),
                              ),
                            ),
                          ),
                        const SizedBox(height: 18),
                        _DayReviewCard(date: _date),
                      ],
                    );
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

String _minutesLabel(int minutes) => minutes < 60
    ? '${minutes}m'
    : '${minutes ~/ 60}h${minutes % 60 == 0 ? '' : ' ${minutes % 60}m'}';

class _MetricCard extends StatelessWidget {
  const _MetricCard({
    required this.label,
    required this.value,
    required this.icon,
  });
  final String label;
  final String value;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 17, color: Theme.of(context).colorScheme.secondary),
          const SizedBox(height: 8),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.titleMedium
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    ),
  );
}

class _TaskCard extends StatelessWidget {
  const _TaskCard({
    required this.task,
    required this.section,
    required this.onComplete,
    required this.onStart,
    required this.onManualTime,
    required this.onEdit,
    required this.onDelete,
  });
  final JsonMap task;
  final String section;
  final VoidCallback onComplete;
  final VoidCallback onStart;
  final VoidCallback onManualTime;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final complete = task['isCompleted'] == true;
    final detail = (task['description'] ?? '').toString();
    final duration = jsonInt(task['estimatedMinutes']);
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Checkbox(value: complete, onChanged: (_) => onComplete()),
            const SizedBox(width: 4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    task['title']?.toString() ?? 'Untitled task',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                      decoration: complete ? TextDecoration.lineThrough : null,
                    ),
                  ),
                  if (detail.isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(
                      detail,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      _Tag(icon: Icons.folder_outlined, label: section),
                      if (duration > 0)
                        _Tag(
                          icon: Icons.schedule,
                          label: _minutesLabel(duration),
                        ),
                      _Tag(
                        icon: Icons.flag_outlined,
                        label: task['priority']?.toString() ?? 'Medium',
                      ),
                      if (task['mustDo'] == true)
                        const _Tag(icon: Icons.star, label: 'Must do'),
                    ],
                  ),
                  if ((task['strategy'] ?? '').toString().isNotEmpty ||
                      (task['doneMeans'] ?? '').toString().isNotEmpty) ...[
                    const SizedBox(height: 8),
                    if ((task['strategy'] ?? '').toString().isNotEmpty)
                      Text(
                        'Strategy: ${task['strategy']}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    if ((task['doneMeans'] ?? '').toString().isNotEmpty)
                      Text(
                        'Done means: ${task['doneMeans']}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                  ],
                  if (!complete) ...[
                    const SizedBox(height: 8),
                    TextButton.icon(
                      onPressed: onStart,
                      icon: const Icon(Icons.play_arrow, size: 18),
                      label: const Text('Start focus'),
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            PopupMenuButton<String>(
              onSelected: (action) {
                if (action == 'edit') onEdit();
                if (action == 'delete') onDelete();
                if (action == 'time') onManualTime();
              },
              itemBuilder: (_) => const [
                PopupMenuItem(
                  value: 'edit',
                  child: ListTile(
                    leading: Icon(Icons.edit_outlined),
                    title: Text('Edit task'),
                  ),
                ),
                PopupMenuItem(
                  value: 'time',
                  child: ListTile(
                    leading: Icon(Icons.timer_outlined),
                    title: Text('Log time manually'),
                  ),
                ),
                PopupMenuItem(
                  value: 'delete',
                  child: ListTile(
                    leading: Icon(Icons.delete_outline),
                    title: Text('Delete task'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag({required this.icon, required this.label});
  final IconData icon;
  final String label;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(20),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 12),
        const SizedBox(width: 4),
        Text(label, style: Theme.of(context).textTheme.labelSmall),
      ],
    ),
  );
}

class _SyncBadge extends StatelessWidget {
  const _SyncBadge({required this.sync});
  final SyncState sync;
  @override
  Widget build(BuildContext context) {
    final label = sync.syncing
        ? 'Saving'
        : sync.offline
        ? 'Offline'
        : sync.pending > 0
        ? '${sync.pending} waiting'
        : 'Saved';
    final icon = sync.syncing
        ? Icons.sync
        : sync.offline
        ? Icons.cloud_off_outlined
        : sync.pending > 0
        ? Icons.cloud_upload_outlined
        : Icons.cloud_done_outlined;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Theme.of(context).dividerColor),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15),
          const SizedBox(width: 5),
          Text(label, style: Theme.of(context).textTheme.labelSmall),
        ],
      ),
    );
  }
}

class _TimerCard extends ConsumerWidget {
  const _TimerCard({required this.state});
  final TimerState state;
  @override
  Widget build(BuildContext context, WidgetRef ref) => Card(
    color: Theme.of(context).colorScheme.surfaceContainerHighest,
    child: Padding(
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          Icon(
            state.mode == 'break' ? Icons.coffee_outlined : Icons.bolt,
            color: Theme.of(context).colorScheme.secondary,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  state.mode == 'break' ? 'Break' : 'Focus session',
                  style: Theme.of(context).textTheme.labelMedium,
                ),
                Text(
                  state.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleSmall
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ),
          Text(
            state.displayTime,
            style: Theme.of(context).textTheme.titleMedium
                ?.copyWith(fontFeatures: const []),
          ),
          IconButton(
            onPressed: () => state.isRunning
                ? ref.read(timerControllerProvider.notifier).pause()
                : ref.read(timerControllerProvider.notifier).resume(),
            icon: Icon(state.isRunning ? Icons.pause : Icons.play_arrow),
            tooltip: state.isRunning ? 'Pause' : 'Resume',
          ),
          IconButton(
            onPressed: () => ref.read(timerControllerProvider.notifier).stop(),
            icon: const Icon(Icons.stop_circle_outlined),
            tooltip: 'Stop and log time',
          ),
        ],
      ),
    ),
  );
}

class _DayReviewCard extends ConsumerStatefulWidget {
  const _DayReviewCard({required this.date});
  final String date;
  @override
  ConsumerState<_DayReviewCard> createState() => _DayReviewCardState();
}

class _DayReviewCardState extends ConsumerState<_DayReviewCard> {
  final _worked = TextEditingController();
  final _blocked = TextEditingController();
  final _change = TextEditingController();
  bool _loaded = false;
  bool _loading = false;
  bool _saving = false;

  @override
  void didUpdateWidget(covariant _DayReviewCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.date != widget.date) {
      _loaded = false;
      _loading = false;
    }
  }

  @override
  void dispose() {
    _worked.dispose();
    _blocked.dispose();
    _change.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (_loading) return;
    _loading = true;
    final day = await ref
        .read(localDatabaseProvider)
        .getRecord('days', widget.date);
    final review = jsonMap(day?['review']);
    _worked.text = review['worked']?.toString() ?? '';
    _blocked.text = review['blocked']?.toString() ?? '';
    _change.text = review['change']?.toString() ?? '';
    if (mounted) {
      setState(() {
        _loaded = true;
        _loading = false;
      });
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final database = ref.read(localDatabaseProvider);
    final existing =
        await database.getRecord('days', widget.date) ?? <String, dynamic>{};
    final now = DateTime.now().millisecondsSinceEpoch;
    await database.putLocalRecord('days', {
      ...existing,
      'id': widget.date,
      'date': widget.date,
      'freeHours': existing['freeHours'] ?? 8.0,
      'review': {
        'worked': _worked.text,
        'blocked': _blocked.text,
        'change': _change.text,
      },
      'sheetData': jsonMap(existing['sheetData']),
      'updatedAt': now,
      'deleted': false,
      'isSample': false,
    });
    invalidatePlanningViews(ref);
    if (mounted) {
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Reflection saved on this device.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded && !_loading) _load();
    return GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Evening reflection',
            style: Theme.of(context).textTheme.titleMedium
                ?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _worked,
            maxLines: 2,
            decoration: const InputDecoration(labelText: 'What worked?'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _blocked,
            maxLines: 2,
            decoration: const InputDecoration(labelText: 'What blocked you?'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _change,
            maxLines: 2,
            decoration: const InputDecoration(
              labelText: 'One change for tomorrow',
            ),
          ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.tonalIcon(
              onPressed: _saving ? null : _save,
              icon: const Icon(Icons.save_outlined),
              label: Text(_saving ? 'Saving…' : 'Save reflection'),
            ),
          ),
        ],
      ),
    );
  }
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => GlassCard(
    child: Column(
      children: [
        Text(message),
        TextButton(onPressed: onRetry, child: const Text('Retry')),
      ],
    ),
  );
}
