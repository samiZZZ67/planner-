import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/date/planner_dates.dart';
import '../../core/models/planner_models.dart';
import '../../core/providers.dart';

class AnalyticsScreen extends ConsumerStatefulWidget {
  const AnalyticsScreen({super.key});
  @override
  ConsumerState<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends ConsumerState<AnalyticsScreen> {
  int _days = 7;

  @override
  Widget build(BuildContext context) {
    final tasksAsync = ref.watch(allTasksProvider);
    final logsAsync = ref.watch(allTimeLogsProvider);
    final sectionsAsync = ref.watch(sectionListProvider);
    return CustomScrollView(
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 26),
          sliver: SliverList.list(
            children: [
              Text(
                'Analytics',
                style: Theme.of(context).textTheme.headlineSmall
                    ?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 16),
              SegmentedButton<int>(
                segments: const [
                  ButtonSegment(value: 7, label: Text('7 days')),
                  ButtonSegment(value: 28, label: Text('28 days')),
                  ButtonSegment(value: 90, label: Text('90 days')),
                ],
                selected: {_days},
                onSelectionChanged: (selection) =>
                    setState(() => _days = selection.first),
              ),
              const SizedBox(height: 16),
              tasksAsync.when(
                loading: () => const Center(
                  child: Padding(
                    padding: EdgeInsets.all(30),
                    child: CircularProgressIndicator(),
                  ),
                ),
                error: (error, stack) =>
                    Text('Could not load task history: $error'),
                data: (allTasks) => logsAsync.when(
                  loading: () => const Center(
                    child: Padding(
                      padding: EdgeInsets.all(30),
                      child: CircularProgressIndicator(),
                    ),
                  ),
                  error: (error, stack) =>
                      Text('Could not load time history: $error'),
                  data: (allLogs) {
                    final today = dateFromKey(traditionalDayKey());
                    final start = toDateKey(
                      today.subtract(Duration(days: _days - 1)),
                    );
                    final taskRows = allTasks
                        .where(
                          (task) =>
                              task['date'] != null &&
                              task['date'].toString().compareTo(start) >= 0 &&
                              task['date'].toString().compareTo(
                                    traditionalDayKey(),
                                  ) <=
                                  0,
                        )
                        .toList();
                    final taskIds = taskRows
                        .map((task) => task['id'].toString())
                        .toSet();
                    final logs = allLogs
                        .where(
                          (log) =>
                              taskIds.contains(log['taskId']?.toString()) &&
                              log['date'].toString().compareTo(start) >= 0 &&
                              log['date'].toString().compareTo(
                                    traditionalDayKey(),
                                  ) <=
                                  0,
                        )
                        .toList();
                    final completed = taskRows
                        .where((task) => task['isCompleted'] == true)
                        .length;
                    final loggedMinutes = logs.fold<int>(
                      0,
                      (total, log) => total + jsonInt(log['minutes']),
                    );
                    final estimated = taskRows.fold<int>(
                      0,
                      (total, task) =>
                          total + jsonInt(task['estimatedMinutes']),
                    );
                    final completion = taskRows.isEmpty
                        ? 0
                        : (completed / taskRows.length * 100).round();
                    return sectionsAsync.when(
                      loading: () =>
                          const Center(child: CircularProgressIndicator()),
                      error: (error, stack) => _analyticsBody(
                        context,
                        taskRows,
                        logs,
                        completed,
                        loggedMinutes,
                        estimated,
                        completion,
                        const [],
                      ),
                      data: (sections) => _analyticsBody(
                        context,
                        taskRows,
                        logs,
                        completed,
                        loggedMinutes,
                        estimated,
                        completion,
                        sections,
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _analyticsBody(
    BuildContext context,
    List<JsonMap> tasks,
    List<JsonMap> logs,
    int completed,
    int loggedMinutes,
    int estimated,
    int completion,
    List<JsonMap> sections,
  ) {
    final today = dateFromKey(traditionalDayKey());
    final chartDays = List.generate(
      7,
      (index) => toDateKey(today.subtract(Duration(days: 6 - index))),
    );
    final minuteByDay = {for (final date in chartDays) date: 0};
    for (final log in logs) {
      final date = log['date']?.toString();
      if (date != null && minuteByDay.containsKey(date))
        minuteByDay[date] = minuteByDay[date]! + jsonInt(log['minutes']);
    }
    final maxMinutes = minuteByDay.values.fold<int>(
      60,
      (maxValue, minutes) => minutes > maxValue ? minutes : maxValue,
    );
    final sectionMinutes = <String, int>{};
    final taskById = {for (final task in tasks) task['id'].toString(): task};
    for (final log in logs) {
      final task = taskById[log['taskId']?.toString()];
      final sectionId = task?['sectionId']?.toString() ?? '';
      sectionMinutes[sectionId] =
          (sectionMinutes[sectionId] ?? 0) + jsonInt(log['minutes']);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: _StatCard(
                label: 'Completed',
                value: '$completed / ${tasks.length}',
                icon: Icons.check_circle_outline,
              ),
            ),
            const SizedBox(width: 9),
            Expanded(
              child: _StatCard(
                label: 'Focus time',
                value: _formatMinutes(loggedMinutes),
                icon: Icons.timer_outlined,
              ),
            ),
          ],
        ),
        const SizedBox(height: 9),
        Row(
          children: [
            Expanded(
              child: _StatCard(
                label: 'Completion',
                value: '$completion%',
                icon: Icons.done_all,
              ),
            ),
            const SizedBox(width: 9),
            Expanded(
              child: _StatCard(
                label: 'Estimated',
                value: _formatMinutes(estimated),
                icon: Icons.schedule,
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        GlassCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Focus time · last 7 days',
                style: Theme.of(context).textTheme.titleMedium
                    ?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 16),
              SizedBox(
                height: 156,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    for (final day in chartDays)
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 4),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.end,
                            children: [
                              Text(
                                minuteByDay[day] == 0
                                    ? ''
                                    : _formatMinutes(minuteByDay[day]!),
                                style: Theme.of(context).textTheme.labelSmall,
                              ),
                              const SizedBox(height: 5),
                              Container(
                                height: (112 * minuteByDay[day]! / maxMinutes)
                                    .clamp(3, 112)
                                    .toDouble(),
                                decoration: BoxDecoration(
                                  color: Theme.of(context)
                                      .colorScheme
                                      .secondary,
                                  borderRadius: BorderRadius.circular(8),
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                day.substring(5),
                                style: Theme.of(context).textTheme.labelSmall,
                              ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        GlassCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Section time',
                style: Theme.of(context).textTheme.titleMedium
                    ?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              if (sections.isEmpty || sectionMinutes.isEmpty)
                const Text(
                  'Track time on a task to see the section breakdown.',
                ),
              for (final section in sections.where(
                (item) => (sectionMinutes[item['id']?.toString()] ?? 0) > 0,
              )) ...[
                Builder(
                  builder: (context) {
                    final minutes =
                        sectionMinutes[section['id']?.toString()] ?? 0;
                    final fraction = loggedMinutes == 0
                        ? 0.0
                        : minutes / loggedMinutes;
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 7),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text(
                                '${section['icon'] ?? ''} ${section['name'] ?? 'Category'}',
                              ),
                              const Spacer(),
                              Text(
                                _formatMinutes(minutes),
                                style: Theme.of(context).textTheme.labelMedium,
                              ),
                            ],
                          ),
                          const SizedBox(height: 5),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(8),
                            child: LinearProgressIndicator(
                              value: fraction,
                              minHeight: 6,
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 14),
        Text(
          'Task history · $_days days',
          style: Theme.of(context).textTheme.titleLarge
              ?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        ...tasks.reversed
            .take(40)
            .map(
              (task) => Card(
                child: ListTile(
                  leading: Icon(
                    task['isCompleted'] == true
                        ? Icons.check_circle
                        : Icons.circle_outlined,
                  ),
                  title: Text(
                    task['title']?.toString() ?? 'Untitled task',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  subtitle: Text(
                    '${task['date'] ?? ''} · ${task['priority'] ?? 'Medium'}',
                  ),
                  trailing: Text('${jsonInt(task['estimatedMinutes'])}m'),
                ),
              ),
            ),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.label,
    required this.value,
    required this.icon,
  });
  final String label, value;
  final IconData icon;
  @override
  Widget build(BuildContext context) => GlassCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 18, color: Theme.of(context).colorScheme.secondary),
        const SizedBox(height: 10),
        Text(
          value,
          style: Theme.of(context).textTheme.titleLarge
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 3),
        Text(
          label,
          style: Theme.of(context).textTheme.labelSmall
              ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      ],
    ),
  );
}

String _formatMinutes(int minutes) =>
    minutes >= 60 ? '${minutes ~/ 60}h ${minutes % 60}m' : '${minutes}m';
