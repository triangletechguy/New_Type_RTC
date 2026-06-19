# Phase 6 - Flutter Chat, Notifications, And Room Controls

This phase updates the Flutter live room chat and in-room moderation surface to match the mobile RTC reference flow.

## Scope

- Primary files:
  - `mobile/lib/screens/live_room_screen.dart`
  - `mobile/lib/services/signaling_service.dart`
  - `mobile/lib/services/api_client.dart`
- Test files:
  - `mobile/test/live_room_screen_test.dart`
  - `mobile/test/api_client_test.dart`
- Reference frames:
  - `mobile/sdk_reference/frames_100/`

## Implemented

- Added room-message delete support through `DELETE /messages/:id`.
- Added signaling fallback for `chat-message-deleted` when HTTP delete does not broadcast.
- Added an `Unsend` action for the current user's own chat messages.
- Removed deleted messages locally and from realtime delete events.
- Kept room chat send, gift send, and live refresh behavior intact.
- Renamed the in-room moderation entry point to `Room Admin`.
- Updated in-room moderation feedback to use `room admin` language.
- Normalized room role labels such as `Room owner`, `Room admin`, `Room moderator`, `Speaker`, and `Audience`.

## Admin Label Rules

- Platform service admin: platform/company management only.
- Company service admin: company RTC service management.
- Room admin: in-room moderation.
- Room moderators are not labeled as generic `admin`.

## Acceptance Checks

- Room messages load when entering the room or opening chat.
- User can send a chat message.
- User can unsend their own message.
- Deleted messages disappear from the chat panel.
- Realtime delete events remove messages.
- Room admin controls load participant and stage-request state.
- Room admin moderation actions show clear feedback.

## Verification

Run from `mobile/`:

```bash
flutter analyze
flutter test test/live_room_screen_test.dart
flutter test test/api_client_test.dart
flutter test
```

For emulator validation:

```bash
flutter run -d emulator-5554 \
  --dart-define=API_BASE_URL=https://funint.online/api \
  --dart-define=SIGNALING_URL=https://funint.online
```

Manual emulator checklist:

- Join a room.
- Open chat and send a message.
- Confirm the message appears immediately.
- Tap `Unsend` on your own message and confirm it disappears.
- Join from another client and confirm delete syncs.
- Open `Room Admin` controls.
- Moderate a participant and confirm the target sees room-admin feedback.
