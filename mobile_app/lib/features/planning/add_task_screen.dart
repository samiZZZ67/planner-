import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/date/planner_dates.dart';
import '../../core/models/planner_models.dart';
import '../../core/providers.dart';

class AddTaskScreen extends ConsumerStatefulWidget {
  const AddTaskScreen({super.key, this.initialDate, this.initialTaskId});
  final String? initialDate;
  final String? initialTaskId;

  @override
  ConsumerState<AddTaskScreen> createState() => _AddTaskScreenState();
}

class _AddTaskScreenState extends ConsumerState<AddTaskScreen> {
  final _formKey = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _strategy = TextEditingController();
  final _doneMeans = TextEditingController();
  final _estimate = TextEditingController(text: '30');
  final _tags = TextEditingController();
  late String _date;
  String? _sectionId;
  String _priority = 'Medium';
  String? _startTime;
  String? _endTime;
  String? _deadline;
  bool _mustDo = false;
  bool _saving = false;
  bool _loading = false;
  JsonMap? _existing;

  @override
  void initState() {
    super.initState();
    _date = widget.initialDate ?? traditionalDayKey();
    if (widget.initialTaskId != null) {
      _loading = true;
      Future.microtask(_loadTask);
    }
  }

  Future<void> _loadTask() async {
    final task = await ref
        .read(localDatabaseProvider)
        .getRecord('tasks', widget.initialTaskId!);
    if (!mounted) return;
    if (task == null) {
      setState(() => _loading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('That task is no longer available on this device.'),
        ),
      );
      return;
    }
    _existing = task;
    _title.text = task['title']?.toString() ?? '';
    _description.text = task['description']?.toString() ?? '';
    _strategy.text = task['strategy']?.toString() ?? '';
    _doneMeans.text = task['doneMeans']?.toString() ?? '';
    _estimate.text = jsonInt(task['estimatedMinutes'], 30).toString();
    _tags.text = (task['tags'] is List ? (task['tags'] as List).join(', ') : '')
        .toString();
    _date = task['date']?.toString() ?? _date;
    _sectionId = task['sectionId']?.toString();
    _priority = task['priority']?.toString() ?? 'Medium';
    _startTime = task['startTime']?.toString();
    _endTime = task['endTime']?.toString();
    _deadline = task['deadline']?.toString();
    _mustDo = task['mustDo'] == true;
    setState(() => _loading = false);
  }

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    _strategy.dispose();
    _doneMeans.dispose();
    _estimate.dispose();
    _tags.dispose();
    super.dispose();
  }

  Future<void> _selectDate() async {
    final selected = await showDatePicker(
      context: context,
      initialDate: dateFromKey(_date),
      firstDate: DateTime.utc(2000),
      lastDate: DateTime.utc(2100),
    );
    if (selected != null) setState(() => _date = toDateKey(selected));
  }

  Future<void> _selectTime({required bool start}) async {
    final old = start ? _startTime : _endTime;
    final parts = old?.split(':') ?? const ['08', '00'];
    final initial = TimeOfDay(
      hour: int.tryParse(parts[0]) ?? 8,
      minute: int.tryParse(parts.length > 1 ? parts[1] : '') ?? 0,
    );
    final selected = await showTimePicker(
      context: context,
      initialTime: initial,
    );
    if (selected == null) return;
    final value =
        '${selected.hour.toString().padLeft(2, '0')}:${selected.minute.toString().padLeft(2, '0')}';
    setState(() {
      if (start) {
        _startTime = value;
      } else {
        _endTime = value;
      }
    });
  }

  Future<void> _save() async {
    if (_saving || !_formKey.currentState!.validate()) return;
    final sections = await ref.read(sectionListProvider.future);
    if (sections.isEmpty) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Create a category before adding tasks.'),
          ),
        );
      return;
    }
    _sectionId ??= sections.first['id']?.toString();
    if (_sectionId == null) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    final isMustDo = _mustDo;
    if (isMustDo) {
      final sameDay = await ref
          .read(localDatabaseProvider)
          .getRecords('tasks', dateKey: _date);
      final otherTopTasks = sameDay
          .where(
            (task) =>
                task['deleted'] != true &&
                task['mustDo'] == true &&
                task['id'] != _existing?['id'],
          )
          .length;
      if (otherTopTasks >= 3) {
        if (mounted)
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Choose up to three must-do tasks for a day.'),
            ),
          );
        return;
      }
    }
    setState(() => _saving = true);
    final wasCompleted = _existing?['isCompleted'] == true;
    final id = _existing?['id']?.toString() ?? _newId();
    final parsedTags = _tags.text
        .split(',')
        .map((tag) => tag.trim())
        .where((tag) => tag.isNotEmpty)
        .toSet()
        .toList();
    final minutes = int.tryParse(_estimate.text.trim()) ?? 0;
    final task = <String, dynamic>{
      ...?_existing,
      'id': id,
      'date': _date,
      'sectionId': _sectionId,
      'title': _title.text.trim(),
      'description': _description.text.trim(),
      'strategy': _strategy.text.trim(),
      'doneMeans': _doneMeans.text.trim(),
      'estimatedMinutes': minutes,
      'priority': _priority,
      'mustDo': isMustDo,
      'tags': parsedTags,
      'icon': _existing?['icon'] ?? '',
      'textColor': _existing?['textColor'],
      'image': _existing?['image'],
      'isCompleted': wasCompleted,
      'completedAt': _existing?['completedAt'],
      'order': jsonInt(_existing?['order'], 999),
      'createdAt': jsonInt(_existing?['createdAt'], now),
      'updatedAt': now,
      'deleted': false,
      'isSample': false,
      'startTime': _startTime,
      'endTime': _endTime,
      'scheduledMinutes': _scheduledMinutes(),
      'status':
          _existing?['status'] ?? (wasCompleted ? 'completed' : 'not_started'),
      'deadline': _deadline,
    };
    await ref.read(localDatabaseProvider).putLocalRecord('tasks', task);
    invalidatePlanningViews(ref);
    if (mounted) {
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            _existing == null
                ? 'Task saved on this device.'
                : 'Task updated on this device.',
          ),
        ),
      );
      context.go('/today');
    }
  }

  int? _scheduledMinutes() {
    if (_startTime == null || _endTime == null) return null;
    final start = _startTime!.split(':').map(int.parse).toList();
    final end = _endTime!.split(':').map(int.parse).toList();
    final value = (end[0] * 60 + end[1]) - (start[0] * 60 + start[1]);
    return value > 0 ? value : null;
  }

  String _newId() =>
      '${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}-${Random.secure().nextInt(1 << 32).toRadixString(36)}';

  @override
  Widget build(BuildContext context) {
    final sections = ref.watch(sectionListProvider);
    return CustomScrollView(
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 28),
          sliver: SliverList.list(
            children: [
              Row(
                children: [
                  IconButton(
                    onPressed: () => context.pop(),
                    icon: const Icon(Icons.arrow_back),
                  ),
                  Expanded(
                    child: Text(
                      _existing == null ? 'Add task' : 'Edit task',
                      style: Theme.of(context).textTheme.headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              if (_loading)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.all(32),
                    child: CircularProgressIndicator(),
                  ),
                )
              else
                sections.when(
                  loading: () => const Center(
                    child: Padding(
                      padding: EdgeInsets.all(32),
                      child: CircularProgressIndicator(),
                    ),
                  ),
                  error: (error, stack) => Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text('Could not load categories: $error'),
                    ),
                  ),
                  data: (items) {
                    if (_sectionId == null && items.isNotEmpty)
                      _sectionId = items.first['id']?.toString();
                    return Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Card(
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  TextFormField(
                                    controller: _title,
                                    textCapitalization:
                                        TextCapitalization.sentences,
                                    decoration: const InputDecoration(
                                      labelText: 'What will you do?',
                                      hintText: 'Write a clear task title',
                                    ),
                                    validator: (value) =>
                                        (value ?? '').trim().isEmpty
                                        ? 'Add a title.'
                                        : null,
                                  ),
                                  const SizedBox(height: 12),
                                  TextFormField(
                                    controller: _description,
                                    maxLines: 3,
                                    textCapitalization:
                                        TextCapitalization.sentences,
                                    decoration: const InputDecoration(
                                      labelText: 'Description',
                                      hintText: 'Add context or details',
                                    ),
                                  ),
                                  const SizedBox(height: 12),
                                  DropdownButtonFormField<String>(
                                    value: _sectionId,
                                    decoration: const InputDecoration(
                                      labelText: 'Category',
                                    ),
                                    items: items
                                        .map(
                                          (section) => DropdownMenuItem(
                                            value: section['id']?.toString(),
                                            child: Text(
                                              '${section['icon'] ?? ''} ${section['name'] ?? 'Category'}',
                                            ),
                                          ),
                                        )
                                        .toList(),
                                    onChanged: (value) =>
                                        setState(() => _sectionId = value),
                                  ),
                                  const SizedBox(height: 12),
                                  DropdownButtonFormField<String>(
                                    value: _priority,
                                    decoration: const InputDecoration(
                                      labelText: 'Priority',
                                    ),
                                    items: const ['Low', 'Medium', 'High']
                                        .map(
                                          (value) => DropdownMenuItem(
                                            value: value,
                                            child: Text(value),
                                          ),
                                        )
                                        .toList(),
                                    onChanged: (value) => setState(
                                      () => _priority = value ?? 'Medium',
                                    ),
                                  ),
                                  const SizedBox(height: 12),
                                  TextFormField(
                                    controller: _estimate,
                                    keyboardType: TextInputType.number,
                                    decoration: const InputDecoration(
                                      labelText: 'Estimated minutes',
                                      prefixIcon: Icon(Icons.timer_outlined),
                                    ),
                                    validator: (value) {
                                      final minutes = int.tryParse(
                                        (value ?? '').trim(),
                                      );
                                      return minutes == null ||
                                              minutes < 0 ||
                                              minutes > 10080
                                          ? 'Enter a number from 0 to 10080.'
                                          : null;
                                    },
                                  ),
                                  const SizedBox(height: 12),
                                  TextFormField(
                                    controller: _tags,
                                    decoration: const InputDecoration(
                                      labelText: 'Tags',
                                      hintText: 'Separate tags with commas',
                                    ),
                                    textCapitalization:
                                        TextCapitalization.words,
                                  ),
                                  SwitchListTile.adaptive(
                                    contentPadding: EdgeInsets.zero,
                                    value: _mustDo,
                                    onChanged: (value) =>
                                        setState(() => _mustDo = value),
                                    title: const Text('Must do today'),
                                    subtitle: const Text(
                                      'The web planner allows up to three per day.',
                                    ),
                                    secondary: const Icon(Icons.star_outline),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(height: 12),
                          Card(
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  Text(
                                    'Plan the work',
                                    style: Theme.of(context)
                                        .textTheme
                                        .titleMedium
                                        ?.copyWith(fontWeight: FontWeight.w700),
                                  ),
                                  const SizedBox(height: 12),
                                  TextFormField(
                                    controller: _strategy,
                                    maxLines: 3,
                                    decoration: const InputDecoration(
                                      labelText: 'Strategy',
                                      hintText: 'How will you work on it?',
                                    ),
                                  ),
                                  const SizedBox(height: 12),
                                  TextFormField(
                                    controller: _doneMeans,
                                    maxLines: 2,
                                    decoration: const InputDecoration(
                                      labelText: 'Done means',
                                      hintText:
                                          'What result shows this is complete?',
                                    ),
                                  ),
                                  const SizedBox(height: 12),
                                  OutlinedButton.icon(
                                    onPressed: _selectDate,
                                    icon: const Icon(
                                      Icons.calendar_today_outlined,
                                    ),
                                    label: Text(
                                      DateFormat('EEE, MMM d, yyyy')
                                          .format(dateFromKey(_date)),
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  Row(
                                    children: [
                                      Expanded(
                                        child: OutlinedButton.icon(
                                          onPressed: () =>
                                              _selectTime(start: true),
                                          icon: const Icon(Icons.play_arrow),
                                          label: Text(
                                            _startTime ?? 'Start time',
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: OutlinedButton.icon(
                                          onPressed: () =>
                                              _selectTime(start: false),
                                          icon: const Icon(Icons.flag_outlined),
                                          label: Text(_endTime ?? 'End time'),
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  OutlinedButton.icon(
                                    onPressed: () async {
                                      final selected = await showDatePicker(
                                        context: context,
                                        initialDate: _deadline == null
                                            ? dateFromKey(_date)
                                            : dateFromKey(_deadline!),
                                        firstDate: DateTime.utc(2000),
                                        lastDate: DateTime.utc(2100),
                                      );
                                      if (selected != null)
                                        setState(
                                          () => _deadline = toDateKey(selected),
                                        );
                                    },
                                    icon: const Icon(Icons.event_outlined),
                                    label: Text(
                                      _deadline == null
                                          ? 'Add deadline'
                                          : 'Deadline · ${_deadline!}',
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(height: 16),
                          FilledButton.icon(
                            onPressed: _saving ? null : _save,
                            icon: _saving
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.save_outlined),
                            label: Text(_saving ? 'Saving…' : 'Save task'),
                            style: FilledButton.styleFrom(
                              minimumSize: const Size.fromHeight(52),
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
            ],
          ),
        ),
      ],
    );
  }
}
