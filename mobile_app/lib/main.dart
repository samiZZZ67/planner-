import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/theme.dart';
import 'app/router.dart';
import 'core/database/local_database.dart';
import 'core/providers.dart';
import 'core/timer/timer_providers.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final database = await LocalDatabase.open();
  runApp(
    ProviderScope(
      overrides: [localDatabaseProvider.overrideWithValue(database)],
      child: const SamSpaceApp(),
    ),
  );
}

class SamSpaceApp extends ConsumerStatefulWidget {
  const SamSpaceApp({super.key});

  @override
  ConsumerState<SamSpaceApp> createState() => _SamSpaceAppState();
}

class _SamSpaceAppState extends ConsumerState<SamSpaceApp> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(themeModeProvider.notifier).load();
      ref.read(calendarModeProvider.notifier).load();
      ref.read(sessionProvider.notifier).initialize();
      ref.read(timerControllerProvider.notifier).initialize();
    });
  }

  @override
  Widget build(BuildContext context) {
    final themeMode = ref.watch(themeModeProvider);
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: "Sam'Space",
      debugShowCheckedModeBanner: false,
      theme: buildTheme(Brightness.light),
      darkTheme: buildTheme(Brightness.dark),
      themeMode: themeMode,
      routerConfig: router,
    );
  }
}
