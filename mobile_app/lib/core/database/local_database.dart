import 'dart:convert';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../models/planner_models.dart';

const syncCollections = <String>[
  'sections',
  'tasks',
  'timeLogs',
  'days',
  'weeklyPlans',
  'monthlyPlans',
];

class LocalDatabase {
  LocalDatabase._(this._db);

  final Database _db;
  static const _dbName = 'sams_space_mobile.db';

  static Future<LocalDatabase> open() async {
    final root = await getDatabasesPath();
    final db = await openDatabase(
      p.join(root, _dbName),
      version: 1,
      onCreate: (database, version) async {
        await database.execute('''
          CREATE TABLE planner_records (
            collection TEXT NOT NULL,
            id TEXT NOT NULL,
            date_key TEXT NOT NULL DEFAULT '',
            updated_at INTEGER NOT NULL DEFAULT 0,
            deleted INTEGER NOT NULL DEFAULT 0,
            synced INTEGER NOT NULL DEFAULT 0,
            data TEXT NOT NULL,
            PRIMARY KEY (collection, id)
          )
        ''');
        await database.execute(
          'CREATE INDEX idx_planner_records_date ON planner_records(collection, date_key, deleted)',
        );
        await database.execute(
          'CREATE INDEX idx_planner_records_dirty ON planner_records(collection, synced)',
        );
        await database.execute('''
          CREATE TABLE app_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          )
        ''');
      },
    );
    final local = LocalDatabase._(db);
    await local.seedSectionsIfEmpty();
    return local;
  }

  Future<void> close() => _db.close();

  Future<void> seedSectionsIfEmpty() async {
    final existing = await getRecords('sections');
    if (existing.isNotEmpty) return;
    const defaults = <Map<String, Object?>>[
      {
        'name': 'Entertainment',
        'color': '#ffffff',
        'icon': '🎮',
        'dailyTargetMinutes': 120,
        'targetType': 'at most',
      },
      {
        'name': 'Deep Work',
        'color': '#e4e4e7',
        'icon': '⚡',
        'dailyTargetMinutes': 180,
        'targetType': 'at least',
      },
      {
        'name': 'Learning',
        'color': '#d4d4d8',
        'icon': '📚',
        'dailyTargetMinutes': 60,
        'targetType': 'at least',
      },
      {
        'name': 'Health',
        'color': '#a1a1aa',
        'icon': '🏃',
        'dailyTargetMinutes': 45,
        'targetType': 'at least',
      },
      {
        'name': 'Rest',
        'color': '#71717a',
        'icon': '🌙',
        'dailyTargetMinutes': 60,
        'targetType': 'at least',
      },
      {
        'name': 'Other',
        'color': '#52525b',
        'icon': '📌',
        'dailyTargetMinutes': null,
        'targetType': 'at least',
      },
    ];
    final now = DateTime.now().millisecondsSinceEpoch;
    for (var i = 0; i < defaults.length; i++) {
      await putLocalRecord('sections', {
        ...defaults[i],
        'id': 'default-sec-${i + 1}',
        'order': i,
        'updatedAt': now,
        'deleted': false,
        'isSample': false,
        'synced': 0,
      });
    }
  }

  Future<List<JsonMap>> getRecords(String collection, {String? dateKey}) async {
    final rows = await _db.query(
      'planner_records',
      where: dateKey == null
          ? 'collection = ?'
          : 'collection = ? AND date_key = ?',
      whereArgs: dateKey == null ? [collection] : [collection, dateKey],
      orderBy: 'updated_at ASC',
    );
    return rows
        .map((row) => jsonMap(jsonDecode(row['data']! as String)))
        .toList();
  }

  Future<JsonMap?> getRecord(String collection, String id) async {
    final rows = await _db.query(
      'planner_records',
      where: 'collection = ? AND id = ?',
      whereArgs: [collection, id],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return jsonMap(jsonDecode(rows.first['data']! as String));
  }

  Future<List<JsonMap>> getDirtyRecords(String collection) async {
    final rows = await _db.query(
      'planner_records',
      where: 'collection = ? AND synced = 0',
      whereArgs: [collection],
      orderBy: 'updated_at ASC',
    );
    return rows
        .map((row) => jsonMap(jsonDecode(row['data']! as String)))
        .toList();
  }

  Future<int> countDirty() async {
    final result = await _db.rawQuery(
      'SELECT COUNT(*) AS count FROM planner_records WHERE synced = 0',
    );
    return (result.first['count'] as int?) ?? 0;
  }

  Future<void> putLocalRecord(String collection, JsonMap record) async {
    final data = Map<String, dynamic>.from(record);
    final id = data['id']?.toString();
    if (id == null || id.isEmpty)
      throw ArgumentError('A $collection record needs an id.');
    data['synced'] = 0;
    await _writeRecord(collection, data);
  }

  Future<void> putImportedRecords(
    String collection,
    List<dynamic> records,
  ) async {
    await _db.transaction((txn) async {
      for (final raw in records) {
        final record = jsonMap(raw);
        if (record['id'] == null) continue;
        record['synced'] = 0;
        await _writeRecord(collection, record, executor: txn);
      }
    });
  }

  Future<void> applyRemoteRecords(
    String collection,
    List<dynamic> remoteRecords,
  ) async {
    await _db.transaction((txn) async {
      for (final raw in remoteRecords) {
        final remote = jsonMap(raw);
        final id = remote['id']?.toString();
        if (id == null || id.isEmpty) continue;
        final rows = await txn.query(
          'planner_records',
          where: 'collection = ? AND id = ?',
          whereArgs: [collection, id],
          limit: 1,
        );
        final local = rows.isEmpty
            ? null
            : jsonMap(jsonDecode(rows.first['data']! as String));
        final localIsNewerAndDirty =
            local != null &&
            jsonInt(local['synced']) == 0 &&
            jsonInt(local['updatedAt']) > jsonInt(remote['updatedAt']);
        if (localIsNewerAndDirty) continue;
        remote['synced'] = 1;
        await _writeRecord(collection, remote, executor: txn);
      }
    });
  }

  Future<void> markSynced(String collection, List<dynamic> ids) async {
    final batch = _db.batch();
    for (final rawId in ids) {
      final id = rawId.toString();
      final rows = await _db.query(
        'planner_records',
        where: 'collection = ? AND id = ?',
        whereArgs: [collection, id],
        limit: 1,
      );
      if (rows.isEmpty) continue;
      final data = jsonMap(jsonDecode(rows.first['data']! as String));
      data['synced'] = 1;
      batch.update(
        'planner_records',
        {'synced': 1, 'data': jsonEncode(data)},
        where: 'collection = ? AND id = ?',
        whereArgs: [collection, id],
      );
    }
    await batch.commit(noResult: true);
  }

  Future<String?> getMeta(String key) async {
    final rows = await _db.query(
      'app_meta',
      where: 'key = ?',
      whereArgs: [key],
      limit: 1,
    );
    return rows.isEmpty ? null : rows.first['value']?.toString();
  }

  Future<void> setMeta(String key, String value) async {
    await _db.insert('app_meta', {
      'key': key,
      'value': value,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<void> deleteMeta(String key) async {
    await _db.delete('app_meta', where: 'key = ?', whereArgs: [key]);
  }

  Future<Map<String, List<JsonMap>>> exportRecords() async {
    final result = <String, List<JsonMap>>{};
    for (final collection in syncCollections) {
      result[collection] = await getRecords(collection);
    }
    return result;
  }

  Future<void> _writeRecord(
    String collection,
    JsonMap record, {
    DatabaseExecutor? executor,
  }) async {
    final data = Map<String, dynamic>.from(record);
    final database = executor ?? _db;
    final dateKey = (data['date'] ?? data['month'] ?? data['startDate'] ?? '')
        .toString();
    await database.insert('planner_records', {
      'collection': collection,
      'id': data['id'].toString(),
      'date_key': dateKey,
      'updated_at': jsonInt(data['updatedAt']),
      'deleted': jsonBool(data['deleted']) ? 1 : 0,
      'synced': jsonInt(data['synced']),
      'data': jsonEncode(data),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }
}
