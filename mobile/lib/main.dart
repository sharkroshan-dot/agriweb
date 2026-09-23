import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'core/services/api_service.dart';
import 'shared/providers/delivery_controller.dart';
import 'shared/providers/theme_controller.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await ApiService.init();
  await ThemeController.init();
  DeliveryController.init();
  SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  runApp(const AgriConnectApp());
}

class AgriConnectApp extends StatefulWidget {
  const AgriConnectApp({super.key});

  @override
  State<AgriConnectApp> createState() => _AgriConnectAppState();
}

class _AgriConnectAppState extends State<AgriConnectApp> {
  late final ThemeController _themeController = ThemeController.instance!;
  late final DeliveryController _deliveryController = DeliveryController.instance!;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _themeController,
      builder: (context, _) {
        return ThemeScope(
          controller: _themeController,
          child: DeliveryScope(
            controller: _deliveryController,
            child: MaterialApp.router(
              title: 'Farm2Home',
              debugShowCheckedModeBanner: false,
              theme: AppTheme.lightTheme,
              darkTheme: AppTheme.darkTheme,
              themeMode: _themeController.themeMode,
              routerConfig: AppRouter.router,
            ),
          ),
        );
      },
    );
  }
}