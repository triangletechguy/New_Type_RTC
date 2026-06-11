import 'package:flutter/material.dart';

import 'config/app_config.dart';
import 'models/app_user.dart';
import 'screens/login_screen.dart';
import 'screens/room_list_screen.dart';
import 'services/api_client.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const RtcEnterpriseApp());
}

class RtcEnterpriseApp extends StatefulWidget {
  const RtcEnterpriseApp({super.key});

  @override
  State<RtcEnterpriseApp> createState() => _RtcEnterpriseAppState();
}

class _RtcEnterpriseAppState extends State<RtcEnterpriseApp> {
  final _api = ApiClient();
  AppUser? _user;
  bool _booting = true;

  @override
  void initState() {
    super.initState();
    _restoreSession();
  }

  Future<void> _restoreSession() async {
    final session = await _api.restoreSession();
    setState(() {
      _user = session?.user;
      _booting = false;
    });
  }

  Future<void> _onLoggedIn() async {
    setState(() => _user = _api.session?.user);
  }

  Future<void> _onLoggedOut() async {
    setState(() => _user = null);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF007A78),
          brightness: Brightness.light,
        ),
        cardTheme: const CardThemeData(elevation: 0, margin: EdgeInsets.zero),
      ),
      home: _booting
          ? const _BootScreen()
          : _user == null
          ? LoginScreen(api: _api, onLoggedIn: _onLoggedIn)
          : RoomListScreen(api: _api, user: _user!, onLoggedOut: _onLoggedOut),
    );
  }
}

class _BootScreen extends StatelessWidget {
  const _BootScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}
