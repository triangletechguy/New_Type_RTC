# rtc_enterprise_mobile

Flutter mobile client for the RTC Enterprise backend.

## Local backend URLs

The Android emulator cannot reach your computer's backend through `127.0.0.1`.
The default mobile config therefore uses:

- API: `http://10.0.2.2:8000/api`
- Signaling: `http://10.0.2.2:8000`

For a physical phone or deployed backend, pass the real reachable host:

```sh
flutter run \
  --dart-define=API_BASE_URL=http://YOUR_HOST:8000/api \
  --dart-define=SIGNALING_URL=http://YOUR_HOST:8000
```

Use HTTPS/WSS URLs for production.
