# Phase 7 - Flutter Shared UI Components

This phase strengthens the shared Flutter UI layer used by the mobile RTC screens.

## Scope

- Primary files:
  - `mobile/lib/ui/rtc_mobile_ui.dart`
  - `mobile/lib/ui/rtc_assets.dart`
- Integration file:
  - `mobile/lib/screens/live_room_screen.dart`
- Test file:
  - `mobile/test/widget_test.dart`
- Reference frames:
  - `mobile/sdk_reference/frames_100/`

## Implemented

- Added `RtcInlineNotice` for reusable empty, loading, warning, and error-style inline states.
- Added `RtcCompactActionButton` for compact moderation and panel actions.
- Added `RtcParticipantTile` for reusable participant rows with avatar, status, busy/locked state, and actions.
- Added `RtcAssets.imageProviderFromValue()` to safely resolve network and bundled asset image strings.
- Replaced local live-room moderation participant rows with the shared participant tile.
- Replaced local live-room moderation buttons with the shared compact action button.
- Replaced repeated empty participant text with shared inline notices.

## Shared UI Coverage

The shared UI layer now includes:

- Control buttons.
- Room rows/cards.
- Participant tiles.
- Empty and status notices.
- Loading and message panels.
- Bottom-sheet panel shells.
- Avatar and badge components.

## Acceptance Checks

- Shared widgets render in the widget test harness.
- Live-room room-admin controls still support mute, camera pause, kick, and ban actions.
- Empty participant states remain readable in light and dark surfaces.
- Asset helper resolves bundled images, remote images, and empty strings safely.

## Verification

Run from `mobile/`:

```bash
flutter analyze
flutter test test/widget_test.dart
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

- Open the room feed and confirm room rows still render correctly.
- Join a room and open `Room Admin`.
- Confirm participant rows and moderation buttons are readable and tappable.
- Confirm empty participant states use the shared notice style.
