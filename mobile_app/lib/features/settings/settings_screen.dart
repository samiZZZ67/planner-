import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/providers.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});
  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _apiUrl = TextEditingController();
  String _calendarMode = 'ethiopian';
  bool _loaded = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _apiUrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final db = ref.read(localDatabaseProvider);
    _apiUrl.text =
        await db.getMeta('apiBaseUrl') ??
        ref
            .read(apiClientProvider)
            .dio
            .options
            .baseUrl
            .replaceAll('https://invalid.invalid', '');
    _calendarMode = await db.getMeta('calendarMode') ?? 'ethiopian';
    if (mounted) setState(() => _loaded = true);
  }

  Future<void> _saveApiUrl() async {
    try {
      final api = ref.read(apiClientProvider);
      api.configureBaseUrl(_apiUrl.text);
      await ref
          .read(localDatabaseProvider)
          .setMeta('apiBaseUrl', api.dio.options.baseUrl);
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('API URL saved on this device.')),
        );
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _setCalendarMode(String value) async {
    setState(() => _calendarMode = value);
    await ref.read(calendarModeProvider.notifier).setMode(value);
    if (mounted)
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Calendar preference saved.')),
      );
  }

  Future<void> _export() async {
    setState(() => _busy = true);
    try {
      final data = await ref.read(localDatabaseProvider).exportRecords();
      final payload = {
        'appName': "Sam'Space",
        'version': 1,
        'exportedAt': DateTime.now().toUtc().toIso8601String(),
        'data': data,
      };
      final bytes = Uint8List.fromList(
        utf8.encode(const JsonEncoder.withIndent('  ').convert(payload)),
      );
      final uri = await FilePicker.saveFile(
        fileName:
            'samsspace-export-${DateTime.now().toIso8601String().substring(0, 10)}.json',
        bytes: bytes,
        mimeType: 'application/json',
        dialogTitle: 'Save Sam\'Space backup',
      );
      if (uri != null && mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Backup saved to ${uri.path.isEmpty ? uri : uri.path}',
            ),
          ),
        );
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not export data: $error')),
        );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _import() async {
    final result = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['json'],
      withData: true,
      allowMultiple: false,
    );
    if (result == null || result.files.isEmpty) return;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Import planner backup?'),
        content: const Text(
          'Matching record IDs on this device will be replaced with the imported copies. Existing server data is unchanged until the next sync.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Import'),
          ),
        ],
      ),
    );
    if (accepted != true) return;
    setState(() => _busy = true);
    try {
      final file = result.files.single;
      final raw = file.bytes != null
          ? utf8.decode(file.bytes!)
          : await File(file.path!).readAsString();
      final root = jsonDecode(raw);
      if (root is! Map || root['data'] is! Map)
        throw const FormatException('This file is not a Sam\'Space backup.');
      final data = (root['data'] as Map).map(
        (key, value) => MapEntry(key.toString(), value),
      );
      final db = ref.read(localDatabaseProvider);
      for (final collection in const [
        'sections',
        'tasks',
        'timeLogs',
        'days',
        'weeklyPlans',
        'monthlyPlans',
      ]) {
        final records = data[collection];
        if (records is List) await db.putImportedRecords(collection, records);
      }
      invalidatePlanningViews(ref);
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Backup imported. Changes are saved locally and queued for sync.',
            ),
          ),
        );
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not import this backup: $error')),
        );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _logout() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text(
          'Your local planner data remains on this device. Pending changes will wait until you sign in again.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (ok == true) await ref.read(sessionProvider.notifier).logout();
  }

  @override
  Widget build(BuildContext context) {
    final themeMode = ref.watch(themeModeProvider);
    final session = ref.watch(sessionProvider);
    final sync = ref.watch(syncControllerProvider);
    if (!_loaded) return const Center(child: CircularProgressIndicator());
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
      children: [
        Text(
          'Settings',
          style: Theme.of(context).textTheme.headlineSmall
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 14),
        Card(
          child: Column(
            children: [
              SwitchListTile.adaptive(
                value: themeMode == ThemeMode.dark,
                onChanged: (_) => ref.read(themeModeProvider.notifier).toggle(),
                title: const Text('Dark theme'),
                subtitle: const Text('Use Sam\'Space obsidian glass styling'),
                secondary: const Icon(Icons.dark_mode_outlined),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.calendar_month_outlined),
                title: const Text('Calendar mode'),
                subtitle: Text(
                  _calendarMode == 'ethiopian'
                      ? 'Ethiopian date labels · planning day starts at 06:00 Addis Ababa'
                      : 'Gregorian date labels · planning day starts at 06:00 Addis Ababa',
                ),
                trailing: DropdownButton<String>(
                  value: _calendarMode,
                  underline: const SizedBox.shrink(),
                  items: const [
                    DropdownMenuItem(
                      value: 'ethiopian',
                      child: Text('Ethiopian'),
                    ),
                    DropdownMenuItem(
                      value: 'gregorian',
                      child: Text('Gregorian'),
                    ),
                  ],
                  onChanged: (value) {
                    if (value != null) _setCalendarMode(value);
                  },
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        Text(
          'Cloud sync',
          style: Theme.of(context).textTheme.titleLarge
              ?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  session.status == SessionStatus.signedIn
                      ? (session.offline
                            ? 'Signed in · currently offline'
                            : 'Signed in to the planner')
                      : 'Not signed in',
                  style: Theme.of(context).textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 4),
                Text(
                  sync.syncing
                      ? 'Syncing…'
                      : sync.offline
                      ? (sync.error ?? 'Waiting for a connection')
                      : '${sync.pending} changes waiting to sync',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
                if (sync.lastSyncedAt != null)
                  Text(
                    'Last sync: ${sync.lastSyncedAt}',
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                const SizedBox(height: 14),
                TextField(
                  controller: _apiUrl,
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    labelText: 'Planner API URL',
                    hintText: 'https://your-planner.example.com',
                  ),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _saveApiUrl,
                  icon: const Icon(Icons.link),
                  label: const Text('Save API URL'),
                ),
                const SizedBox(height: 8),
                FilledButton.tonalIcon(
                  onPressed: sync.syncing
                      ? null
                      : () => ref.read(syncControllerProvider.notifier).sync(),
                  icon: const Icon(Icons.sync),
                  label: const Text('Sync now'),
                ),
                if (session.status == SessionStatus.signedIn) ...[
                  const SizedBox(height: 8),
                  TextButton.icon(
                    onPressed: _logout,
                    icon: const Icon(Icons.logout),
                    label: const Text('Sign out'),
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        Text(
          'Your data',
          style: Theme.of(context).textTheme.titleLarge
              ?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        Card(
          child: Column(
            children: [
              ListTile(
                leading: const Icon(Icons.file_upload_outlined),
                title: const Text('Export backup'),
                subtitle: const Text(
                  'Save tasks, plans, notes, and categories as JSON',
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: _busy ? null : _export,
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.file_download_outlined),
                title: const Text('Import backup'),
                subtitle: const Text(
                  'Read the existing Sam\'Space web export format',
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: _busy ? null : _import,
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Text(
          'Server API keys, database credentials, and Telegram bot secrets stay on the backend.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.labelSmall
              ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      ],
    );
  }
}
