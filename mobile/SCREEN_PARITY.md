# Screen Parity Report

Captured on 2026-06-14 after Step 19.

This report compares the native Flutter screens against the frozen web/mobile
reference in `WEB_REFERENCE.md`. It is a migration checkpoint, not a claim that
every web micro-interaction is complete.

## Verification Commands

- `git diff --check`
- `flutter analyze`
- `flutter test`
- `flutter build apk --debug`
- `adb -s emulator-5554 install -r build/app/outputs/flutter-apk/app-debug.apk`
- `adb -s emulator-5554 shell am start -n com.rtcenterprise.rtc_enterprise_mobile/.MainActivity`

## Screen Matrix

| Screen | Web reference | Flutter owner | Automated checks | Result |
| --- | --- | --- | --- | --- |
| App shell and routes | `frontend/src/App.jsx`, `Sidebar.jsx` | `lib/main.dart`, `lib/navigation/app_routes.dart` | `widget_test.dart` native route registry and admin role gate | Pass |
| Auth login/signup | `AuthModal.jsx`, `LoginScreen.jsx` | `lib/screens/login_screen.dart`, `lib/services/api_client.dart` | `login_screen_test.dart`, `api_client_test.dart` | Pass |
| Room lobby/feed | `RoomsView.jsx`, `roomsStaticData.js` | `lib/screens/room_list_screen.dart`, `lib/models/room.dart` | `room_lobby_test.dart` | Pass |
| Create room | `RoomsView.jsx` host panel | `_CreateRoomSheet` in `room_list_screen.dart` | `room_lobby_test.dart`, `api_client_test.dart` | Pass |
| Live room | `LiveRoomView.jsx`, `VideoTile.jsx`, `RtcConnectionIndicator.jsx` | `lib/screens/live_room_screen.dart`, RTC/signaling services | `live_room_screen_test.dart` | Pass for core native room/media flow |
| Profile/settings | `ProfilePanel.jsx`, room settings/profile menus | `lib/screens/profile_screen.dart`, `profile_settings_store.dart` | `profile_screen_test.dart`, `api_client_test.dart` | Pass for profile and local settings |
| Admin | `AdminView.jsx`, `adminUiBits.jsx`, `adminStaticData.js` | `lib/screens/admin_dashboard_screen.dart`, `api_client.dart` | `admin_sdk_screen_test.dart`, `api_client_test.dart`, `widget_test.dart` | Pass for core native console |
| SDK docs | `SdkView.jsx` | `lib/screens/sdk_docs_screen.dart` | `admin_sdk_screen_test.dart` | Pass |
| WebView reference | Web frontend | Removed from mobile runtime in Step 20 | `widget_test.dart` verifies native-only route registry | Removed |

## Remaining Gaps

- Live room still needs deeper parity for full chat history behavior, direct
  messages, follow/social actions, screen sharing, effects, and multi-device
  WebRTC integration testing.
- Profile avatar parity is still partial because native binary picker/crop and
  compression are not wired yet.
- Admin has the core mobile console and mutations, but richer company
  create/edit, service package editor, admin invite/delete, and dense table
  workflows still need the final web-level polish.
- SDK docs match the practical structure, but copy/share buttons and exact web
  wording/layout polish remain.
- Android emulator smoke verification launched the native Flutter APK without
  starting the web frontend. A deeper two-client RTC device test is still
  needed for media QA.

## Step 19 Outcome

The native Flutter project now has automated coverage for each major screen
listed in the web reference. Step 20 removed the WebView dependency; remaining
items are polish or deeper integration work.
