typedef JsonMap = Map<String, dynamic>;

JsonMap jsonMap(Object? value) {
  if (value is Map<String, dynamic>) return Map<String, dynamic>.from(value);
  if (value is Map)
    return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

int jsonInt(Object? value, [int fallback = 0]) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? fallback;
}

bool jsonBool(Object? value, [bool fallback = false]) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  if (value is String) return value.toLowerCase() == 'true';
  return fallback;
}

/// A section record mirrors the existing web `Section` JSON contract.
class SectionRecord {
  SectionRecord({
    required this.id,
    required this.name,
    required this.color,
    required this.icon,
    required this.order,
    required this.targetType,
    required this.updatedAt,
    this.dailyTargetMinutes,
    this.deleted = false,
    this.isSample = false,
    this.synced = 0,
    this.extra = const {},
  });

  final String id;
  final String name;
  final String color;
  final String icon;
  final int order;
  final String targetType;
  final int updatedAt;
  final int? dailyTargetMinutes;
  final bool deleted;
  final bool isSample;
  final int synced;
  final JsonMap extra;

  factory SectionRecord.fromJson(JsonMap source) {
    final data = Map<String, dynamic>.from(source);
    return SectionRecord(
      id: data.remove('id')?.toString() ?? '',
      name: data.remove('name')?.toString() ?? '',
      color: data.remove('color')?.toString() ?? '#52525b',
      icon: data.remove('icon')?.toString() ?? '•',
      order: jsonInt(data.remove('order')),
      targetType: data.remove('targetType')?.toString() ?? 'at least',
      updatedAt: jsonInt(data.remove('updatedAt')),
      dailyTargetMinutes: data.remove('dailyTargetMinutes') == null
          ? null
          : jsonInt(source['dailyTargetMinutes']),
      deleted: jsonBool(data.remove('deleted')),
      isSample: jsonBool(data.remove('isSample')),
      synced: jsonInt(data.remove('synced')),
      extra: data,
    );
  }

  JsonMap toJson() => {
    ...extra,
    'id': id,
    'name': name,
    'color': color,
    'icon': icon,
    'order': order,
    'targetType': targetType,
    'updatedAt': updatedAt,
    'dailyTargetMinutes': dailyTargetMinutes,
    'deleted': deleted,
    'isSample': isSample,
    'synced': synced,
  };
}

/// A task record retains unrecognized fields so mobile edits round-trip future fields.
class TaskRecord {
  TaskRecord({
    required this.id,
    required this.date,
    required this.sectionId,
    required this.title,
    required this.description,
    required this.strategy,
    required this.doneMeans,
    required this.estimatedMinutes,
    required this.priority,
    required this.mustDo,
    required this.tags,
    required this.icon,
    required this.isCompleted,
    required this.order,
    required this.createdAt,
    required this.updatedAt,
    this.textColor,
    this.image,
    this.completedAt,
    this.deleted = false,
    this.isSample = false,
    this.synced = 0,
    this.extra = const {},
  });

  final String id;
  final String date;
  final String sectionId;
  final String title;
  final String description;
  final String strategy;
  final String doneMeans;
  final int estimatedMinutes;
  final String priority;
  final bool mustDo;
  final List<String> tags;
  final String icon;
  final String? textColor;
  final String? image;
  final bool isCompleted;
  final int? completedAt;
  final int order;
  final int createdAt;
  final int updatedAt;
  final bool deleted;
  final bool isSample;
  final int synced;
  final JsonMap extra;

  factory TaskRecord.fromJson(JsonMap source) {
    final data = Map<String, dynamic>.from(source);
    final tagsValue = data.remove('tags');
    return TaskRecord(
      id: data.remove('id')?.toString() ?? '',
      date: data.remove('date')?.toString() ?? '',
      sectionId: data.remove('sectionId')?.toString() ?? '',
      title: data.remove('title')?.toString() ?? '',
      description: data.remove('description')?.toString() ?? '',
      strategy: data.remove('strategy')?.toString() ?? '',
      doneMeans: data.remove('doneMeans')?.toString() ?? '',
      estimatedMinutes: jsonInt(data.remove('estimatedMinutes')),
      priority: data.remove('priority')?.toString() ?? 'Medium',
      mustDo: jsonBool(data.remove('mustDo')),
      tags: tagsValue is List
          ? tagsValue.map((tag) => tag.toString()).toList()
          : const [],
      icon: data.remove('icon')?.toString() ?? '',
      textColor: data.remove('textColor')?.toString(),
      image: data.remove('image')?.toString(),
      isCompleted: jsonBool(data.remove('isCompleted')),
      completedAt: data.remove('completedAt') == null
          ? null
          : jsonInt(source['completedAt']),
      order: jsonInt(data.remove('order')),
      createdAt: jsonInt(data.remove('createdAt')),
      updatedAt: jsonInt(data.remove('updatedAt')),
      deleted: jsonBool(data.remove('deleted')),
      isSample: jsonBool(data.remove('isSample')),
      synced: jsonInt(data.remove('synced')),
      extra: data,
    );
  }

  JsonMap toJson() => {
    ...extra,
    'id': id,
    'date': date,
    'sectionId': sectionId,
    'title': title,
    'description': description,
    'strategy': strategy,
    'doneMeans': doneMeans,
    'estimatedMinutes': estimatedMinutes,
    'priority': priority,
    'mustDo': mustDo,
    'tags': tags,
    'icon': icon,
    'textColor': textColor,
    'image': image,
    'isCompleted': isCompleted,
    'completedAt': completedAt,
    'order': order,
    'createdAt': createdAt,
    'updatedAt': updatedAt,
    'deleted': deleted,
    'isSample': isSample,
    'synced': synced,
  };
}
