# TalkEachOther Mobile

Flutter mobile client for the TalkEachOther RTC platform.

The migration target is a native Flutter app that matches the rtc-enterprise
web/mobile UI and functions without depending on the web frontend at runtime.
See [NATIVE_MIGRATION.md](NATIVE_MIGRATION.md) for the migration contract and
step-by-step parity plan.

The default mobile entry point opens the native Flutter shell. The mobile app
does not include a WebView frontend wrapper.

For client-company mobile integration, see [SDK_INTEGRATION.md](SDK_INTEGRATION.md)
and the reusable SDK wrapper at `lib/sdk/rtc_enterprise_client_sdk.dart`.

## Run Locally

From the `mobile` directory:

```bash
flutter pub get
flutter run \
  --dart-define=API_BASE_URL=http://10.0.2.2:8000/api \
  --dart-define=SIGNALING_URL=http://10.0.2.2:8000
```

Android emulators use `10.0.2.2` to reach services running on the host machine.
For a physical Android phone on the same network, start the backend with
`HOST=0.0.0.0` and build with the host computer LAN IP instead:

```bash
LAN_IP=$(hostname -I | awk '{print $1}')
HOST=0.0.0.0 npm --prefix ../backend start
flutter run -d <device-id> \
  --dart-define=API_BASE_URL=http://$LAN_IP:8000/api \
  --dart-define=SIGNALING_URL=http://$LAN_IP:8000
```

Use production HTTPS URLs for release builds.
