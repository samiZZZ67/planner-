import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'timer_controller.dart';

final timerControllerProvider = NotifierProvider<TimerController, TimerState>(
  TimerController.new,
);
