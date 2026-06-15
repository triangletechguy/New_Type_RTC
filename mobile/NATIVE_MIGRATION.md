# Native Flutter Migration

## Goal

Build `mobile/` as the native Flutter version of rtc-enterprise. The app should
match the web/mobile UI and functions, but it must run without loading the web
frontend in a WebView.

## Acceptance Criteria

- The normal Flutter entry point uses native Flutter screens.
- The mobile app has no WebView frontend dependency.
- Flutter calls the rtc-enterprise backend APIs directly through `API_BASE_URL`.
- Flutter connects to RTC signaling directly through `SIGNALING_URL`.
- Login, signup, rooms, live room, profile, admin, and SDK docs have native
  Flutter screens.
- The native Flutter UI matches the web/mobile reference for layout, colors,
  actions, loading states, empty states, and error states.
- The app passes `flutter analyze` and `flutter test`.
- Android emulator verification succeeds without running the frontend dev
  server.

## Current State

- `NativeRtcShell` is now the default entry point.
- The former debug WebView reference screen has been removed.
- Several native screens already exist.
- Web assets have started moving into `mobile/assets/rtc/`.
- Web reference files remain documentation/source-of-truth only.

## Reference Documents

- [WEB_REFERENCE.md](WEB_REFERENCE.md) freezes the web/mobile app as the native
  Flutter parity target.
- [FLUTTER_AUDIT.md](FLUTTER_AUDIT.md) records the current native Flutter app
  state and parity gaps.
- [FEATURE_MAP.md](FEATURE_MAP.md) maps each web feature to its native Flutter
  owner, status, API needs, and acceptance criteria.
- [NATIVE_ROUTES.md](NATIVE_ROUTES.md) records the native route registry and
  routing rules.
- [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) records the native Flutter UI tokens and
  reusable components.
- [ASSETS.md](ASSETS.md) records the copied web RTC asset set and Flutter
  registration guard.
- [SCREEN_PARITY.md](SCREEN_PARITY.md) records the Step 19 screen-by-screen
  parity pass and remaining gaps.

## 20-Step Plan

- [x] 1. Set the native Flutter goal and acceptance criteria.
- [x] 2. Freeze the web version as the reference.
- [x] 3. Audit the current Flutter app.
- [x] 4. Create the web-to-Flutter feature map.
- [x] 5. Switch the default app entry to native Flutter.
- [x] 6. Keep WebView only as a debug reference.
- [x] 7. Finalize native app routing.
- [x] 8. Rebuild the design system in Flutter.
- [x] 9. Import and register web assets.
- [x] 10. Match theme and typography.
- [x] 11. Complete auth API integration.
- [x] 12. Build native login and signup UI.
- [x] 13. Build native room lobby.
- [x] 14. Build native create room flow.
- [x] 15. Build native live room screen.
- [x] 16. Connect native RTC signaling.
- [x] 17. Build native profile and settings.
- [x] 18. Build native admin and SDK screens.
- [x] 19. Test screen-by-screen against web.
- [x] 20. Remove WebView dependency.
