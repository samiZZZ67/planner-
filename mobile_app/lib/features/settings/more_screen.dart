import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
    children: [
      Text(
        'More',
        style: Theme.of(context).textTheme.headlineSmall
            ?.copyWith(fontWeight: FontWeight.w800),
      ),
      const SizedBox(height: 14),
      _FeatureLink(
        icon: Icons.category_outlined,
        title: 'Categories',
        subtitle: 'Organize tasks and daily targets',
        route: '/category',
      ),
      _FeatureLink(
        icon: Icons.insights_outlined,
        title: 'Analytics',
        subtitle: 'Review focus time and completion',
        route: '/analytics',
      ),
      _FeatureLink(
        icon: Icons.edit_note_outlined,
        title: 'Notes & reflection',
        subtitle: 'Capture quick notes and daily review',
        route: '/notes',
      ),
      _FeatureLink(
        icon: Icons.auto_stories_outlined,
        title: 'Diary',
        subtitle: 'Write about your day and attach photos',
        route: '/diary',
      ),
      _FeatureLink(
        icon: Icons.auto_awesome_outlined,
        title: 'Sam\'s AI',
        subtitle: 'Ask about your plans or tasks',
        route: '/assistant',
      ),
      _FeatureLink(
        icon: Icons.send_outlined,
        title: 'Telegram',
        subtitle: 'Channel status, scheduled posts, and delivery history',
        route: '/telegram',
      ),
      _FeatureLink(
        icon: Icons.settings_outlined,
        title: 'Settings',
        subtitle: 'Sync, theme, calendar, and backups',
        route: '/settings',
      ),
    ],
  );
}

class _FeatureLink extends StatelessWidget {
  const _FeatureLink({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.route,
  });
  final IconData icon;
  final String title, subtitle, route;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 9),
    child: Card(
      child: ListTile(
        leading: Icon(icon),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => context.push(route),
      ),
    ),
  );
}
