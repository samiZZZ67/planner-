import 'package:flutter/material.dart';

const _ink = Color(0xFF0B0B0D);
const _panel = Color(0xFF17171B);
const _line = Color(0xFF333338);
const _accent = Color(0xFFFF5A2E);

ThemeData buildTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: _accent,
    brightness: brightness,
    surface: dark ? _panel : const Color(0xFFF6F6F8),
    primary: dark ? const Color(0xFFF5F5F7) : const Color(0xFF17171B),
    secondary: _accent,
  );
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: dark ? _ink : const Color(0xFFF1F1F3),
    appBarTheme: AppBarTheme(
      backgroundColor: dark ? _ink : const Color(0xFFF1F1F3),
      foregroundColor: dark ? Colors.white : const Color(0xFF161619),
      elevation: 0,
      centerTitle: false,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: dark ? const Color(0xF017171B) : Colors.white,
      indicatorColor: dark ? const Color(0x26FFFFFF) : const Color(0x1A17171B),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontSize: 11,
          fontWeight: states.contains(WidgetState.selected)
              ? FontWeight.w700
              : FontWeight.w500,
        ),
      ),
    ),
    cardTheme: CardThemeData(
      color: dark ? _panel : Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: dark ? _line : const Color(0xFFE6E6E9)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: dark ? const Color(0xFF101014) : const Color(0xFFF8F8F9),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: dark ? _line : const Color(0xFFE2E2E6)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: dark ? _line : const Color(0xFFE2E2E6)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: _accent, width: 1.5),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    dividerColor: dark ? _line : const Color(0xFFE6E6E9),
    textTheme: ThemeData(brightness: brightness).textTheme.apply(
      bodyColor: dark ? const Color(0xFFF3F3F5) : const Color(0xFF19191C),
      displayColor: dark ? const Color(0xFFF3F3F5) : const Color(0xFF19191C),
    ),
  );
}

class GlassCard extends StatelessWidget {
  const GlassCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
  });
  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(padding: padding, child: child),
  );
}
