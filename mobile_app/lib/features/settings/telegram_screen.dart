import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/planner_models.dart';
import '../../core/providers.dart';

class TelegramScreen extends ConsumerStatefulWidget {
  const TelegramScreen({super.key});
  @override
  ConsumerState<TelegramScreen> createState() => _TelegramScreenState();
}

class _TelegramScreenState extends ConsumerState<TelegramScreen> {
  final _text = TextEditingController();
  final _token = TextEditingController();
  final _chatId = TextEditingController();
  bool _loading = true, _busy = false;
  JsonMap _status = {};
  List<JsonMap> _deliveries = [];
  bool _paused = false;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _text.dispose();
    _token.dispose();
    _chatId.dispose();
    super.dispose();
  }

  String _message(Object error) => error is DioException
      ? ((error.response?.data is Map
                ? (error.response?.data as Map)['error']?.toString()
                : null) ??
            error.message ??
            'Telegram request failed.')
      : error.toString();

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider).dio;
      final results = await Future.wait([
        api.get<Map<String, dynamic>>('/api/telegram/status'),
        api.get<Map<String, dynamic>>('/api/telegram/deliveries'),
        api.get<Map<String, dynamic>>('/api/telegram/automation'),
      ]);
      _status = results[0].data ?? {};
      _deliveries = (results[1].data?['deliveries'] as List? ?? [])
          .map(jsonMap)
          .toList();
      _paused = results[2].data?['paused'] == true;
    } catch (error) {
      _error = _message(error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _saveTelegramConfig() async {
    setState(() => _busy = true);
    try {
      final result = await ref
          .read(apiClientProvider)
          .dio
          .post<Map<String, dynamic>>(
            '/api/telegram/status',
            data: {
              'botToken': _token.text.trim(),
              'chatId': _chatId.text.trim(),
            },
          );
      _status = result.data ?? {};
      _token.clear();
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Telegram configuration updated on the server.'),
          ),
        );
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_message(error))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _send() async {
    final text = _text.text.trim();
    if (text.isEmpty) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Send Telegram message?'),
        content: Text('Send this message to the configured channel?\n\n$text'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Send'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .dio
          .post<Map<String, dynamic>>(
            '/api/telegram/send',
            data: {'text': text},
          );
      _text.clear();
      await _load();
      if (mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Telegram message sent.')));
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_message(error))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toggleAutomation(bool paused) async {
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .dio
          .post<void>('/api/telegram/automation', data: {'paused': paused});
      setState(() => _paused = paused);
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_message(error))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 28),
        children: [
          Text(
            'Telegram',
            style: Theme.of(context).textTheme.headlineSmall
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _status['connected'] == true
                        ? 'Connected'
                        : (_status['configured'] == true
                              ? 'Configured · connection unavailable'
                              : 'Not configured'),
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  if (_status['error'] != null)
                    Text(_status['error'].toString()),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _token,
                    obscureText: true,
                    autocorrect: false,
                    decoration: const InputDecoration(
                      labelText: 'Bot token',
                      helperText: 'Sent to your backend and never saved on this device.',
                    ),
                  ),
                  TextField(
                    controller: _chatId,
                    decoration: const InputDecoration(
                      labelText: 'Channel or chat ID',
                    ),
                  ),
                  const SizedBox(height: 10),
                  FilledButton.tonal(
                    onPressed: _busy ? null : _saveTelegramConfig,
                    child: const Text('Update server configuration'),
                  ),
                ],
              ),
            ),
          ),
          Card(
            child: Column(
              children: [
                SwitchListTile.adaptive(
                  value: _paused,
                  onChanged: _busy ? null : _toggleAutomation,
                  title: const Text('Pause scheduled book posts'),
                  subtitle: const Text(
                    'Controls the backend publishing schedule.',
                  ),
                ),
                const Divider(height: 1),
                Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    children: [
                      TextField(
                        controller: _text,
                        minLines: 2,
                        maxLines: 5,
                        decoration: const InputDecoration(
                          labelText: 'Quick message',
                        ),
                      ),
                      const SizedBox(height: 8),
                      Align(
                        alignment: Alignment.centerRight,
                        child: FilledButton.icon(
                          onPressed: _busy ? null : _send,
                          icon: const Icon(Icons.send),
                          label: const Text('Send to channel'),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'Recent deliveries',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          if (_deliveries.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(14),
                child: Text('No Telegram delivery records.'),
              ),
            ),
          for (final delivery in _deliveries.take(20))
            Card(
              child: ListTile(
                leading: Icon(
                  delivery['status'] == 'sent'
                      ? Icons.check_circle_outline
                      : Icons.info_outline,
                ),
                title: Text(
                  delivery['text']?.toString() ??
                      delivery['type']?.toString() ??
                      'Delivery',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(
                  '${delivery['status'] ?? 'unknown'} · ${delivery['createdAt'] ?? ''}',
                ),
              ),
            ),
        ],
      ),
    );
  }
}
