import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date/planner_dates.dart';
import '../../core/models/planner_models.dart';
import '../../core/providers.dart';

class NotesScreen extends ConsumerStatefulWidget {
  const NotesScreen({super.key});
  @override
  ConsumerState<NotesScreen> createState() => _NotesScreenState();
}

class _NotesScreenState extends ConsumerState<NotesScreen> {
  late String _date;
  final _note = TextEditingController();
  final _worked = TextEditingController();
  final _blocked = TextEditingController();
  final _change = TextEditingController();
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _date = traditionalDayKey();
    _load();
  }

  @override
  void dispose() {
    _note.dispose();
    _worked.dispose();
    _blocked.dispose();
    _change.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final day = await ref.read(localDatabaseProvider).getRecord('days', _date);
    final sheet = jsonMap(day?['sheetData']);
    final review = jsonMap(day?['review']);
    _note.text = sheet['notes']?.toString() ?? '';
    _worked.text = review['worked']?.toString() ?? '';
    _blocked.text = review['blocked']?.toString() ?? '';
    _change.text = review['change']?.toString() ?? '';
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final db = ref.read(localDatabaseProvider);
    final existing = await db.getRecord('days', _date) ?? <String, dynamic>{};
    final now = DateTime.now().millisecondsSinceEpoch;
    await db.putLocalRecord('days', {
      ...existing,
      'id': _date,
      'date': _date,
      'freeHours': existing['freeHours'] ?? 8.0,
      'review': {
        'worked': _worked.text,
        'blocked': _blocked.text,
        'change': _change.text,
      },
      'sheetData': {...jsonMap(existing['sheetData']), 'notes': _note.text},
      'updatedAt': now,
      'deleted': false,
      'isSample': false,
    });
    invalidatePlanningViews(ref);
    if (mounted) {
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Notes saved on this device.')),
      );
    }
  }

  Future<void> _changeDate(int delta) async {
    setState(() => _date = shiftDateKey(_date, delta));
    await _load();
  }

  @override
  Widget build(BuildContext context) => _loading
      ? const Center(child: CircularProgressIndicator())
      : ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
          children: [
            Text(
              'Notes & reflection',
              style: Theme.of(context).textTheme.headlineSmall
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            Card(
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => _changeDate(-1),
                    icon: const Icon(Icons.chevron_left),
                  ),
                  Expanded(
                    child: Center(
                      child: Text(
                        plannerDateLabel(
                          _date,
                          ref.watch(calendarModeProvider),
                        ),
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => _changeDate(1),
                    icon: const Icon(Icons.chevron_right),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _note,
              minLines: 8,
              maxLines: 18,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Quick note',
                hintText:
                    'Capture an idea, reminder, or observation for this day.',
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'Evening review',
              style: Theme.of(context).textTheme.titleLarge
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 10),
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
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _saving ? null : _save,
              icon: const Icon(Icons.save_outlined),
              label: Text(_saving ? 'Saving…' : 'Save notes'),
            ),
          ],
        );
}
