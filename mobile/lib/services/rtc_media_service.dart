import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:permission_handler/permission_handler.dart';

class RtcMediaService {
  Future<void> requestPermissions({required bool video}) async {
    final permissions = <Permission>[Permission.microphone];
    if (video) permissions.add(Permission.camera);
    await permissions.request();
  }

  Future<MediaStream> openLocalMedia({required bool video}) {
    return navigator.mediaDevices.getUserMedia({
      'audio': true,
      'video': video
          ? {
              'facingMode': 'user',
              'width': {'ideal': 1280},
              'height': {'ideal': 720},
            }
          : false,
    });
  }
}
