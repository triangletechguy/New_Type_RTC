import 'package:flutter/material.dart';

import '../models/app_user.dart';
import '../models/room.dart';
import '../services/api_client.dart';

class AppRoutes {
  const AppRoutes._();

  static const root = '/';
  static const login = '/login';
  static const rooms = '/rooms';
  static const liveRoom = '/room';
  static const profile = '/profile';
  static const admin = '/admin';
  static const settings = '/settings';
  static const error = '/error';

  static const all = <String>[
    root,
    login,
    rooms,
    liveRoom,
    profile,
    admin,
    settings,
    error,
  ];

  static MaterialPageRoute<T> page<T>({
    required String name,
    required Widget child,
    Object? arguments,
  }) {
    return MaterialPageRoute<T>(
      settings: RouteSettings(name: name, arguments: arguments),
      builder: (_) => child,
    );
  }
}

class LiveRoomRouteArgs {
  const LiveRoomRouteArgs({
    required this.api,
    required this.user,
    required this.room,
    this.autoConnect = false,
  });

  final ApiClient api;
  final AppUser user;
  final Room room;
  final bool autoConnect;
}

class ProfileRouteArgs {
  const ProfileRouteArgs({
    required this.api,
    required this.user,
    required this.onSaved,
    required this.onLogout,
    this.initialSection = 'profile',
  });

  final ApiClient api;
  final AppUser user;
  final ValueChanged<AppUser> onSaved;
  final Future<void> Function() onLogout;
  final String initialSection;
}

class AdminRouteArgs {
  const AdminRouteArgs({required this.api, required this.user});

  final ApiClient api;
  final AppUser user;
}
