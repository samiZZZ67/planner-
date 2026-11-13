import 'package:flutter_test/flutter_test.dart';
import 'package:sams_space/core/date/planner_dates.dart';

void main() {
  test('traditional planning day changes at 06:00 Addis Ababa time', () {
    final beforeBoundary = DateTime.utc(2026, 11, 12, 2, 59);
    final afterBoundary = DateTime.utc(2026, 11, 12, 3, 0);
    expect(traditionalDayKey(beforeBoundary), '2026-11-11');
    expect(traditionalDayKey(afterBoundary), '2026-11-12');
  });

  test('Ethiopian date conversion preserves Gregorian record keys', () {
    expect(ethiopianDateLabel('2023-09-12'), 'Meskerem 1, 2016 E.C.');
    expect(plannerDateLabel('2026-11-12', 'gregorian'), '2026-11-12');
  });
}
