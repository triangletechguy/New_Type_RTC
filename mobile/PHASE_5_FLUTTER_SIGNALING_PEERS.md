# Phase 5 - Flutter Signaling And Peer Flow

This phase updates the Flutter RTC signaling and peer-connection path for cleaner two-device room behavior.

## Scope

- Primary files:
  - `mobile/lib/services/signaling_service.dart`
  - `mobile/lib/services/rtc_peer_connection_service.dart`
  - `mobile/lib/screens/live_room_screen.dart`
- Test file:
  - `mobile/test/signaling_service_test.dart`
- Reference frames:
  - `mobile/sdk_reference/frames_100/`

## Implemented

- Normalized signaling peer payloads from camelCase and snake_case fields.
- Filtered the local user/socket from remote peer lists.
- Deduplicated reconnecting peers by socket id or user id.
- Preserved latest peer media state across duplicate/reconnect payloads.
- Sent `roomId` when leaving the signaling room.
- Skipped local socket ids inside the peer coordinator.
- Pruned stale remote renderer and peer-state UI entries when a peer leaves.
- Kept peer cleanup idempotent during leave, reconnect, and disposal.

## Acceptance Checks

- Existing users appear after signaling room join.
- New users appear without app restart.
- Duplicate signaling rows do not create duplicate participant tiles.
- A reconnecting user replaces the old socket entry.
- Leaving removes stale participant renderer/state entries.
- Local user does not appear as their own remote participant.

## Verification

Run from `mobile/`:

```bash
flutter analyze
flutter test test/signaling_service_test.dart
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

- Start one emulator/device and join a room.
- Join the same room from a second emulator/device.
- Confirm each client sees the other participant once.
- Toggle mic/camera and confirm state updates on the other client.
- Leave from one client and confirm the participant tile disappears.
- Rejoin and confirm there is still only one tile for that user.
