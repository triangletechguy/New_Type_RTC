import 'dart:io' show Platform;

import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:permission_handler/permission_handler.dart';

class RtcMediaService {
  Future<void> requestPermissions({required bool video}) async {
    final permissions = <Permission>[Permission.microphone];
    if (video) permissions.add(Permission.camera);
    if (Platform.isAndroid) permissions.add(Permission.bluetoothConnect);

    final statuses = await permissions.request();
    _requireGranted(
      statuses[Permission.microphone],
      'Microphone permission is required to join the room.',
    );
    if (video) {
      _requireGranted(
        statuses[Permission.camera],
        'Camera permission is required to join a video room.',
      );
    }
  }

  Future<MediaStream> openLocalMedia({required bool video}) async {
    try {
      return await navigator.mediaDevices.getUserMedia({
        'audio': true,
        'video': video
            ? {
                'facingMode': 'user',
                'width': {'ideal': 1280},
                'height': {'ideal': 720},
              }
            : false,
      });
    } catch (_) {
      throw RtcMediaPermissionException(
        video
            ? 'Could not start microphone and camera. Check app permissions and try again.'
            : 'Could not start microphone. Check app permissions and try again.',
      );
    }
  }

  void _requireGranted(PermissionStatus? status, String message) {
    if (status?.isGranted ?? false) return;
    throw RtcMediaPermissionException(message);
  }
}

class RtcMediaPermissionException implements Exception {
  const RtcMediaPermissionException(this.message);

  final String message;

  @override
  String toString() => message;
}
