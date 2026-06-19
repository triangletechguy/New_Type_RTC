import 'package:flutter/material.dart';

import 'config/app_config.dart';
import 'models/app_user.dart';
import 'navigation/app_routes.dart';
import 'screens/admin_dashboard_screen.dart';
import 'screens/live_room_screen.dart';
import 'screens/login_screen.dart';
import 'screens/native_route_error_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/room_list_screen.dart';
import 'services/api_client.dart';
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
        fontFamily: RtcTypography.fontFamily,
        fontFamilyFallback: RtcTypography.fontFamilyFallback,
        scaffoldBackgroundColor: RtcPalette.bg,
        colorScheme: const ColorScheme.dark(
          primary: RtcPalette.sky,
          secondary: RtcPalette.hot,
          tertiary: RtcPalette.mint,
          surface: RtcPalette.panel,
          onSurface: RtcPalette.soft,
          error: RtcPalette.red,
        ),
        textTheme: ThemeData.dark().textTheme.apply(
          bodyColor: RtcPalette.soft,
          displayColor: RtcPalette.text,
          fontFamily: RtcTypography.fontFamily,
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.transparent,
          foregroundColor: RtcPalette.text,
          elevation: 0,
          centerTitle: false,
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: RtcPalette.hoverBg,
          labelStyle: const TextStyle(color: RtcPalette.muted),
          prefixIconColor: RtcPalette.muted,
          enabledBorder: OutlineInputBorder(
            borderSide: const BorderSide(color: RtcPalette.line),
            borderRadius: BorderRadius.circular(RtcRadius.control),
          ),
          focusedBorder: OutlineInputBorder(
            borderSide: const BorderSide(
              color: RtcPalette.focusBorder,
              width: 1.3,
            ),
            borderRadius: BorderRadius.circular(RtcRadius.control),
          ),
          errorBorder: OutlineInputBorder(
            borderSide: const BorderSide(color: RtcPalette.red),
            borderRadius: BorderRadius.circular(RtcRadius.control),
          ),
          focusedErrorBorder: OutlineInputBorder(
            borderSide: const BorderSide(color: RtcPalette.red, width: 1.3),
            borderRadius: BorderRadius.circular(RtcRadius.control),
          ),
        ),
        cardTheme: const CardThemeData(
          color: RtcPalette.panel,
          elevation: 0,
          margin: EdgeInsets.zero,
        ),
      ),
      home: const NativeRtcShell(),
      onGenerateRoute: _onGenerateRoute,
      onUnknownRoute: _onUnknownRoute,
    );
  }

  Route<dynamic>? _onGenerateRoute(RouteSettings settings) {
    switch (settings.name) {
      case AppRoutes.root:
      case AppRoutes.login:
      case AppRoutes.rooms:
        return AppRoutes.page<void>(
          name: settings.name ?? AppRoutes.root,
          child: const NativeRtcShell(),
        );
      case AppRoutes.liveRoom:
        final args = settings.arguments;
        if (args is LiveRoomRouteArgs) {
          return AppRoutes.page<void>(
            name: AppRoutes.liveRoom,
            arguments: args,
            child: LiveRoomScreen(
              api: args.api,
              user: args.user,
              room: args.room,
              autoConnect: args.autoConnect,
            ),
          );
        }
        return _routeError(settings, 'Live room route needs room details.');
      case AppRoutes.profile:
        final args = settings.arguments;
        if (args is ProfileRouteArgs) {
          return AppRoutes.page<void>(
            name: AppRoutes.profile,
            arguments: args,
            child: ProfileScreen(
              api: args.api,
              user: args.user,
              onSaved: args.onSaved,
              onLogout: args.onLogout,
              initialSection: args.initialSection,
            ),
          );
        }
        return _routeError(settings, 'Profile route needs user details.');
      case AppRoutes.admin:
        final args = settings.arguments;
        if (args is AdminRouteArgs && args.user.canUseAdminDashboard) {
          return AppRoutes.page<void>(
            name: AppRoutes.admin,
            arguments: args,
            child: Builder(
              builder: (context) => AdminDashboardScreen(
                api: args.api,
                user: args.user,
                onBack: () => Navigator.of(context).pop(),
              ),
            ),
          );
        }
        return _routeError(
          settings,
          'Service console route requires a client_admin or super_admin user.',
        );
      case AppRoutes.settings:
        final args = settings.arguments;
        if (args is ProfileRouteArgs) {
          return AppRoutes.page<void>(
            name: AppRoutes.settings,
            arguments: args,
            child: ProfileScreen(
              api: args.api,
              user: args.user,
              onSaved: args.onSaved,
              onLogout: args.onLogout,
              initialSection: args.initialSection,
            ),
          );
        }
        return _routeError(settings, 'Settings route needs user details.');
      case AppRoutes.error:
        return _routeError(settings, 'The app opened a native error route.');
    }

    return null;
  }

  Route<dynamic> _onUnknownRoute(RouteSettings settings) {
    return _routeError(settings, 'Unknown native route.');
  }

  Route<dynamic> _routeError(RouteSettings settings, String message) {
    final routeName = settings.name ?? AppRoutes.error;
    return AppRoutes.page<void>(
      name: AppRoutes.error,
      arguments: settings.arguments,
      child: NativeRouteErrorScreen(
        title: 'Route unavailable',
        message: message,
        routeName: routeName,
      ),
    );
  }
}

class NativeRtcShell extends StatefulWidget {
  const NativeRtcShell({super.key});

  @override
  State<NativeRtcShell> createState() => _NativeRtcShellState();
}

class _NativeRtcShellState extends State<NativeRtcShell> {
  late final ApiClient _api;
  bool _booting = true;
  AppUser? _user;
  String _bootStatus = 'Restoring session...';

  @override
  void initState() {
    super.initState();
    _api = ApiClient(onAuthExpired: _handleAuthExpired);
    _restoreSession();
  }

  void _handleAuthExpired(String message) {
    if (!mounted) return;

    setState(() {
      _user = null;
      _booting = false;
      _bootStatus = message;
    });

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      Navigator.maybeOf(context)?.popUntil((route) => route.isFirst);
    });
  }

  Future<void> _restoreSession() async {
    try {
      final session = await _api.restoreSession();
      if (!mounted) return;

      if (session == null) {
        setState(() {
          _booting = false;
          _bootStatus = '';
        });
        return;
      }

      AppUser user = session.user;
      try {
        user = await _api.refreshCurrentUser();
      } catch (_) {
        // Keep the saved session available when the network is temporarily down.
      }

      if (!mounted) return;
      setState(() {
        _user = user;
        _booting = false;
        _bootStatus = '';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _booting = false;
        _bootStatus = apiErrorMessage(error);
      });
    }
  }

  Future<void> _handleLoggedIn() async {
    final session = _api.session;
    if (!mounted || session == null) return;

    AppUser user = session.user;
    try {
      user = await _api.refreshCurrentUser();
    } catch (_) {
      // The login response already has enough user data to enter the app.
    }

    if (mounted) {
      setState(() => _user = user);
    }
  }

  Future<void> _handleLoggedOut() async {
    if (mounted) {
      setState(() => _user = null);
    }
  }

  void _handleUserUpdated(AppUser user) {
    setState(() => _user = user);
  }

  Future<void> _openProfile() async {
    final user = _user;
    if (user == null) return;

    await Navigator.of(context).pushNamed<void>(
      AppRoutes.profile,
      arguments: ProfileRouteArgs(
        api: _api,
        user: user,
        onSaved: _handleUserUpdated,
        onLogout: _handleLoggedOut,
      ),
    );
  }

  Future<void> _openSettings() async {
    final user = _user;
    if (user == null) return;

    await Navigator.of(context).pushNamed<void>(
      AppRoutes.settings,
      arguments: ProfileRouteArgs(
        api: _api,
        user: user,
        onSaved: _handleUserUpdated,
        onLogout: _handleLoggedOut,
        initialSection: 'account',
      ),
    );
  }

  void _openAdmin() {
    final user = _user;
    if (user == null || !user.canUseAdminDashboard) return;
    Navigator.of(context).pushNamed<void>(
      AppRoutes.admin,
      arguments: AdminRouteArgs(api: _api, user: user),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_booting) return _BootScreen(status: _bootStatus);

    final user = _user;
    if (user == null) {
      return LoginScreen(
        api: _api,
        initialStatus: _bootStatus,
        onLoggedIn: _handleLoggedIn,
      );
    }

    return RoomListScreen(
      api: _api,
      user: user,
      onLoggedOut: _handleLoggedOut,
      onOpenProfile: _openProfile,
      onOpenSettings: _openSettings,
      onOpenAdmin: user.canUseAdminDashboard ? _openAdmin : null,
    );
  }
}

class _BootScreen extends StatelessWidget {
  const _BootScreen({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: RtcBackdrop(
        child: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: GlassPanel(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const BrandHeader(
                      title: 'TalkEachOther',
                      subtitle: 'Native Flutter RTC',
                    ),
                    const SizedBox(height: 18),
                    const LinearProgressIndicator(minHeight: 3),
                    const SizedBox(height: 14),
                    Text(
                      status,
                      style: const TextStyle(
                        color: RtcPalette.muted,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
