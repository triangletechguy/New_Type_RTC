# Phase 2 Flutter Room Feed

Phase 2 updates the Flutter room feed in:

```text
mobile/lib/screens/room_list_screen.dart
```

The goal is to make the mobile lobby reflect the 100-frame reference set before moving into the in-room RTC surface.

## Inputs

- Phase 1 scope: `mobile/PHASE_1_FLUTTER_FRAME_SCOPE.md`
- Reference contact sheet: `mobile/sdk_reference/images/new_mobile_RTC_100_contact_sheet.jpg`
- Room feed screen: `mobile/lib/screens/room_list_screen.dart`
- Room model: `mobile/lib/models/room.dart`
- Shared UI tokens/assets: `mobile/lib/ui/rtc_mobile_ui.dart`, `mobile/lib/ui/rtc_assets.dart`

## Implemented Scope

- Added a compact feed summary for the active feed.
- Added visible feed metrics: room count, live participants, video rooms, and locked rooms.
- Upgraded room cards with:
  - live/ready state badge,
  - audio/video badge,
  - privacy label,
  - host and region,
  - active participant count,
  - room type and feature chips,
  - participant preview avatars,
  - featured-room treatment,
  - visible owner delete action.
- Kept existing feed tabs, group tabs, filters, search, and create-room flow working.

## Preserved Behavior

- Default feed remains `for_you`.
- `Recently`, `Follow`, and `Group` still map to the existing backend feed choices.
- Empty state still offers `Create room`.
- Room tap still opens `LiveRoomScreen` through `AppRoutes.liveRoom`.
- Create-room sheet and validation behavior are unchanged.

## Acceptance Checklist

- Room feed loads.
- Tabs and filters still call the expected API values.
- Room cards show room name, host, type, live count, and access state.
- Empty state can still open the create-room sheet.
- Existing lobby widget tests pass.

Verification:

```bash
cd mobile
flutter test test/room_lobby_test.dart
```

Expected result:

```text
All tests passed!
```

## Next Phase

Phase 3 should update:

```text
mobile/lib/screens/live_room_screen.dart
```

Focus Phase 3 on the in-room call surface: main stage, local preview, remote tiles, bottom controls, chat panel, participant panel, and room-admin controls.

