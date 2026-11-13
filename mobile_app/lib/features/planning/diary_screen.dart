import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/date/planner_dates.dart';
import '../../core/models/planner_models.dart';
import '../../core/providers.dart';

const _maxDiaryPhotos = 8;

class DiaryScreen extends ConsumerStatefulWidget {
  const DiaryScreen({super.key});
  @override
  ConsumerState<DiaryScreen> createState() => _DiaryScreenState();
}

class _DiaryScreenState extends ConsumerState<DiaryScreen> {
  final _text = TextEditingController();
  final _picker = ImagePicker();
  late String _date;
  List<JsonMap> _photos = [];
  int _createdAt = 0;
  bool _loading = true;
  bool _saving = false;
  bool _uploading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _date = traditionalDayKey();
    _load();
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final day = await ref.read(localDatabaseProvider).getRecord('days', _date);
    final diary = jsonMap(jsonMap(day?['sheetData'])['diary']);
    _text.text = diary['text']?.toString() ?? '';
    _photos = diary['photos'] is List
        ? (diary['photos'] as List).map(jsonMap).toList()
        : [];
    _createdAt = jsonInt(diary['createdAt']);
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _save({bool quiet = false}) async {
    setState(() => _saving = true);
    final db = ref.read(localDatabaseProvider);
    final existing = await db.getRecord('days', _date) ?? <String, dynamic>{};
    final now = DateTime.now().millisecondsSinceEpoch;
    final sheet = jsonMap(existing['sheetData']);
    await db.putLocalRecord('days', {
      ...existing,
      'id': _date,
      'date': _date,
      'freeHours': existing['freeHours'] ?? 8.0,
      'review': jsonMap(existing['review']).isEmpty
          ? {'worked': '', 'blocked': '', 'change': ''}
          : existing['review'],
      'sheetData': {
        ...sheet,
        'diary': {
          'date': _date,
          'text': _text.text,
          'photos': _photos,
          'createdAt': _createdAt == 0 ? now : _createdAt,
          'updatedAt': now,
        },
      },
      'updatedAt': now,
      'deleted': false,
      'isSample': false,
    });
    invalidatePlanningViews(ref);
    if (mounted) {
      setState(() => _saving = false);
      if (!quiet)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Diary saved on this device.')),
        );
    }
  }

  Future<void> _choosePhoto(ImageSource source) async {
    if (_photos.length >= _maxDiaryPhotos) return;
    setState(() {
      _uploading = true;
      _error = null;
    });
    try {
      final image = await _picker.pickImage(
        source: source,
        imageQuality: 82,
        maxWidth: 1800,
      );
      if (image == null) return;
      final session = ref.read(sessionProvider);
      if (session.status != SessionStatus.signedIn)
        throw const ApiFailure(
          'Sign in before uploading diary photos. Your written entry can still be saved locally.',
        );
      final form = FormData.fromMap({
        'file': await MultipartFile.fromFile(
          image.path,
          filename: image.name,
          contentType: DioMediaType(
            'image',
            image.name.split('.').last.toLowerCase() == 'png' ? 'png' : 'jpeg',
          ),
        ),
        'folder': 'samsspace/diary',
        'tags': 'samsspace,diary',
      });
      final response = await ref
          .read(apiClientProvider)
          .dio
          .post<Map<String, dynamic>>('/api/files', data: form);
      final uploaded = jsonMap(response.data?['file']);
      final url = uploaded['secureUrl']?.toString();
      if (url == null || url.isEmpty)
        throw const ApiFailure(
          'The server did not return the uploaded photo URL.',
        );
      final now = DateTime.now().millisecondsSinceEpoch;
      setState(
        () => _photos.add({
          'id': uploaded['id']?.toString() ?? '${now.toRadixString(36)}',
          'url': url,
          'filename': uploaded['originalFilename']?.toString() ?? image.name,
          'uploadedAt': jsonInt(uploaded['createdAt'], now),
          'width': uploaded['width'],
          'height': uploaded['height'],
        }),
      );
      await _save(quiet: true);
    } catch (error) {
      final message = error is DioException && error.response?.data is Map
          ? (error.response?.data as Map)['error']?.toString() ??
                'Photo upload failed.'
          : error is ApiFailure
          ? error.message
          : 'Photo upload failed: $error';
      if (mounted) setState(() => _error = message);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _removePhoto(JsonMap photo) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove this photo?'),
        content: const Text(
          'This also removes the uploaded file from your account.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remove'),
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
            '/api/files/${Uri.encodeComponent(photo['id'].toString())}',
          );
      setState(() => _photos.removeWhere((item) => item['id'] == photo['id']));
      await _save(quiet: true);
    } catch (error) {
      final message = error is DioException && error.response?.data is Map
          ? (error.response?.data as Map)['error']?.toString() ??
                'Could not delete the uploaded photo.'
          : 'Could not delete the uploaded photo: $error';
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(message)));
    }
  }

  Future<void> _shiftDate(int delta) async {
    setState(() => _date = shiftDateKey(_date, delta));
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 30),
      children: [
        Text(
          'Diary',
          style: Theme.of(context).textTheme.headlineSmall
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 12),
        Card(
          child: Row(
            children: [
              IconButton(
                onPressed: () => _shiftDate(-1),
                icon: const Icon(Icons.chevron_left),
              ),
              Expanded(
                child: Center(
                  child: Text(
                    plannerDateLabel(_date, ref.watch(calendarModeProvider)),
                    style: Theme.of(context).textTheme.titleMedium
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
              ),
              IconButton(
                onPressed: () => _shiftDate(1),
                icon: const Icon(Icons.chevron_right),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _text,
          minLines: 8,
          maxLines: 18,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(
            labelText: 'What do you want to remember about this day?',
            hintText: 'Write your entry…',
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _uploading || _photos.length >= _maxDiaryPhotos
                    ? null
                    : () => _choosePhoto(ImageSource.gallery),
                icon: const Icon(Icons.photo_library_outlined),
                label: Text(_uploading ? 'Uploading…' : 'Add photo'),
              ),
            ),
            const SizedBox(width: 9),
            IconButton.filledTonal(
              onPressed: _uploading || _photos.length >= _maxDiaryPhotos
                  ? null
                  : () => _choosePhoto(ImageSource.camera),
              icon: const Icon(Icons.camera_alt_outlined),
              tooltip: 'Take photo',
            ),
          ],
        ),
        if (_photos.isNotEmpty) ...[
          const SizedBox(height: 10),
          GridView.builder(
            itemCount: _photos.length,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 3,
              crossAxisSpacing: 8,
              mainAxisSpacing: 8,
            ),
            itemBuilder: (context, index) {
              final photo = _photos[index];
              return Stack(
                fit: StackFit.expand,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(14),
                    child: Image.network(
                      photo['url']?.toString() ?? '',
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => const ColoredBox(
                        color: Colors.black12,
                        child: Icon(Icons.broken_image_outlined),
                      ),
                    ),
                  ),
                  Positioned(
                    right: 4,
                    top: 4,
                    child: IconButton.filledTonal(
                      onPressed: () => _removePhoto(photo),
                      icon: const Icon(Icons.close, size: 17),
                      tooltip: 'Remove photo',
                    ),
                  ),
                ],
              );
            },
          ),
        ],
        if (_error != null) ...[
          const SizedBox(height: 8),
          Text(
            _error!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ],
        const SizedBox(height: 16),
        FilledButton.icon(
          onPressed: _saving ? null : _save,
          icon: const Icon(Icons.save_outlined),
          label: Text(_saving ? 'Saving…' : 'Save diary entry'),
        ),
        const SizedBox(height: 8),
        Text(
          '${_photos.length} / $_maxDiaryPhotos photos · Text is saved offline; photos need a connection.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.labelSmall
              ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      ],
    );
  }
}
