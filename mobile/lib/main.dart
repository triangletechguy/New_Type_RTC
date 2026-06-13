import 'package:flutter/material.dart';

import 'config/app_config.dart';
import 'screens/web_app_screen.dart';
import 'ui/rtc_mobile_ui.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const RtcEnterpriseApp());
}

class RtcEnterpriseApp extends StatelessWidget {
  const RtcEnterpriseApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: RtcPalette.ink,
        colorScheme: const ColorScheme.dark(
          primary: RtcPalette.sky,
          secondary: RtcPalette.hot,
          tertiary: RtcPalette.mint,
          surface: RtcPalette.panel,
          onSurface: RtcPalette.soft,
        ),
        textTheme: ThemeData.dark().textTheme.apply(
          bodyColor: RtcPalette.soft,
          displayColor: Colors.white,
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.transparent,
          foregroundColor: Colors.white,
          elevation: 0,
          centerTitle: false,
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: const Color.fromRGBO(255, 255, 255, 0.07),
          labelStyle: const TextStyle(color: RtcPalette.muted),
          prefixIconColor: RtcPalette.muted,
          enabledBorder: OutlineInputBorder(
            borderSide: const BorderSide(
              color: Color.fromRGBO(255, 255, 255, 0.14),
            ),
            borderRadius: BorderRadius.circular(8),
          ),
          focusedBorder: OutlineInputBorder(
            borderSide: const BorderSide(color: RtcPalette.sky, width: 1.3),
            borderRadius: BorderRadius.circular(8),
          ),
          errorBorder: OutlineInputBorder(
            borderSide: const BorderSide(color: Color(0xFFFB7185)),
            borderRadius: BorderRadius.circular(8),
          ),
          focusedErrorBorder: OutlineInputBorder(
            borderSide: const BorderSide(color: Color(0xFFFB7185), width: 1.3),
            borderRadius: BorderRadius.circular(8),
          ),
        ),
        cardTheme: const CardThemeData(
          color: RtcPalette.panel,
          elevation: 0,
          margin: EdgeInsets.zero,
        ),
      ),
      home: const WebAppScreen(),
    );
  }
}
