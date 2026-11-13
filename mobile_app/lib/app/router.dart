import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/providers.dart';
import '../features/auth/login_screen.dart';
import '../features/navigation/app_shell.dart';
import '../features/planning/today_screen.dart';
import '../features/planning/add_task_screen.dart';
import '../features/planning/plans_screen.dart';
import '../features/settings/more_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/planning/category_screen.dart';
import '../features/planning/analytics_screen.dart';
import '../features/planning/diary_screen.dart';
import '../features/planning/notes_screen.dart';
import '../features/books/books_screen.dart';
import '../features/books/quiz_screen.dart';
import '../features/ai/assistant_screen.dart';
import '../features/settings/telegram_screen.dart';

GoRouter createRouter(SessionState Function() sessionState) => GoRouter(
  initialLocation: '/loading',
  redirect: (context, state) {
    final path = state.uri.path;
    final session = sessionState();
    if (session.status == SessionStatus.loading)
      return path == '/loading' ? null : '/loading';
    if (session.status == SessionStatus.signedOut)
      return path == '/login' ? null : '/login';
    if (path == '/login' || path == '/loading') return '/today';
    return null;
  },
  routes: [
    GoRoute(path: '/loading', builder: (_, __) => const _LoadingScreen()),
    GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
    ShellRoute(
      builder: (context, state, child) =>
          AppShell(location: state.uri.path, child: child),
      routes: [
        GoRoute(path: '/today', builder: (_, __) => const TodayScreen()),
        GoRoute(path: '/plans', builder: (_, __) => const PlansScreen()),
        GoRoute(
          path: '/add',
          builder: (_, state) => AddTaskScreen(
            initialDate: state.uri.queryParameters['date'],
            initialTaskId: state.uri.queryParameters['taskId'],
          ),
        ),
        GoRoute(path: '/books', builder: (_, __) => const BooksScreen()),
        GoRoute(path: '/more', builder: (_, __) => const MoreScreen()),
        GoRoute(path: '/category', builder: (_, __) => const CategoryScreen()),
        GoRoute(
          path: '/analytics',
          builder: (_, __) => const AnalyticsScreen(),
        ),
        GoRoute(path: '/diary', builder: (_, __) => const DiaryScreen()),
        GoRoute(path: '/notes', builder: (_, __) => const NotesScreen()),
        GoRoute(path: '/settings', builder: (_, __) => const SettingsScreen()),
        GoRoute(
          path: '/assistant',
          builder: (_, __) => const AssistantScreen(),
        ),
        GoRoute(path: '/telegram', builder: (_, __) => const TelegramScreen()),
        GoRoute(
          path: '/quiz',
          builder: (_, state) => QuizScreen(
            assignmentId: state.uri.queryParameters['assignmentId'],
            sessionId: state.uri.queryParameters['sessionId'],
          ),
        ),
      ],
    ),
  ],
);

final routerProvider = Provider<GoRouter>((ref) {
  final router = createRouter(() => ref.read(sessionProvider));
  ref.listen(sessionProvider, (previous, next) => router.refresh());
  ref.onDispose(router.dispose);
  return router;
});

class _LoadingScreen extends StatelessWidget {
  const _LoadingScreen();
  @override
  Widget build(BuildContext context) =>
      const Scaffold(body: Center(child: CircularProgressIndicator()));
}
