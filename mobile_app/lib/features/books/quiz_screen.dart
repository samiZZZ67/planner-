import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/planner_models.dart';
import '../../core/providers.dart';

class QuizScreen extends ConsumerStatefulWidget {
  const QuizScreen({super.key, this.assignmentId, this.sessionId});
  final String? assignmentId;
  final String? sessionId;
  @override
  ConsumerState<QuizScreen> createState() => _QuizScreenState();
}

class _QuizScreenState extends ConsumerState<QuizScreen> {
  bool _loading = true, _submitting = false;
  String? _error;
  JsonMap _quiz = {};
  JsonMap? _result;
  String? _resolvedAssignmentId;
  final Map<String, int> _answers = {};

  String get _draftKey =>
      'quizDraft_${widget.assignmentId ?? widget.sessionId ?? 'unknown'}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  String _message(Object error) => error is DioException
      ? ((error.response?.data is Map
                ? (error.response?.data as Map)['error']?.toString()
                : null) ??
            error.message ??
            'Quiz request failed.')
      : error.toString();
  Future<void> _load() async {
    try {
      final query = <String, String>{
        if (widget.assignmentId != null) 'assignmentId': widget.assignmentId!,
        if (widget.sessionId != null) 'sessionId': widget.sessionId!,
      };
      final response = await ref
          .read(apiClientProvider)
          .dio
          .get<Map<String, dynamic>>('/api/quiz', queryParameters: query);
      _quiz = response.data ?? {};
      final assignment = jsonMap(_quiz['assignment']);
      _resolvedAssignmentId =
          widget.assignmentId ?? assignment['id']?.toString();
      final saved = await ref.read(localDatabaseProvider).getMeta(_draftKey);
      if (saved != null) {
        final decoded = jsonDecode(saved);
        if (decoded is Map) {
          for (final entry in decoded.entries) {
            final value = jsonInt(entry.value, -1);
            if (value >= 0) _answers[entry.key.toString()] = value;
          }
        }
      }
    } catch (error) {
      _error = _message(error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _submit() async {
    final assignmentId = _resolvedAssignmentId;
    if (assignmentId == null) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final response = await ref
          .read(apiClientProvider)
          .dio
          .post<Map<String, dynamic>>(
            '/api/quiz',
            data: {'assignmentId': assignmentId, 'answers': _answers},
          );
      await ref.read(localDatabaseProvider).deleteMeta(_draftKey);
      if (mounted) setState(() => _result = jsonMap(response.data));
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _selectAnswer(String questionId, int value) {
    setState(() => _answers[questionId] = value);
    unawaited(
      ref.read(localDatabaseProvider).setMeta(_draftKey, jsonEncode(_answers)),
    );
  }

  void _clearAttempt() {
    setState(() {
      _result = null;
      _answers.clear();
    });
    unawaited(ref.read(localDatabaseProvider).deleteMeta(_draftKey));
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    final assignment = jsonMap(_quiz['assignment']);
    final book = jsonMap(_quiz['book']);
    final questions = (_quiz['questions'] as List? ?? []).map(jsonMap).toList();
    final results = (_result?['results'] as List? ?? []).map(jsonMap).toList();
    if (_error != null && questions.isEmpty)
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton(onPressed: _load, child: const Text('Retry')),
            ],
          ),
        ),
      );
    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 28),
      children: [
        Text(
          'Reading quiz',
          style: Theme.of(context).textTheme.headlineSmall
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        Text(
          '${book['title'] ?? 'Book'} · Day ${assignment['dayNumber'] ?? ''} · pages ${assignment['startPdfPage'] ?? ''}–${assignment['endPdfPage'] ?? ''}',
        ),
        const SizedBox(height: 12),
        if (_result != null)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                'Score ${_result!['score'] ?? 0}% · ${_result!['passed'] == true ? 'Passed' : 'Keep reviewing'}',
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
          ),
        if (questions.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(18),
              child: Text(
                'No quiz questions are available for this assignment yet. Generate its study pack first.',
              ),
            ),
          ),
        for (var index = 0; index < questions.length; index++)
          _QuestionCard(
            index: index,
            question: questions[index],
            selected: _answers[questions[index]['id']?.toString() ?? '$index'],
            result: index < results.length ? results[index] : null,
            onSelect: (value) => _selectAnswer(
              questions[index]['id']?.toString() ?? '$index',
              value,
            ),
          ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.all(8),
            child: Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        if (questions.isNotEmpty &&
            _result == null &&
            _resolvedAssignmentId != null)
          FilledButton.icon(
            onPressed: _submitting ? null : _submit,
            icon: const Icon(Icons.check_circle_outline),
            label: Text(_submitting ? 'Checking answers…' : 'Submit quiz'),
          ),
        if (_result != null)
          OutlinedButton.icon(
            onPressed: _clearAttempt,
            icon: const Icon(Icons.replay),
            label: const Text('Try again'),
          ),
      ],
    );
  }
}

class _QuestionCard extends StatelessWidget {
  const _QuestionCard({
    required this.index,
    required this.question,
    required this.selected,
    required this.result,
    required this.onSelect,
  });
  final int index;
  final JsonMap question;
  final int? selected;
  final JsonMap? result;
  final ValueChanged<int> onSelect;
  @override
  Widget build(BuildContext context) {
    final options = (question['options'] as List? ?? [])
        .map((e) => e.toString())
        .toList();
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Question ${index + 1}',
              style: Theme.of(context).textTheme.labelLarge
                  ?.copyWith(color: Theme.of(context).colorScheme.primary),
            ),
            const SizedBox(height: 6),
            Text(
              question['question']?.toString() ?? '',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            for (var option = 0; option < options.length; option++)
              RadioListTile<int>(
                contentPadding: EdgeInsets.zero,
                dense: true,
                value: option,
                groupValue: selected,
                onChanged: result == null
                    ? (value) {
                        if (value != null) onSelect(value);
                      }
                    : null,
                title: Text(options[option]),
              ),
            if (result != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  '${result['isCorrect'] == true ? 'Correct' : 'Review this answer'} · ${result['explanation'] ?? ''}',
                ),
              ),
          ],
        ),
      ),
    );
  }
}
