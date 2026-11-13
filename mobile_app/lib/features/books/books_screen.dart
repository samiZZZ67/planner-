import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/models/planner_models.dart';
import '../../core/providers.dart';

class BooksScreen extends ConsumerStatefulWidget {
  const BooksScreen({super.key});
  @override
  ConsumerState<BooksScreen> createState() => _BooksScreenState();
}

class _BooksScreenState extends ConsumerState<BooksScreen> {
  List<JsonMap> _books = [];
  final Map<String, List<JsonMap>> _assignments = {};
  bool _loading = true;
  String? _busyBook;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted)
      setState(() {
        _loading = true;
        _error = null;
      });
    try {
      final response = await ref
          .read(apiClientProvider)
          .dio
          .get<Map<String, dynamic>>('/api/books');
      _books = (response.data?['books'] as List? ?? []).map(jsonMap).toList();
    } catch (error) {
      _error = _message(error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _message(Object error) => error is DioException
      ? ((error.response?.data is Map
                ? (error.response?.data as Map)['error']?.toString()
                : null) ??
            error.message ??
            'Could not contact the planner server.')
      : error.toString();

  Future<void> _loadAssignments(String bookId) async {
    try {
      final response = await ref
          .read(apiClientProvider)
          .dio
          .get<Map<String, dynamic>>(
            '/api/books/${Uri.encodeComponent(bookId)}/assignments',
          );
      if (mounted)
        setState(
          () => _assignments[bookId] =
              (response.data?['assignments'] as List? ?? [])
                  .map(jsonMap)
                  .toList(),
        );
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_message(error))));
    }
  }

  Future<void> _uploadBook() async {
    final selected = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf'],
      withData: true,
      allowMultiple: false,
    );
    if (selected == null || selected.files.isEmpty) return;
    final file = selected.files.single;
    if (file.bytes == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('The selected PDF could not be read.')),
      );
      return;
    }
    final title = TextEditingController(
      text: file.name.replaceAll(RegExp(r'\.pdf$', caseSensitive: false), ''),
    );
    final author = TextEditingController();
    final startPage = TextEditingController(text: '1');
    final endPage = TextEditingController();
    final days = TextEditingController(text: '30');
    final minutes = TextEditingController(text: '60');
    final formKey = GlobalKey<FormState>();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Add a book PDF'),
        content: SizedBox(
          width: 460,
          child: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(file.name, maxLines: 2, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: title,
                    decoration: const InputDecoration(labelText: 'Book title'),
                    validator: _required,
                  ),
                  TextFormField(
                    controller: author,
                    decoration: const InputDecoration(labelText: 'Author'),
                    validator: _required,
                  ),
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: startPage,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'Start page',
                          ),
                          validator: _positiveInt,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: TextFormField(
                          controller: endPage,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'End page',
                          ),
                          validator: _positiveInt,
                        ),
                      ),
                    ],
                  ),
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: days,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'Reading days',
                          ),
                          validator: _positiveInt,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: TextFormField(
                          controller: minutes,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'Minutes per day',
                          ),
                          validator: _positiveInt,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (formKey.currentState?.validate() == true)
                Navigator.pop(dialogContext, true);
            },
            child: const Text('Upload'),
          ),
        ],
      ),
    );
    if (accepted != true) return;
    setState(() => _busyBook = 'upload');
    try {
      final form = FormData.fromMap({
        'pdf': MultipartFile.fromBytes(
          file.bytes!,
          filename: file.name,
          contentType: DioMediaType('application', 'pdf'),
        ),
        'title': title.text.trim(),
        'author': author.text.trim(),
        'startPage': startPage.text.trim(),
        'endPage': endPage.text.trim(),
        'currentPage': startPage.text.trim(),
        'durationDays': days.text.trim(),
        'studyMinutes': minutes.text.trim(),
        'startDate': DateTime.now().toIso8601String().substring(0, 10),
        'postingTime': '08:00',
        'timezone': 'Africa/Nairobi',
      });
      await ref
          .read(apiClientProvider)
          .dio
          .post<Map<String, dynamic>>(
            '/api/books',
            data: form,
            options: Options(receiveTimeout: const Duration(minutes: 3)),
          );
      await _load();
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Book uploaded. Select Extract pages to prepare its reading plan.',
            ),
          ),
        );
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_message(error))));
    } finally {
      if (mounted) setState(() => _busyBook = null);
      title.dispose();
      author.dispose();
      startPage.dispose();
      endPage.dispose();
      days.dispose();
      minutes.dispose();
    }
  }

  String? _required(String? value) =>
      (value?.trim().isEmpty ?? true) ? 'Required' : null;
  String? _positiveInt(String? value) =>
      int.tryParse(value ?? '') == null || int.parse(value!) < 1
      ? 'Enter a positive number'
      : null;

  Future<void> _extract(JsonMap book) async {
    final id = book['id'].toString();
    setState(() {
      _busyBook = id;
      _error = null;
    });
    try {
      for (var batch = 0; batch < 40; batch++) {
        final response = await ref
            .read(apiClientProvider)
            .dio
            .post<Map<String, dynamic>>(
              '/api/books/${Uri.encodeComponent(id)}/extract',
              data: {'batchSize': 15},
              options: Options(receiveTimeout: const Duration(minutes: 3)),
            );
        final data = response.data ?? {};
        final updated = jsonMap(data['book']);
        final complete =
            data['isComplete'] == true ||
            ['completed', 'needs_review'].contains(updated['extractionStatus']);
        if (complete || jsonInt(data['batchProcessed']) == 0) break;
      }
      await _load();
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'PDF extraction finished. You can now generate the reading plan.',
            ),
          ),
        );
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_message(error))));
    } finally {
      if (mounted) setState(() => _busyBook = null);
    }
  }

  Future<void> _generatePlan(JsonMap book) async {
    final id = book['id'].toString();
    setState(() => _busyBook = id);
    try {
      await ref
          .read(apiClientProvider)
          .dio
          .post<Map<String, dynamic>>(
            '/api/books/${Uri.encodeComponent(id)}/assignments',
            data: {'sectionsPerDay': 1, 'model': 'auto'},
            options: Options(receiveTimeout: const Duration(minutes: 3)),
          );
      await _loadAssignments(id);
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Reading plan generated.')),
        );
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_message(error))));
    } finally {
      if (mounted) setState(() => _busyBook = null);
    }
  }

  Future<void> _learningPackage(JsonMap book, JsonMap assignment) async {
    final path =
        '/api/books/${Uri.encodeComponent(book['id'].toString())}/assignments/${Uri.encodeComponent(assignment['id'].toString())}/learning-package';
    try {
      final response = await ref
          .read(apiClientProvider)
          .dio
          .get<Map<String, dynamic>>(
            path,
            options: Options(receiveTimeout: const Duration(minutes: 3)),
          );
      final pkg = jsonMap(response.data?['learningPackage']);
      final summary =
          pkg['summary']?.toString() ?? 'Study materials are ready.';
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text('Day ${assignment['dayNumber'] ?? ''} study pack'),
          content: SingleChildScrollView(child: Text(summary)),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Close'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.pop(context);
                context.push(
                  '/quiz?assignmentId=${Uri.encodeComponent(assignment['id'].toString())}',
                );
              },
              child: const Text('Start quiz'),
            ),
          ],
        ),
      );
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_message(error))));
    }
  }

  Future<void> _publish(JsonMap book, JsonMap assignment) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Send this reading assignment?'),
        content: const Text(
          'This sends the approved study content to the configured Telegram channel and marks the assignment as delivered.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Send now'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    final path =
        '/api/books/${Uri.encodeComponent(book['id'].toString())}/assignments/${Uri.encodeComponent(assignment['id'].toString())}/publish';
    try {
      await ref
          .read(apiClientProvider)
          .dio
          .post<Map<String, dynamic>>(
            path,
            data: {'sendNow': true},
            options: Options(receiveTimeout: const Duration(minutes: 2)),
          );
      await _load();
      await _loadAssignments(book['id'].toString());
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Reading assignment sent.')),
        );
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_message(error))));
    }
  }

  Future<void> _setApproved(JsonMap book, JsonMap assignment) async {
    final path =
        '/api/books/${Uri.encodeComponent(book['id'].toString())}/assignments/${Uri.encodeComponent(assignment['id'].toString())}/notes';
    try {
      await ref
          .read(apiClientProvider)
          .dio
          .patch<Map<String, dynamic>>(
            path,
            data: {
              'status': 'approved',
              'studyNotes': assignment['studyNotes'],
            },
          );
      await _loadAssignments(book['id'].toString());
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_message(error))));
    }
  }

  Future<void> _generateNotes(JsonMap book, JsonMap assignment) async {
    final path =
        '/api/books/${Uri.encodeComponent(book['id'].toString())}/assignments/${Uri.encodeComponent(assignment['id'].toString())}/notes';
    try {
      await ref
          .read(apiClientProvider)
          .dio
          .post<Map<String, dynamic>>(
            path,
            data: {'model': 'auto'},
            options: Options(receiveTimeout: const Duration(minutes: 3)),
          );
      await _loadAssignments(book['id'].toString());
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_message(error))));
    }
  }

  Future<void> _downloadPdf(JsonMap book) async {
    try {
      final response = await ref
          .read(apiClientProvider)
          .dio
          .get<List<int>>(
            '/api/books/${Uri.encodeComponent(book['id'].toString())}/pdf',
            options: Options(
              responseType: ResponseType.bytes,
              receiveTimeout: const Duration(minutes: 2),
            ),
          );
      final bytes = response.data;
      if (bytes == null || bytes.isEmpty)
        throw const ApiFailure('The server returned an empty PDF.');
      final title = (book['title']?.toString() ?? 'book')
          .replaceAll(RegExp(r'[^a-zA-Z0-9 _-]'), '')
          .trim();
      final uri = await FilePicker.saveFile(
        fileName: '${title.isEmpty ? 'book' : title}.pdf',
        bytes: Uint8List.fromList(bytes),
        mimeType: 'application/pdf',
      );
      if (uri != null && mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('PDF saved to ${uri.path.isEmpty ? uri : uri.path}'),
          ),
        );
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_message(error))));
    }
  }

  Future<void> _deleteBook(JsonMap book) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete this book?'),
        content: const Text(
          'This removes the uploaded PDF, reading assignments, and delivery history from the server.',
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
    try {
      await ref
          .read(apiClientProvider)
          .dio
          .delete<void>(
            '/api/books/${Uri.encodeComponent(book['id'].toString())}',
          );
      await _load();
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_message(error))));
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
          Row(
            children: [
              Expanded(
                child: Text(
                  'Book planner',
                  style: Theme.of(context).textTheme.headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              FilledButton.icon(
                onPressed: _busyBook == 'upload' ? null : _uploadBook,
                icon: const Icon(Icons.upload_file),
                label: const Text('Add PDF'),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Upload a PDF, extract its pages, build a reading plan, and study with source based quizzes.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          if (_books.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 48),
              child: Center(
                child: Column(
                  children: [
                    const Icon(Icons.menu_book_outlined, size: 48),
                    const SizedBox(height: 10),
                    const Text('No books yet'),
                    const SizedBox(height: 6),
                    const Text('Upload a PDF to start a reading plan.'),
                  ],
                ),
              ),
            ),
          for (final book in _books)
            _BookCard(
              book: book,
              busy: _busyBook == book['id'],
              assignments: _assignments[book['id']?.toString()],
              onExpand: () {
                if (!_assignments.containsKey(book['id']?.toString()))
                  _loadAssignments(book['id'].toString());
              },
              onExtract: () => _extract(book),
              onGeneratePlan: () => _generatePlan(book),
              onStudy: (assignment) => _learningPackage(book, assignment),
              onGenerateNotes: (assignment) => _generateNotes(book, assignment),
              onApprove: (assignment) => _setApproved(book, assignment),
              onQuiz: (assignment) => context.push(
                '/quiz?assignmentId=${Uri.encodeComponent(assignment['id'].toString())}',
              ),
              onPublish: (assignment) => _publish(book, assignment),
              onDownload: () => _downloadPdf(book),
              onDelete: () => _deleteBook(book),
            ),
        ],
      ),
    );
  }
}

class _BookCard extends StatelessWidget {
  const _BookCard({
    required this.book,
    required this.busy,
    required this.assignments,
    required this.onExpand,
    required this.onExtract,
    required this.onGeneratePlan,
    required this.onStudy,
    required this.onApprove,
    required this.onQuiz,
    required this.onPublish,
    required this.onGenerateNotes,
    required this.onDownload,
    required this.onDelete,
  });
  final JsonMap book;
  final bool busy;
  final List<JsonMap>? assignments;
  final VoidCallback onExpand, onExtract, onGeneratePlan;
  final void Function(JsonMap) onStudy, onApprove, onQuiz, onPublish;
  final void Function(JsonMap) onGenerateNotes;
  final VoidCallback onDownload, onDelete;

  @override
  Widget build(BuildContext context) {
    final progress = jsonMap(book['extractionProgress']);
    final status = book['extractionStatus']?.toString() ?? 'pending';
    return Card(
      margin: const EdgeInsets.only(top: 12),
      child: ExpansionTile(
        onExpansionChanged: (expanded) {
          if (expanded) onExpand();
        },
        leading: const Icon(Icons.menu_book_outlined),
        title: Text(
          book['title']?.toString() ?? 'Untitled book',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          '${book['author'] ?? 'Unknown author'} · ${book['currentPage'] ?? book['startPage'] ?? 1} / ${book['endPage'] ?? '?'} · $status',
        ),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        children: [
          if (busy) const LinearProgressIndicator(),
          if (progress.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                book['extractionMessage']?.toString() ??
                    '${progress['completedPages'] ?? 0} of ${progress['totalPages'] ?? 0} pages extracted',
              ),
            ),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed: busy ? null : onExtract,
                icon: const Icon(Icons.document_scanner_outlined),
                label: const Text('Extract pages'),
              ),
              OutlinedButton.icon(
                onPressed: busy ? null : onDownload,
                icon: const Icon(Icons.download_outlined),
                label: const Text('Download PDF'),
              ),
              TextButton.icon(
                onPressed: busy ? null : onDelete,
                icon: const Icon(Icons.delete_outline),
                label: const Text('Delete book'),
              ),
              FilledButton.tonalIcon(
                onPressed:
                    busy || !['completed', 'needs_review'].contains(status)
                    ? null
                    : onGeneratePlan,
                icon: const Icon(Icons.auto_awesome),
                label: const Text('Generate plan'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (assignments == null)
            const Padding(
              padding: EdgeInsets.all(16),
              child: CircularProgressIndicator(),
            )
          else if (assignments!.isEmpty)
            const Text('No reading assignments yet.')
          else
            for (final assignment in assignments!)
              _AssignmentTile(
                assignment: assignment,
                onStudy: () => onStudy(assignment),
                onGenerateNotes: () => onGenerateNotes(assignment),
                onApprove: () => onApprove(assignment),
                onQuiz: () => onQuiz(assignment),
                onPublish: () => onPublish(assignment),
              ),
        ],
      ),
    );
  }
}

class _AssignmentTile extends StatelessWidget {
  const _AssignmentTile({
    required this.assignment,
    required this.onStudy,
    required this.onGenerateNotes,
    required this.onApprove,
    required this.onQuiz,
    required this.onPublish,
  });
  final JsonMap assignment;
  final VoidCallback onStudy, onGenerateNotes, onApprove, onQuiz, onPublish;
  @override
  Widget build(BuildContext context) {
    final status = assignment['status']?.toString() ?? 'draft';
    return Container(
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest
            .withValues(alpha: .45),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Day ${assignment['dayNumber'] ?? '?'} · pages ${assignment['startPdfPage'] ?? '?'}–${assignment['endPdfPage'] ?? '?'} · $status',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          if (assignment['rationale'] != null)
            Text(
              assignment['rationale'].toString(),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
          Wrap(
            spacing: 6,
            children: [
              TextButton.icon(
                onPressed: onStudy,
                icon: const Icon(Icons.menu_book, size: 18),
                label: const Text('Study pack'),
              ),
              TextButton.icon(
                onPressed: onQuiz,
                icon: const Icon(Icons.quiz_outlined, size: 18),
                label: const Text('Quiz'),
              ),
              if (status == 'draft' && assignment['studyNotes'] == null)
                TextButton.icon(
                  onPressed: onGenerateNotes,
                  icon: const Icon(Icons.auto_awesome, size: 18),
                  label: const Text('Make notes'),
                ),
              if (status == 'draft' && assignment['studyNotes'] != null)
                TextButton(onPressed: onApprove, child: const Text('Approve')),
              if (status == 'approved')
                TextButton.icon(
                  onPressed: onPublish,
                  icon: const Icon(Icons.send_outlined, size: 18),
                  label: const Text('Send'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
