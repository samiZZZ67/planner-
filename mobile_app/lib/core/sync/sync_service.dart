import '../database/local_database.dart';
import '../models/planner_models.dart';
import '../network/api_client.dart';

class SyncSummary {
  const SyncSummary({
    required this.pendingCount,
    required this.syncedAt,
    required this.serverSequence,
  });
  final int pendingCount;
  final DateTime syncedAt;
  final int serverSequence;
}

class SyncService {
  SyncService(this._api, this._database);
  final ApiClient _api;
  final LocalDatabase _database;
  Future<SyncSummary>? _inFlight;

  Future<SyncSummary> sync() {
    final active = _inFlight;
    if (active != null) return active;
    final operation = _syncOnce();
    _inFlight = operation;
    return operation.whenComplete(() => _inFlight = null);
  }

  Future<SyncSummary> _syncOnce() async {
    if (!_api.isConfigured)
      throw const ApiFailure('Set the planner API URL to sync your data.');
    final payload = <String, dynamic>{
      'lastServerSeq':
          int.tryParse(await _database.getMeta('lastServerSeq') ?? '') ?? 0,
    };
    for (final collection in syncCollections) {
      payload[collection] = await _database.getDirtyRecords(collection);
    }

    try {
      final response = await _api.dio.post<Map<String, dynamic>>(
        '/api/sync',
        data: payload,
      );
      final body = response.data;
      if (body == null || body['ok'] != true || body['serverChanges'] is! Map) {
        throw const ApiFailure(
          'The sync response was incomplete. No local records were cleared.',
        );
      }
      final acknowledged = jsonMap(body['acknowledgedIds']);
      final changes = jsonMap(body['serverChanges']);
      for (final collection in syncCollections) {
        final ids = acknowledged[collection];
        if (ids is List) await _database.markSynced(collection, ids);
        final incoming = changes[collection];
        if (incoming is List)
          await _database.applyRemoteRecords(collection, incoming);
      }
      final sequence = jsonInt(body['currentServerSeq']);
      await _database.setMeta('lastServerSeq', sequence.toString());
      final now = DateTime.now();
      await _database.setMeta(
        'lastSyncedAt',
        now.millisecondsSinceEpoch.toString(),
      );
      return SyncSummary(
        pendingCount: await _database.countDirty(),
        syncedAt: now,
        serverSequence: sequence,
      );
    } catch (error) {
      if (error is ApiFailure) rethrow;
      throw apiFailureFrom(error);
    }
  }
}
