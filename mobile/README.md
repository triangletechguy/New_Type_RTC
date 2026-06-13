# TalkEachOther Mobile

Flutter mobile client for the TalkEachOther RTC platform.

The default mobile entry point opens the deployed/web RTC experience in an
embedded WebView, requests camera and microphone permission for WebRTC, and
keeps the native room/login screens in the project for direct API testing.

## Run Locally

From the `mobile` directory:

```bash
flutter pub get
flutter run \
  --dart-define=WEB_APP_URL=http://10.0.2.2:5173 \
  --dart-define=API_BASE_URL=http://10.0.2.2:8000/api \
  --dart-define=SIGNALING_URL=http://10.0.2.2:8000
```

Android emulators use `10.0.2.2` to reach services running on the host machine.
Use production HTTPS URLs for release builds.
