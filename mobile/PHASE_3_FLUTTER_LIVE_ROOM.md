# Phase 3 - Flutter Live Room

This phase updates the Flutter in-room RTC screen to better match the 100-frame mobile RTC reference flow.

## Scope

- Primary file: `mobile/lib/screens/live_room_screen.dart`
- Reference frames: `mobile/sdk_reference/frames_100/`
- Main guide: `mobile/FLUTTER_UPDATE_FROM_100_FRAMES.md`

## Implemented

- Added a compact live status rail below the top bar.
- Exposed room state as quick chips: role, media mode, participant count, chat count, and screen-share readiness.
- Kept the main stage focused on local preview, active room state, and join affordance.
- Made the remote participant strip render from peer data even before a remote video renderer attaches.
- Preserved bottom controls for mic, camera, stage request, host tools, chat, and leave.

## Acceptance Checks

- Joined host sees live status, media status, remote participants, stage seats, chat preview, and bottom controls.
- Audience user sees audience status and can request/cancel stage access when enabled.
- Remote participants appear in the stage strip as soon as signaling peer data arrives.
- Existing chat, host panel, and leave flows remain usable.

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

- Open a room from the room feed.
- Join as host or speaker.
- Confirm local preview or stage fallback displays.
- Toggle mic and camera.
- Open chat and host tools.
- Join from a second device/emulator and confirm the remote participant appears.
- Leave and confirm cleanup without duplicate participants after rejoin.
