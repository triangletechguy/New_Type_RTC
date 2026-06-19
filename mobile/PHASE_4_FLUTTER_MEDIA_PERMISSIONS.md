# Phase 4 - Flutter Media Permissions And Local Preview

This phase updates the Flutter RTC room flow so media permissions and local preview behavior match the mobile RTC reference.

## Scope

- Primary files:
  - `mobile/lib/services/rtc_media_service.dart`
  - `mobile/lib/screens/live_room_screen.dart`
- Test file:
  - `mobile/test/live_room_screen_test.dart`
- Reference frames:
  - `mobile/sdk_reference/frames_100/`

## Implemented

- Owner/publisher join now checks microphone or camera permission before backend room join.
- Audience receive-only entry does not request microphone or camera.
- Video publishing requests camera permission only when camera publishing is requested.
- Audio publishing requests microphone permission without forcing camera permission.
- Android Bluetooth connect permission remains part of the permission request list for compatible audio routing.
- Local preview opens with a camera stream for video publishing and an audio-only stream for audio publishing.
- getUserMedia failures are converted into clear user-facing messages.
- Denied publisher permission blocks backend join, signaling join, and peer setup.

## Acceptance Checks

- Host of a video room sees mic/camera permission prompt before joining.
- Host denial shows a clear permission message and does not join the backend room.
- Audience entry into receive-only rooms does not show mic/camera prompts.
- Stage approval starts local media after the user becomes allowed to publish.
- Camera toggle does not request camera permission in audio-only rooms.
- Local preview appears after camera permission is granted in video rooms.

## Verification

Run from `mobile/`:

```bash
flutter analyze
flutter test test/live_room_screen_test.dart
flutter test
```

For emulator validation:

```bash
flutter run -d emulator-5554 \
  --dart-define=API_BASE_URL=https://funint.online/api \
  --dart-define=SIGNALING_URL=https://funint.online
```

Manual emulator checklist:

- Join a video room as owner and grant permissions.
- Confirm local preview appears.
- Leave and rejoin, then deny camera permission.
- Confirm the app stays out of the room and shows the permission message.
- Join as audience and confirm no mic/camera prompt appears before stage approval.
- Request stage access, approve from another client, and confirm mic/camera starts only after approval.
