String toDateKey(DateTime date) =>
    '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

/// Sam'Space starts its Ethiopian planning day at 06:00 in Addis Ababa (UTC+3).
String traditionalDayKey([DateTime? now]) {
  final eastAfrica = (now ?? DateTime.now()).toUtc().add(
    const Duration(hours: 3),
  );
  final planningDate = DateTime.utc(
    eastAfrica.year,
    eastAfrica.month,
    eastAfrica.day,
  ).subtract(eastAfrica.hour < 6 ? const Duration(days: 1) : Duration.zero);
  return toDateKey(planningDate);
}

DateTime dateFromKey(String value) {
  final parts = value.split('-').map(int.parse).toList();
  return DateTime.utc(parts[0], parts[1], parts[2]);
}

String shiftDateKey(String value, int days) =>
    toDateKey(dateFromKey(value).add(Duration(days: days)));

const _ethiopianMonths = <String>[
  'Meskerem',
  'Tikimt',
  'Hidar',
  'Tahsas',
  'Tir',
  'Yakatit',
  'Magabit',
  'Miyazya',
  'Ginbot',
  'Sene',
  'Hamle',
  'Nehase',
  'Pagume',
];

int _gregorianToJdn(int year, int month, int day) {
  final a = ((14 - month) / 12).floor();
  final y = year + 4800 - a;
  final m = month + 12 * a - 3;
  return day +
      ((153 * m + 2) / 5).floor() +
      365 * y +
      (y / 4).floor() -
      (y / 100).floor() +
      (y / 400).floor() -
      32045;
}

String ethiopianDateLabel(String isoDate) {
  final date = dateFromKey(isoDate);
  final jdn = _gregorianToJdn(date.year, date.month, date.day);
  final r = (jdn - 1723856) % 1461;
  final n = (r % 365) + 365 * (r ~/ 1460);
  final year = 4 * ((jdn - 1723856) ~/ 1461) + (r ~/ 365) - (r ~/ 1460);
  final month = (n ~/ 30) + 1;
  final day = (n % 30) + 1;
  return '${_ethiopianMonths[month - 1]} $day, $year E.C.';
}

String plannerDateLabel(String isoDate, String calendarMode) =>
    calendarMode == 'ethiopian' ? ethiopianDateLabel(isoDate) : isoDate;
