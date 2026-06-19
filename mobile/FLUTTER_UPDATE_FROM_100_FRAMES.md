# Flutter Update Guide From 100 Reference Frames

This guide is for updating only the Flutter mobile app in:

```text
mobile/
```

It does not require changing the Android SDK module unless you decide to replace the current Flutter WebRTC media layer with the native Android SDK later.

## Reference Files

Use these reference files first:

```text
mobile/sdk_reference/frames_100/
mobile/sdk_reference/frames_100/index.tsv
mobile/sdk_reference/images/new_mobile_RTC_100_contact_sheet.jpg
```

The 100 images show the target mobile RTC behavior:

- Live room/call surface.
- Large active speaker or shared screen area.
- Local self preview.
- Remote participant tiles.
- Bottom call controls.
- Chat and notification panels.
- Room participant list.
- Room-admin/moderation controls.
- Screen sharing and multi-participant layout.
- Join, leave, permission, and error states.

## Main Flutter Files To Update

Update these files first:

```text
mobile/lib/screens/room_list_screen.dart
mobile/lib/screens/live_room_screen.dart
mobile/lib/services/api_client.dart
mobile/lib/services/rtc_media_service.dart
mobile/lib/services/rtc_peer_connection_service.dart
mobile/lib/services/signaling_service.dart
mobile/lib/models/room.dart
mobile/lib/models/app_user.dart
mobile/lib/ui/rtc_mobile_ui.dart
mobile/lib/ui/rtc_assets.dart
```

Use these files for app routing and config:

```text
mobile/lib/main.dart
mobile/lib/navigation/app_routes.dart
mobile/lib/config/app_config.dart
```

## Update Order

### 1. Audit The 100 Frames

Phase 1 output:

```text
mobile/PHASE_1_FLUTTER_FRAME_SCOPE.md
```

Open the contact sheet:

```text
mobile/sdk_reference/images/new_mobile_RTC_100_contact_sheet.jpg
```

Then inspect individual frames when needed:

```text
mobile/sdk_reference/frames_100/frame_001.jpg
mobile/sdk_reference/frames_100/frame_025.jpg
mobile/sdk_reference/frames_100/frame_050.jpg
mobile/sdk_reference/frames_100/frame_075.jpg
mobile/sdk_reference/frames_100/frame_100.jpg
```

Create a small checklist for each visible state:

- Room feed state.
- Joining/loading state.
- Permission state.
- In-room audio state.
- In-room video state.
- Screen-share state.
- Chat panel state.
- Participant panel state.
- Room-admin controls state.
- Leave/end state.

### 2. Update Room Feed

Phase 2 output:

```text
mobile/PHASE_2_FLUTTER_ROOM_FEED.md
```

File:

```text
mobile/lib/screens/room_list_screen.dart
```

Implement or refine:

- Native mobile feed layout.
- Room filters: live/recent/following/group.
- Search.
- Create room sheet.
- Room card states: audio, video, live, locked/private, participant count.
- Bottom navigation for live, messages, profile/settings.
- Tap room opens `LiveRoomScreen` through `AppRoutes.liveRoom`.

Acceptance check:

- User can load rooms.
- User can create a room.
- User can open a room.
- Empty/loading/error states look mobile-native.

### 3. Update Live Room Layout

Phase 3 output:

```text
mobile/PHASE_3_FLUTTER_LIVE_ROOM.md
```

File:

```text
mobile/lib/screens/live_room_screen.dart
```

Match the 100-frame behavior:

- Large main stage for active speaker or shared screen.
- Local preview tile.
- Remote participant tiles.
- Bottom control bar.
- Join/leave button states.
- Mic toggle.
- Camera toggle.
- Screen-share indicator.
- Room password/access panel for locked rooms.
- Chat panel.
- Participant panel.
- Admin/moderation panel for allowed roles.

Layout priorities:

- Phone portrait must be the primary layout.
- Keep call controls reachable at the bottom.
- Panels should open as bottom sheets or slide-up panels.
- Main media area should remain visible when panels are open.
- Avoid desktop-only layouts inside the mobile app.

### 4. Update Media Permission And Local Preview

Phase 4 output:

```text
mobile/PHASE_4_FLUTTER_MEDIA_PERMISSIONS.md
```

File:

```text
mobile/lib/services/rtc_media_service.dart
```

Confirm these behaviors:

- Request microphone before audio join.
- Request camera before video join.
- Show clear denied-permission state.
- Open local camera stream for video rooms.
- Keep audio-only rooms from requesting camera.
- Handle Bluetooth permission on Android when required.

Acceptance check:

```bash
cd mobile
flutter run -d emulator-5554 \
  --dart-define=API_BASE_URL=https://funint.online/api \
  --dart-define=SIGNALING_URL=https://funint.online
```

Then confirm:

- Permission prompt appears.
- Denying permission shows a helpful error.
- Granting permission shows local preview.

### 5. Update Signaling And Peer Flow

Phase 5 output:

```text
mobile/PHASE_5_FLUTTER_SIGNALING_PEERS.md
```

Files:

```text
mobile/lib/services/signaling_service.dart
mobile/lib/services/rtc_peer_connection_service.dart
```

Required flow:

1. Join backend room through `ApiClient`.
2. Read `rtc.signaling_room`.
3. Connect Socket.IO signaling.
4. Join signaling room.
5. Receive existing peers.
6. Create peer connections.
7. Exchange offer/answer/ICE.
8. Render remote streams.
9. Update peer media state when mic/camera/screen state changes.
10. Cleanly disconnect on leave.

Acceptance check:

- Two clients can enter the same room.
- Existing users appear.
- New users appear without app restart.
- Leaving removes the participant tile.
- Reconnect does not duplicate tiles.

### 6. Update Chat, Notifications, And Room Controls

Phase 6 output:

```text
mobile/PHASE_6_FLUTTER_CHAT_CONTROLS.md
```

Files:

```text
mobile/lib/screens/live_room_screen.dart
mobile/lib/services/signaling_service.dart
mobile/lib/services/api_client.dart
```

Implement or refine:

- Room chat list.
- Send message.
- Delete/unsend message where allowed.
- Notification/toast display.
- Participant list.
- Stage request flow.
- Room-admin actions.
- Moderation action feedback.

Use these UI labels:

- Platform service admin: platform/company management only.
- Company service admin: company RTC service management.
- Room admin: in-room moderation.

Do not call room moderators just `admin` in the mobile UI.

### 7. Update Shared UI Components

Phase 7 output:

```text
mobile/PHASE_7_FLUTTER_SHARED_UI.md
```

Files:

```text
mobile/lib/ui/rtc_mobile_ui.dart
mobile/lib/ui/rtc_assets.dart
```

Put repeated mobile components here:

- Control buttons.
- Room cards.
- Participant tiles.
- Empty states.
- Loading states.
- Error banners.
- Bottom-sheet panel shells.
- Avatar and badge components.

Keep style consistent:

- Dark RTC call surface.
- Clear active/inactive states.
- High contrast controls.
- Touch targets large enough for mobile.
- No web-only desktop panels.

### 8. Test Against The Reference Frames

Phase 8 output:

```text
mobile/PHASE_8_FLUTTER_REFERENCE_QA.md
mobile/sdk_reference/scripts/verify_phase8_flutter_reference.sh
```

Run static checks:

```bash
cd mobile
flutter analyze
flutter test
```

Run on emulator:

```bash
flutter run -d emulator-5554 \
  --dart-define=API_BASE_URL=https://funint.online/api \
  --dart-define=SIGNALING_URL=https://funint.online
```

Capture emulator screenshots:

```bash
adb exec-out screencap -p > /tmp/rtc-mobile-current.png
```

Compare your screen with:

```text
mobile/sdk_reference/images/new_mobile_RTC_100_contact_sheet.jpg
```

Manual comparison checklist:

- Room feed matches intended mobile flow.
- Live room has main media stage.
- Local preview is visible.
- Remote participant tile appears.
- Bottom controls are visible and usable.
- Chat opens without hiding the whole call.
- Participant/admin panel opens correctly.
- Leave room ends the session.

### 9. Build The Flutter App

Phase 9 output:

```text
mobile/PHASE_9_FLUTTER_RELEASE_BUILD.md
mobile/sdk_reference/scripts/verify_phase9_flutter_release_build.sh
```

Build APK:

```bash
cd mobile
flutter build apk --release \
  --dart-define=API_BASE_URL=https://funint.online/api \
  --dart-define=SIGNALING_URL=https://funint.online
```

Output:

```text
mobile/build/app/outputs/flutter-apk/app-release.apk
```

Build AAB:

```bash
flutter build appbundle --release \
  --dart-define=API_BASE_URL=https://funint.online/api \
  --dart-define=SIGNALING_URL=https://funint.online
```

Output:

```text
mobile/build/app/outputs/bundle/release/app-release.aab
```

## Final Acceptance Checklist

- App opens without WebView dependency.
- Login/session restore works.
- Room feed loads from backend.
- Room create/open works.
- User can join a room.
- Local audio works.
- Local camera preview works in video room.
- Remote participant appears.
- Chat panel works.
- Participant panel works.
- Room-admin labels are clear.
- Leave room cleans up media and signaling.
- `flutter analyze` passes.
- `flutter test` passes.
- Release APK builds.
- Release AAB builds.
