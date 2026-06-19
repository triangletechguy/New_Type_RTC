# Phase 1 Flutter Frame Scope Lock

Phase 1 converts the 100 reference images into a Flutter-app update scope for:

```text
mobile/
```

This phase does not change the native Android SDK. It decides what the Flutter app must implement first, what belongs in existing Flutter services, and what can wait until later phases.

## Inputs

- Source video: `new_mobile_RTC.mp4`
- 100-frame set: `mobile/sdk_reference/frames_100/`
- Frame index: `mobile/sdk_reference/frames_100/index.tsv`
- Contact sheet: `mobile/sdk_reference/images/new_mobile_RTC_100_contact_sheet.jpg`
- Existing frame audit: `mobile/sdk_reference/FRAME_SCOPE_AUDIT.tsv`
- Flutter update guide: `mobile/FLUTTER_UPDATE_FROM_100_FRAMES.md`

## Existing Flutter App Surfaces

Use the existing mobile project structure:

```text
mobile/lib/screens/room_list_screen.dart
mobile/lib/screens/live_room_screen.dart
mobile/lib/screens/login_screen.dart
mobile/lib/screens/profile_screen.dart
mobile/lib/screens/admin_dashboard_screen.dart
mobile/lib/services/api_client.dart
mobile/lib/services/rtc_media_service.dart
mobile/lib/services/rtc_peer_connection_service.dart
mobile/lib/services/signaling_service.dart
mobile/lib/ui/rtc_mobile_ui.dart
mobile/lib/ui/rtc_assets.dart
```

Phase 1 scope is Flutter app work only. Keep `new_mobileRTC/agora-manager` unchanged during this phase.

## Frame Category Counts

The 100-frame audit maps to these visible surfaces:

| Surface | Frames | Flutter meaning |
| --- | ---: | --- |
| `long_running_session` | 24 | Live room must stay stable for long calls and clean up on leave. |
| `build_debug` | 19 | Use for QA/scripts only, not mobile runtime UI. |
| `mobile_room_interop` | 13 | Mobile app must share room state with desktop/web clients. |
| `integration_docs` | 7 | Use for docs/checklists only. |
| `rich_live_controls` | 7 | Live room controls and participant panels are in scope. |
| `mobile_chat` | 6 | Chat panel and message events are in scope. |
| `mobile_identity_profile` | 6 | Profile/session identity is in scope. |
| `mobile_room_list` | 6 | Room feed, search, filters, and room cards are in scope. |
| `creator_preflight` | 5 | Create/join preflight and permission checks are in scope. |
| `live_media` | 3 | Core call surface is in scope. |
| `mobile_participant_controls` | 3 | Room-admin/moderation panels are in scope. |
| `app_visual_asset` | 1 | App-owned artwork only. |

## Locked Flutter App Scope

Phase 1 locks these app areas as required:

- Native mobile room feed.
- Room creation and join preflight.
- Live room media surface.
- Local preview tile.
- Remote participant tiles.
- Bottom call controls.
- Chat panel.
- Participant list panel.
- Room-admin/moderation actions.
- Profile/session identity surfaces.
- Long-running call stability.
- Clean leave and media teardown.
- Mobile/desktop room interoperability through backend and signaling.

## Out Of Scope For Flutter Phase 1

Do not spend Phase 1 implementation time on:

- Changing the Android SDK file.
- Rebuilding backend admin screens.
- Recreating GitHub/browser/editor/debug screens shown in the video.
- Recreating floating desktop note overlays.
- Building a new web UI.
- Adding a new RTC engine unless Flutter WebRTC becomes a blocker in a later phase.

## Flutter File Mapping

### Room Feed

Primary file:

```text
mobile/lib/screens/room_list_screen.dart
```

Required from frames:

- Feed tabs and room groups.
- Search and filters.
- Room cards with live/audio/video/private state.
- Create room entry.
- Open room into `LiveRoomScreen`.

### Live Room

Primary file:

```text
mobile/lib/screens/live_room_screen.dart
```

Required from frames:

- Main media stage.
- Self preview.
- Remote tiles.
- Join/loading/connected/leave states.
- Bottom call controls.
- Chat, participants, and room-admin panels.
- Screen-share state display.

### Media Permissions

Primary file:

```text
mobile/lib/services/rtc_media_service.dart
```

Required from frames:

- Microphone permission for audio.
- Camera permission for video.
- Permission-denied state.
- Local camera preview.
- Audio-only rooms should not ask for camera.

### Signaling And Remote Participants

Primary files:

```text
mobile/lib/services/signaling_service.dart
mobile/lib/services/rtc_peer_connection_service.dart
```

Required from frames:

- Join signaling room.
- Receive existing peers.
- Receive user joined/left.
- Sync mic/camera/screen-share state.
- Render remote streams.
- Cleanly detach peers on leave.

### Backend API Data

Primary file:

```text
mobile/lib/services/api_client.dart
```

Required from frames:

- Login/session restore.
- Room list.
- Create room.
- Join room.
- Chat history and sending.
- Room controls.
- Moderation actions.

### Shared UI

Primary files:

```text
mobile/lib/ui/rtc_mobile_ui.dart
mobile/lib/ui/rtc_assets.dart
```

Required from frames:

- Reusable call control buttons.
- Room cards.
- Participant tiles.
- Bottom sheet panels.
- Status banners.
- Empty/error states.

## Phase 1 Implementation Decisions

Use the current Flutter WebRTC app architecture for now:

```text
flutter_webrtc + socket_io_client + existing backend APIs
```

Do not replace it with the native Android AAR during this phase. The Android SDK remains useful for client-native integration, but the `rtc-enterprise/mobile` app already has Flutter services for media and signaling.

Use the 100 frames as behavior reference, not pixel-perfect screenshot requirements. The target is native Flutter mobile parity with the observed RTC workflow.

## Phase 1 Acceptance Checklist

- 100 frames are verified.
- Contact sheet is available.
- Flutter-owned surfaces are identified.
- SDK/backend/debug-only surfaces are excluded from Flutter Phase 1.
- Existing Flutter files are mapped to the required work.
- Phase 2 can begin with `room_list_screen.dart`.

Verification command:

```bash
bash mobile/sdk_reference/scripts/verify_100_frame_set.sh
```

Expected output:

```text
Verified 100 frames
```

