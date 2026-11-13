import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/date/planner_dates.dart';
import '../../core/models/planner_models.dart';
import '../../core/providers.dart';

class CategoryScreen extends ConsumerStatefulWidget {
  const CategoryScreen({super.key});
  @override
  ConsumerState<CategoryScreen> createState() => _CategoryScreenState();
}

class _CategoryScreenState extends ConsumerState<CategoryScreen> {
  late String _date;
  String? _expanded;
  bool _showAll = false;

  @override
  void initState() {
    super.initState();
    _date = traditionalDayKey();
  }

  Future<void> _editSection([JsonMap? section]) async {
    final name = TextEditingController(
      text: section?['name']?.toString() ?? '',
    );
    final icon = TextEditingController(
      text: section?['icon']?.toString() ?? '📁',
    );
    final minutes = TextEditingController(
      text: section?['dailyTargetMinutes']?.toString() ?? '',
    );
    var type = section?['targetType']?.toString() ?? 'at least';
    var color = section?['color']?.toString() ?? '#ffffff';
    final colors = const [
      '#ffffff',
      '#e4e4e7',
      '#d4d4d8',
      '#a1a1aa',
      '#71717a',
      '#52525b',
      '#3f3f46',
      '#27272a',
    ];
    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(section == null ? 'Add category' : 'Edit category'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: name,
                  autofocus: true,
                  decoration: const InputDecoration(labelText: 'Name'),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: icon,
                        maxLength: 4,
                        decoration: const InputDecoration(
                          labelText: 'Icon / emoji',
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: minutes,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: 'Daily target minutes',
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                DropdownButtonFormField<String>(
                  value: type,
                  decoration: const InputDecoration(labelText: 'Target rule'),
                  items: const [
                    DropdownMenuItem(
                      value: 'at least',
                      child: Text('At least'),
                    ),
                    DropdownMenuItem(value: 'at most', child: Text('At most')),
                  ],
                  onChanged: (value) =>
                      setDialogState(() => type = value ?? 'at least'),
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  children: colors
                      .map(
                        (value) => InkWell(
                          onTap: () => setDialogState(() => color = value),
                          child: Container(
                            width: 28,
                            height: 28,
                            decoration: BoxDecoration(
                              color: Color(
                                int.parse(value.substring(1), radix: 16) +
                                    0xFF000000,
                              ),
                              shape: BoxShape.circle,
                              border: Border.all(
                                width: color == value ? 3 : 1,
                                color: color == value
                                    ? Theme.of(context).colorScheme.secondary
                                    : Theme.of(context).dividerColor,
                              ),
                            ),
                          ),
                        ),
                      )
                      .toList(),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    if (result != true || name.text.trim().isEmpty) {
      name.dispose();
      icon.dispose();
      minutes.dispose();
      return;
    }
    final sections = await ref
        .read(localDatabaseProvider)
        .getRecords('sections');
    final now = DateTime.now().millisecondsSinceEpoch;
    final id = section?['id']?.toString() ?? 'section-${now.toRadixString(36)}';
    final parsedMinutes = int.tryParse(minutes.text.trim());
    await ref.read(localDatabaseProvider).putLocalRecord('sections', {
      ...?section,
      'id': id,
      'name': name.text.trim(),
      'color': color,
      'icon': icon.text.trim().isEmpty ? '📁' : icon.text.trim(),
      'order': section == null ? sections.length : jsonInt(section['order']),
      'dailyTargetMinutes': parsedMinutes,
      'targetType': type,
      'updatedAt': now,
      'deleted': false,
      'isSample': false,
    });
    name.dispose();
    icon.dispose();
    minutes.dispose();
    invalidatePlanningViews(ref);
  }

  Future<void> _deleteSection(JsonMap section, List<JsonMap> sections) async {
    if (sections.length <= 1) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Keep at least one category in your planner.'),
        ),
      );
      return;
    }
    final fallback = sections.firstWhere(
      (item) => item['id'] != section['id'],
      orElse: () => sections.first,
    );
    final tasks = await ref.read(localDatabaseProvider).getRecords('tasks');
    final attached = tasks
        .where(
          (task) =>
              task['deleted'] != true && task['sectionId'] == section['id'],
        )
        .toList();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete category?'),
        content: Text(
          attached.isEmpty
              ? '“${section['name']}” will be removed.'
              : '${attached.length} task(s) in “${section['name']}” will move to “${fallback['name']}”.',
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
    if (ok != true) return;
    final db = ref.read(localDatabaseProvider);
    final now = DateTime.now().millisecondsSinceEpoch;
    for (final task in attached) {
      await db.putLocalRecord('tasks', {
        ...task,
        'sectionId': fallback['id'],
        'updatedAt': now,
      });
    }
    await db.putLocalRecord('sections', {
      ...section,
      'deleted': true,
      'updatedAt': now,
    });
    invalidatePlanningViews(ref);
  }

  Future<void> _toggleTask(JsonMap task) async {
    final complete = task['isCompleted'] != true;
    final now = DateTime.now().millisecondsSinceEpoch;
    await ref.read(localDatabaseProvider).putLocalRecord('tasks', {
      ...task,
      'isCompleted': complete,
      'status': complete ? 'completed' : 'not_started',
      'completedAt': complete ? now : null,
      'updatedAt': now,
    });
    invalidatePlanningViews(ref);
  }

  Future<void> _shiftSection(
    List<JsonMap> sections,
    int index,
    int direction,
  ) async {
    final target = index + direction;
    if (target < 0 || target >= sections.length) return;
    final reordered = [...sections];
    final item = reordered.removeAt(index);
    reordered.insert(target, item);
    final db = ref.read(localDatabaseProvider);
    for (var i = 0; i < reordered.length; i++) {
      await db.putLocalRecord('sections', {
        ...reordered[i],
        'order': i,
        'updatedAt': DateTime.now().millisecondsSinceEpoch,
      });
    }
    invalidatePlanningViews(ref);
  }

  @override
  Widget build(BuildContext context) {
    final sectionsValue = ref.watch(sectionListProvider);
    final tasksValue = ref.watch(allTasksProvider);
    return CustomScrollView(
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 24),
          sliver: SliverList.list(
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Categories',
                      style: Theme.of(context).textTheme.headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                  ),
                  IconButton(
                    onPressed: () => _editSection(),
                    icon: const Icon(Icons.add_circle_outline),
                    tooltip: 'Add category',
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  IconButton(
                    onPressed: () =>
                        setState(() => _date = shiftDateKey(_date, -1)),
                    icon: const Icon(Icons.chevron_left),
                  ),
                  Expanded(
                    child: Center(
                      child: Text(
                        _showAll ? 'All tasks' : 'Tasks · $_date',
                        style: Theme.of(context).textTheme.titleSmall
                            ?.copyWith(fontWeight: FontWeight.w600),
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () =>
                        setState(() => _date = shiftDateKey(_date, 1)),
                    icon: const Icon(Icons.chevron_right),
                  ),
                  IconButton(
                    onPressed: () => setState(() => _showAll = !_showAll),
                    icon: Icon(_showAll ? Icons.today : Icons.date_range),
                    tooltip: _showAll ? 'Show this day' : 'Show all days',
                  ),
                ],
              ),
              const SizedBox(height: 10),
              sectionsValue.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, stack) =>
                    Text('Could not load categories: $error'),
                data: (sections) => tasksValue.when(
                  loading: () =>
                      const Center(child: CircularProgressIndicator()),
                  error: (error, stack) => Text('Could not load tasks: $error'),
                  data: (allTasks) => Column(
                    children: [
                      for (var index = 0; index < sections.length; index++) ...[
                        _SectionCard(
                          section: sections[index],
                          index: index,
                          count: allTasks
                              .where(
                                (task) =>
                                    task['sectionId'] ==
                                        sections[index]['id'] &&
                                    (_showAll || task['date'] == _date),
                              )
                              .length,
                          expanded: _expanded == sections[index]['id'],
                          onExpand: () => setState(
                            () => _expanded = _expanded == sections[index]['id']
                                ? null
                                : sections[index]['id']?.toString(),
                          ),
                          onEdit: () => _editSection(sections[index]),
                          onDelete: () =>
                              _deleteSection(sections[index], sections),
                          onUp: () => _shiftSection(sections, index, -1),
                          onDown: () => _shiftSection(sections, index, 1),
                          tasks: allTasks
                              .where(
                                (task) =>
                                    task['sectionId'] ==
                                        sections[index]['id'] &&
                                    (_showAll || task['date'] == _date),
                              )
                              .toList(),
                          onToggleTask: _toggleTask,
                          onEditTask: (task) => context.push(
                            '/add?date=${task['date']}&taskId=${Uri.encodeComponent(task['id'].toString())}',
                          ),
                          onAddTask: () => context.push('/add?date=$_date'),
                        ),
                        const SizedBox(height: 10),
                      ],
                      const SizedBox(height: 16),
                      OutlinedButton.icon(
                        onPressed: () => _editSection(),
                        icon: const Icon(Icons.add),
                        label: const Text('Add category'),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({
    required this.section,
    required this.index,
    required this.count,
    required this.expanded,
    required this.onExpand,
    required this.onEdit,
    required this.onDelete,
    required this.onUp,
    required this.onDown,
    required this.tasks,
    required this.onToggleTask,
    required this.onEditTask,
    required this.onAddTask,
  });
  final JsonMap section;
  final int index;
  final int count;
  final bool expanded;
  final VoidCallback onExpand, onEdit, onDelete, onUp, onDown, onAddTask;
  final List<JsonMap> tasks;
  final ValueChanged<JsonMap> onToggleTask, onEditTask;

  @override
  Widget build(BuildContext context) => Card(
    child: Column(
      children: [
        ListTile(
          onTap: onExpand,
          leading: Text(
            section['icon']?.toString() ?? '📁',
            style: const TextStyle(fontSize: 23),
          ),
          title: Text(
            section['name']?.toString() ?? 'Category',
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          subtitle: Text(
            '${count} task${count == 1 ? '' : 's'} · ${section['dailyTargetMinutes'] ?? 'No'} minute target',
          ),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconButton(
                onPressed: onUp,
                icon: const Icon(Icons.keyboard_arrow_up),
                tooltip: 'Move up',
              ),
              IconButton(
                onPressed: onDown,
                icon: const Icon(Icons.keyboard_arrow_down),
                tooltip: 'Move down',
              ),
              PopupMenuButton<String>(
                onSelected: (value) => value == 'edit' ? onEdit() : onDelete(),
                itemBuilder: (_) => const [
                  PopupMenuItem(value: 'edit', child: Text('Edit')),
                  PopupMenuItem(value: 'delete', child: Text('Delete')),
                ],
              ),
              Icon(expanded ? Icons.expand_less : Icons.expand_more),
            ],
          ),
        ),
        if (expanded) ...[
          const Divider(height: 1),
          if (tasks.isEmpty)
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('No tasks in this category yet.'),
            ),
          for (final task in tasks)
            ListTile(
              dense: true,
              leading: Checkbox(
                value: task['isCompleted'] == true,
                onChanged: (_) => onToggleTask(task),
              ),
              title: Text(
                task['title']?.toString() ?? 'Untitled task',
                style: TextStyle(
                  decoration: task['isCompleted'] == true
                      ? TextDecoration.lineThrough
                      : null,
                ),
              ),
              subtitle: Text(
                '${task['priority'] ?? 'Medium'} · ${task['date'] ?? ''} · ${jsonInt(task['estimatedMinutes'])} min',
              ),
              onTap: () => onEditTask(task),
            ),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: onAddTask,
              icon: const Icon(Icons.add, size: 18),
              label: const Text('Add task'),
            ),
          ),
        ],
      ],
    ),
  );
}
