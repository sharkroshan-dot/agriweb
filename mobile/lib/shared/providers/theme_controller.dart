import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Provides app-wide UI state (currently: theme mode) without pulling in a
/// state-management package. Screens can listen via [ThemeController.of].
class ThemeController extends ChangeNotifier {
  ThemeController._();

  static ThemeController? _instance;

  static Future<ThemeController> init() async {
    final controller = ThemeController._();
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString('theme_mode');
    controller._themeMode = switch (stored) {
      'dark' => ThemeMode.dark,
      'light' => ThemeMode.light,
      _ => ThemeMode.system,
    };
    _instance = controller;
    return controller;
  }

  static ThemeController of(BuildContext context) {
    return context
        .dependOnInheritedWidgetOfExactType<ThemeScope>()!
        .controller;
  }

  static ThemeController? get instance => _instance;

  ThemeMode _themeMode = ThemeMode.system;
  ThemeMode get themeMode => _themeMode;
  bool get isDark => _themeMode == ThemeMode.dark;

  Future<void> setThemeMode(ThemeMode mode) async {
    if (_themeMode == mode) return;
    _themeMode = mode;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('theme_mode', mode.name);
  }
}

class ThemeScope extends InheritedWidget {
  final ThemeController controller;
  const ThemeScope({super.key, required this.controller, required super.child});

  @override
  bool updateShouldNotify(ThemeScope oldWidget) =>
      controller != oldWidget.controller;
}