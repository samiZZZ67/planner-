import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date/planner_dates.dart';
import '../../core/models/planner_models.dart';
import '../../core/providers.dart';

class AssistantScreen extends ConsumerStatefulWidget {
  const AssistantScreen({super.key});
  @override
  ConsumerState<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantScreenState extends ConsumerState<AssistantScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final List<JsonMap> _messages = [];
  bool _loading = true, _sending = false;
  String _assistant = 'sams_ai';
  String _conversationId = DateTime.now().millisecondsSinceEpoch.toString();
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadHistory();
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  String _message(Object error) => error is DioException
      ? ((error.response?.data is Map
                ? (error.response?.data as Map)['error']?.toString()
                : null) ??
            error.message ??
            'The assistant request failed.')
      : error.toString();
  String _id() => DateTime.now().microsecondsSinceEpoch.toString();

  Future<void> _loadHistory() async {
    setState(() {
      _loading = true;
      _error = null;
      _messages.clear();
    });
    try {
      final response = await ref
          .read(apiClientProvider)
          .dio
          .get<Map<String, dynamic>>(
            '/api/ai/history',
            queryParameters: {'assistant': _assistant},
          );
      final data = response.data ?? {};
      final conversations = (data['conversations'] as List? ?? [])
          .map(jsonMap)
          .toList();
      if (conversations.isNotEmpty) {
        final conversation = conversations.first;
        _conversationId = conversation['id']?.toString() ?? _id();
        if (_assistant == 'freellm') {
          _messages.addAll(
            (conversation['messages'] as List? ?? []).map(jsonMap),
          );
        } else {
          final byConversation = jsonMap(data['messages']);
          _messages.addAll(
            (byConversation[_conversationId] as List? ?? []).map(jsonMap),
          );
        }
      } else {
        _conversationId = _id();
      }
    } catch (error) {
      _error = _message(error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _saveHistory() async {
    final api = ref.read(apiClientProvider).dio;
    final now = DateTime.now().millisecondsSinceEpoch;
    final title =
        _messages
            .firstWhere(
              (m) => m['role'] == 'user',
              orElse: () => {'content': 'New conversation'},
            )['content']
            ?.toString() ??
        'New conversation';
    final conversation = {
      'id': _conversationId,
      'title': title.length > 64 ? '${title.substring(0, 61)}…' : title,
      'updatedAt': now,
      'createdAt': now,
    };
    if (_assistant == 'freellm') {
      await api.post<void>(
        '/api/ai/history',
        data: {
          'assistant': 'freellm',
          'action': 'save_conversation',
          'conversation': {...conversation, 'messages': _messages},
        },
      );
    } else {
      await api.post<void>(
        '/api/ai/history',
        data: {
          'assistant': 'sams_ai',
          'action': 'save_conversation',
          'conversation': conversation,
        },
      );
      for (final message in _messages) {
        await api.post<void>(
          '/api/ai/history',
          data: {
            'assistant': 'sams_ai',
            'action': 'save_message',
            'message': message,
          },
        );
      }
    }
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    final user = {
      'id': _id(),
      'conversationId': _conversationId,
      'role': 'user',
      'content': text,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    };
    setState(() {
      _messages.add(user);
      _input.clear();
      _sending = true;
      _error = null;
    });
    try {
      JsonMap? contextData;
      if (_assistant == 'sams_ai') {
        final date = traditionalDayKey();
        final db = ref.read(localDatabaseProvider);
        final tasks = await db.getRecords('tasks', dateKey: date);
        final sections = await db.getRecords('sections');
        contextData = {
          'currentDate': date,
          'todayTasks': tasks.where((e) => e['deleted'] != true).toList(),
          'sections': sections.where((e) => e['deleted'] != true).toList(),
        };
      }
      final response = await ref
          .read(apiClientProvider)
          .dio
          .post<Map<String, dynamic>>(
            _assistant == 'freellm' ? '/api/ai/freellm/chat' : '/api/ai/chat',
            data: {
              'messages': _messages
                  .map((m) => {'role': m['role'], 'content': m['content']})
                  .toList(),
              if (contextData != null) 'context': contextData,
              'stream': false,
            },
            options: Options(receiveTimeout: const Duration(minutes: 2)),
          );
      final content =
          jsonMap(response.data?['message'])['content']?.toString() ??
          'The assistant returned an empty reply.';
      final assistantMessage = {
        'id': _id(),
        'conversationId': _conversationId,
        'role': 'assistant',
        'content': content,
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      };
      if (mounted) setState(() => _messages.add(assistantMessage));
      await _saveHistory();
      if (_assistant == 'sams_ai' &&
          (response.data?['actions'] as List? ?? []).isNotEmpty) {
        await ref.read(syncControllerProvider.notifier).sync();
        ref.invalidate(allTasksProvider);
      }
      if (mounted)
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (_scroll.hasClients)
            _scroll.animateTo(
              _scroll.position.maxScrollExtent,
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOut,
            );
        });
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _newConversation() => setState(() {
    _conversationId = _id();
    _messages.clear();
    _error = null;
  });

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(18, 14, 18, 6),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  'Assistant',
                  style: Theme.of(context).textTheme.headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              DropdownButton<String>(
                value: _assistant,
                underline: const SizedBox.shrink(),
                items: const [
                  DropdownMenuItem(value: 'sams_ai', child: Text("Sam's AI")),
                  DropdownMenuItem(value: 'freellm', child: Text('Moon AI')),
                ],
                onChanged: (value) {
                  if (value != null) setState(() => _assistant = value);
                  _loadHistory();
                },
              ),
              IconButton(
                onPressed: _newConversation,
                icon: const Icon(Icons.add_comment_outlined),
                tooltip: 'New conversation',
              ),
            ],
          ),
        ),
        Expanded(
          child: _messages.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      _error ??
                          (_assistant == 'sams_ai'
                              ? 'Ask about your plan, progress, or next task.'
                              : 'Ask a question or request an image or video from Moon AI.'),
                      textAlign: TextAlign.center,
                    ),
                  ),
                )
              : ListView.builder(
                  controller: _scroll,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 8,
                  ),
                  itemCount: _messages.length,
                  itemBuilder: (context, index) {
                    final message = _messages[index];
                    final user = message['role'] == 'user';
                    return Align(
                      alignment: user
                          ? Alignment.centerRight
                          : Alignment.centerLeft,
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 10),
                        padding: const EdgeInsets.all(13),
                        constraints: const BoxConstraints(maxWidth: 360),
                        decoration: BoxDecoration(
                          color: user
                              ? Theme.of(context).colorScheme.primaryContainer
                              : Theme.of(context)
                                    .colorScheme
                                    .surfaceContainerHighest,
                          borderRadius: BorderRadius.circular(18),
                        ),
                        child: SelectableText(
                          message['content']?.toString() ?? '',
                        ),
                      ),
                    );
                  },
                ),
        ),
        if (_sending) const LinearProgressIndicator(),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: TextField(
                    controller: _input,
                    minLines: 1,
                    maxLines: 5,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(
                      hintText: 'Message the assistant',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  onPressed: _sending ? null : _send,
                  icon: const Icon(Icons.send),
                  tooltip: 'Send',
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
