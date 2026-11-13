import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date/planner_dates.dart';
import '../../core/models/planner_models.dart';
import '../../core/providers.dart';

extension _FirstElementOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}

class PlansScreen extends StatelessWidget {
  const PlansScreen({super.key});
  @override
  Widget build(BuildContext context) => DefaultTabController(
    length: 2,
    child: Scaffold(
      appBar: AppBar(
        title: Text(
          'Plans',
          style: Theme.of(context).textTheme.headlineSmall
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        bottom: const TabBar(
          tabs: [
            Tab(text: 'Weekly'),
            Tab(text: 'Monthly'),
          ],
        ),
      ),
      body: const TabBarView(children: [_WeeklyPlanTab(), _MonthlyPlanTab()]),
    ),
  );
}

({String start, String end, String id}) _weekBounds(String dateKey) {
  final date = dateFromKey(dateKey);
  final mondayOffset = date.weekday - DateTime.monday;
  final monday = date.subtract(Duration(days: mondayOffset));
  final sunday = monday.add(const Duration(days: 6));
  final start = toDateKey(monday);
  final end = toDateKey(sunday);
  return (start: start, end: end, id: 'week-${start}_$end');
}

class _WeeklyPlanTab extends ConsumerStatefulWidget {
  const _WeeklyPlanTab();
  @override
  ConsumerState<_WeeklyPlanTab> createState() => _WeeklyPlanTabState();
}

class _WeeklyPlanTabState extends ConsumerState<_WeeklyPlanTab> {
  late String _anchorDate;
  final _prompt = TextEditingController();
  final _goals = TextEditingController();
  final _commitments = TextEditingController();
  final _deepWork = TextEditingController();
  final _constraints = TextEditingController();
  final _outcomes = TextEditingController();
  bool _loading = true;
  bool _saving = false;
  bool _reporting = false;
  bool _dirty = false;
  String? _report;

  @override
  void initState() {
    super.initState();
    _anchorDate = traditionalDayKey();
    _load();
  }

  @override
  void dispose() {
    _prompt.dispose();
    _goals.dispose();
    _commitments.dispose();
    _deepWork.dispose();
    _constraints.dispose();
    _outcomes.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final range = _weekBounds(_anchorDate);
    final records = await ref
        .read(localDatabaseProvider)
        .getRecords('weeklyPlans');
    final plan = records.where((row) => row['id'] == range.id).firstOrNull;
    _prompt.text = plan?['prompt']?.toString() ?? '';
    _goals.text = plan?['goals']?.toString() ?? '';
    _commitments.text = plan?['aastuCommitments']?.toString() ?? '';
    _deepWork.text = plan?['deepWorkTargets']?.toString() ?? '';
    _constraints.text = plan?['constraints']?.toString() ?? '';
    _outcomes.text = plan?['outcomes']?.toString() ?? '';
    _report = plan?['aiWeeklyReport']?.toString();
    if (mounted)
      setState(() {
        _loading = false;
        _dirty = false;
      });
  }

  int get _wordCount => _prompt.text.trim().isEmpty
      ? 0
      : _prompt.text.trim().split(RegExp(r'\s+')).length;

  Future<void> _save() async {
    if (_wordCount < 100) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Add at least 100 words to the weekly prompt (${100 - _wordCount} more).',
          ),
        ),
      );
      return;
    }
    setState(() => _saving = true);
    final range = _weekBounds(_anchorDate);
    final records = await ref
        .read(localDatabaseProvider)
        .getRecords('weeklyPlans');
    final previous = records.where((row) => row['id'] == range.id).firstOrNull;
    final now = DateTime.now().millisecondsSinceEpoch;
    await ref.read(localDatabaseProvider).putLocalRecord('weeklyPlans', {
      ...?previous,
      'id': range.id,
      'startDate': range.start,
      'endDate': range.end,
      'monthId': range.start.substring(0, 7),
      'prompt': _prompt.text.trim(),
      'wordCount': _wordCount,
      'goals': _goals.text.trim(),
      'aastuCommitments': _commitments.text.trim(),
      'deepWorkTargets': _deepWork.text.trim(),
      'constraints': _constraints.text.trim(),
      'outcomes': _outcomes.text.trim(),
      'aiWeeklyReport': _report,
      'status': previous?['status'] ?? 'active',
      'completionPercentage': previous?['completionPercentage'] ?? 0,
      'createdAt': jsonInt(previous?['createdAt'], now),
      'updatedAt': now,
      'deleted': false,
    });
    invalidatePlanningViews(ref);
    if (mounted)
      setState(() {
        _saving = false;
        _dirty = false;
      });
  }

  Future<void> _generateReport() async {
    if (_wordCount < 100) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Add at least 100 words to the weekly prompt (${100 - _wordCount} more).',
          ),
        ),
      );
      return;
    }
    if (_dirty) {
      await _save();
      if (_dirty) return;
    }
    final range = _weekBounds(_anchorDate);
    final db = ref.read(localDatabaseProvider);
    final plans = await db.getRecords('weeklyPlans');
    final plan = plans.where((item) => item['id'] == range.id).firstOrNull;
    if (plan == null) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Save this weekly plan first.')),
        );
      return;
    }
    setState(() => _reporting = true);
    try {
      final tasks = (await db.getRecords('tasks'))
          .where(
            (task) =>
                task['deleted'] != true &&
                task['date'].toString().compareTo(range.start) >= 0 &&
                task['date'].toString().compareTo(range.end) <= 0,
          )
          .toList();
      final logs = (await db.getRecords('timeLogs'))
          .where(
            (log) =>
                log['deleted'] != true &&
                log['date'].toString().compareTo(range.start) >= 0 &&
                log['date'].toString().compareTo(range.end) <= 0,
          )
          .toList();
      final response = await ref
          .read(apiClientProvider)
          .dio
          .post<Map<String, dynamic>>(
            '/api/ai/weekly-report',
            data: {'weeklyPlan': plan, 'tasks': tasks, 'timeLogs': logs},
          );
      final report = response.data?['report']?.toString();
      if (report == null || report.isEmpty)
        throw const FormatException('The server returned an empty report.');
      final now = DateTime.now().millisecondsSinceEpoch;
      await db.putLocalRecord('weeklyPlans', {
        ...plan,
        'aiWeeklyReport': report,
        'updatedAt': now,
      });
      if (mounted)
        setState(() {
          _report = report;
          _dirty = false;
        });
      invalidatePlanningViews(ref);
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Could not generate the report: ${error is DioException ? (error.response?.data is Map ? error.response?.data['error'] : error.message) : error}',
            ),
          ),
        );
    } finally {
      if (mounted) setState(() => _reporting = false);
    }
  }

  void _changeWeek(int amount) {
    setState(() => _anchorDate = shiftDateKey(_anchorDate, amount * 7));
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final range = _weekBounds(_anchorDate);
    return _loading
        ? const Center(child: CircularProgressIndicator())
        : ListView(
            padding: const EdgeInsets.fromLTRB(18, 12, 18, 28),
            children: [
              Card(
                child: Row(
                  children: [
                    IconButton(
                      onPressed: () => _changeWeek(-1),
                      icon: const Icon(Icons.chevron_left),
                    ),
                    Expanded(
                      child: Column(
                        children: [
                          Text(
                            '${range.start}  —  ${range.end}',
                            style: Theme.of(context).textTheme.titleSmall
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                          Text(
                            'Monday to Sunday',
                            style: Theme.of(context).textTheme.labelSmall,
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: () => _changeWeek(1),
                      icon: const Icon(Icons.chevron_right),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _prompt,
                minLines: 6,
                maxLines: 12,
                onChanged: (_) => setState(() => _dirty = true),
                decoration: InputDecoration(
                  labelText: 'Weekly planning prompt',
                  hintText: 'Break down your goals, academic deadlines, deep-work targets, constraints, and expected outcomes. At least 100 words.',
                  helperText: '$_wordCount / 100 words',
                ),
              ),
              const SizedBox(height: 12),
              _PlanField(controller: _goals, label: 'Main goals'),
              const SizedBox(height: 10),
              _PlanField(
                controller: _commitments,
                label: 'Academic commitments and deadlines',
              ),
              const SizedBox(height: 10),
              _PlanField(controller: _deepWork, label: 'Deep-work targets'),
              const SizedBox(height: 10),
              _PlanField(
                controller: _constraints,
                label: 'Constraints and priorities',
              ),
              const SizedBox(height: 10),
              _PlanField(controller: _outcomes, label: 'Expected outcomes'),
              const SizedBox(height: 14),
              FilledButton.icon(
                onPressed: _saving ? null : _save,
                icon: const Icon(Icons.save_outlined),
                label: Text(_saving ? 'Saving…' : 'Save weekly plan'),
              ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: _reporting ? null : _generateReport,
                icon: _reporting
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.auto_awesome),
                label: Text(
                  _reporting
                      ? 'Generating report…'
                      : 'Generate progress report',
                ),
              ),
              if (_report != null && _report!.isNotEmpty) ...[
                const SizedBox(height: 18),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: SelectableText(_report!),
                  ),
                ),
              ],
            ],
          );
  }
}

class _MonthlyPlanTab extends ConsumerStatefulWidget {
  const _MonthlyPlanTab();
  @override
  ConsumerState<_MonthlyPlanTab> createState() => _MonthlyPlanTabState();
}

class _MonthlyPlanTabState extends ConsumerState<_MonthlyPlanTab> {
  late String _month;
  final _title = TextEditingController();
  final _prompt = TextEditingController();
  final _academic = TextEditingController();
  final _editing = TextEditingController();
  final _commitments = TextEditingController();
  final _goalInput = TextEditingController();
  List<JsonMap> _goals = [];
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _month = traditionalDayKey().substring(0, 7);
    _load();
  }

  @override
  void dispose() {
    _title.dispose();
    _prompt.dispose();
    _academic.dispose();
    _editing.dispose();
    _commitments.dispose();
    _goalInput.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final plans = await ref
        .read(localDatabaseProvider)
        .getRecords('monthlyPlans');
    final plan = plans.where((item) => item['month'] == _month).firstOrNull;
    _title.text = plan?['title']?.toString() ?? '';
    _prompt.text = plan?['prompt']?.toString() ?? '';
    _academic.text = plan?['academicPriorities']?.toString() ?? '';
    _editing.text = plan?['editingTargets']?.toString() ?? '';
    _commitments.text = plan?['commitments']?.toString() ?? '';
    _goals = (plan?['goals'] is List
        ? (plan!['goals'] as List).map(jsonMap).toList()
        : <JsonMap>[]);
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _shiftMonth(int delta) async {
    final parts = _month.split('-').map(int.parse).toList();
    final date = DateTime.utc(parts[0], parts[1] + delta, 1);
    setState(
      () => _month =
          '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}',
    );
    await _load();
  }

  Future<void> _save() async {
    if (_title.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Give this monthly plan a title.')),
      );
      return;
    }
    setState(() => _saving = true);
    final plans = await ref
        .read(localDatabaseProvider)
        .getRecords('monthlyPlans');
    final previous = plans.where((item) => item['month'] == _month).firstOrNull;
    final now = DateTime.now().millisecondsSinceEpoch;
    final completed = _goals.where((goal) => goal['completed'] == true).length;
    await ref.read(localDatabaseProvider).putLocalRecord('monthlyPlans', {
      ...?previous,
      'id': previous?['id'] ?? 'month-$_month',
      'month': _month,
      'title': _title.text.trim(),
      'prompt': _prompt.text.trim(),
      'academicPriorities': _academic.text.trim(),
      'editingTargets': _editing.text.trim(),
      'commitments': _commitments.text.trim(),
      'goals': _goals,
      'completionPercentage': _goals.isEmpty
          ? 0
          : (completed / _goals.length * 100).round(),
      'status': previous?['status'] ?? 'active',
      'createdAt': jsonInt(previous?['createdAt'], now),
      'updatedAt': now,
      'deleted': false,
    });
    invalidatePlanningViews(ref);
    if (mounted) setState(() => _saving = false);
  }

  void _addGoal() {
    final text = _goalInput.text.trim();
    if (text.isEmpty) return;
    setState(() {
      _goals.add({
        'id': '${DateTime.now().microsecondsSinceEpoch}',
        'text': text,
        'completed': false,
      });
      _goalInput.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final parts = _month.split('-').map(int.parse).toList();
    final monthTitle = DateTime(parts[0], parts[1]).month;
    final monthLabel = '${_month} · ${_monthName(monthTitle)} ${parts[0]}';
    if (_loading) return const Center(child: CircularProgressIndicator());
    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 12, 18, 28),
      children: [
        Card(
          child: Row(
            children: [
              IconButton(
                onPressed: () => _shiftMonth(-1),
                icon: const Icon(Icons.chevron_left),
              ),
              Expanded(
                child: Center(
                  child: Text(
                    monthLabel,
                    style: Theme.of(context).textTheme.titleMedium
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
              ),
              IconButton(
                onPressed: () => _shiftMonth(1),
                icon: const Icon(Icons.chevron_right),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _title,
          decoration: const InputDecoration(labelText: 'Monthly focus'),
        ),
        const SizedBox(height: 10),
        _PlanField(controller: _prompt, label: 'Monthly prompt', minLines: 3),
        const SizedBox(height: 10),
        _PlanField(controller: _academic, label: 'Academic priorities'),
        const SizedBox(height: 10),
        _PlanField(
          controller: _editing,
          label: 'Editing and deep-work targets',
        ),
        const SizedBox(height: 10),
        _PlanField(
          controller: _commitments,
          label: 'Commitments and deadlines',
        ),
        const SizedBox(height: 18),
        Text(
          'Goals',
          style: Theme.of(context).textTheme.titleMedium
              ?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _goalInput,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _addGoal(),
                decoration: const InputDecoration(hintText: 'Add a goal'),
              ),
            ),
            const SizedBox(width: 8),
            IconButton.filled(
              onPressed: _addGoal,
              icon: const Icon(Icons.add),
              tooltip: 'Add goal',
            ),
          ],
        ),
        for (var i = 0; i < _goals.length; i++)
          CheckboxListTile(
            value: _goals[i]['completed'] == true,
            onChanged: (value) => setState(
              () => _goals[i] = {..._goals[i], 'completed': value == true},
            ),
            title: Text(_goals[i]['text']?.toString() ?? ''),
            secondary: IconButton(
              onPressed: () => setState(() => _goals.removeAt(i)),
              icon: const Icon(Icons.close),
              tooltip: 'Remove goal',
            ),
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: EdgeInsets.zero,
          ),
        const SizedBox(height: 14),
        FilledButton.icon(
          onPressed: _saving ? null : _save,
          icon: const Icon(Icons.save_outlined),
          label: Text(_saving ? 'Saving…' : 'Save monthly plan'),
        ),
      ],
    );
  }
}

class _PlanField extends StatelessWidget {
  const _PlanField({
    required this.controller,
    required this.label,
    this.minLines = 2,
  });
  final TextEditingController controller;
  final String label;
  final int minLines;
  @override
  Widget build(BuildContext context) => TextField(
    controller: controller,
    minLines: minLines,
    maxLines: minLines + 5,
    decoration: InputDecoration(labelText: label),
  );
}

String _monthName(int month) => const [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
][month - 1];
