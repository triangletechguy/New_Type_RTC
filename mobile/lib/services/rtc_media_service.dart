import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:permission_handler/permission_handler.dart';

class RtcMediaService {
  Future<void> requestPermissions({required bool video}) async {
    final permissions = <Permission>[Permission.microphone];
    if (video) permissions.add(Permission.camera);
    final statuses = await permissions.request();
    final micStatus = statuses[Permission.microphone];
    if (micStatus == null || !micStatus.isGranted) {
      throw StateError('Microphone permission is required to join a room.');
    }
    if (video) {
      final cameraStatus = statuses[Permission.camera];
      if (cameraStatus == null || !cameraStatus.isGranted) {
        throw StateError('Camera permission is required to join with video.');
      }
    }
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

  Future<void> stopMediaStream(MediaStream? stream) async {
    if (stream == null) return;
    for (final track in stream.getTracks()) {
      await track.stop();
    }
    await stream.dispose();
  }
}
