import 'package:flutter/material.dart';

class AppTheme {
  // ChatSaints dark navy + gold palette
  static const Color primary       = Color(0xFF0A1628); // deep navy
  static const Color primaryLight  = Color(0xFF1A2E4A); // lighter navy
  static const Color surface       = Color(0xFF0F1E35); // card surface
  static const Color accent        = Color(0xFFC9A84C); // gold
  static const Color accentLight   = Color(0xFFE8C96A); // light gold
  static const Color success       = Color(0xFF2ECC71);
  static const Color danger        = Color(0xFFE74C3C);
  static const Color background    = Color(0xFF0A1628); // same as primary for full dark
  static const Color textPrimary   = Color(0xFFFFFFFF);
  static const Color textSecondary = Color(0xFFB0BEC5);
  static const Color divider       = Color(0xFF1E3050);
  static const Color missionary    = Color(0xFFC9A84C); // gold for missionary badge

  static ThemeData get dark => ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: const ColorScheme.dark(
      primary: accent,
      secondary: accentLight,
      surface: surface,
      onPrimary: primary,
      onSurface: textPrimary,
    ),
    scaffoldBackgroundColor: background,
    appBarTheme: const AppBarTheme(
      backgroundColor: primaryLight,
      foregroundColor: textPrimary,
      elevation: 0,
      centerTitle: true,
      titleTextStyle: TextStyle(
        fontSize: 18, fontWeight: FontWeight.w700, color: textPrimary,
        letterSpacing: 0.5,
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: accent,
        foregroundColor: primary,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 24),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, letterSpacing: 0.5),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: primaryLight,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: divider),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: divider),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: accent, width: 2),
      ),
      labelStyle: const TextStyle(color: textSecondary),
      hintStyle: const TextStyle(color: Color(0xFF546E7A)),
      prefixIconColor: accent,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    ),
    cardTheme: CardThemeData(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      color: surface,
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      selectedItemColor: accent,
      unselectedItemColor: textSecondary,
      backgroundColor: primaryLight,
      type: BottomNavigationBarType.fixed,
      elevation: 8,
    ),
    dividerColor: divider,
    iconTheme: const IconThemeData(color: textSecondary),
  );

  // Keep light alias pointing to dark for compatibility
  static ThemeData get light => dark;
}
