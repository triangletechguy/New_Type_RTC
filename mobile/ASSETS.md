# Native Flutter Asset Manifest

Captured on 2026-06-14.

The native mobile app mirrors the web RTC visual asset set from:

- `frontend/src/assets/rtc/`

Copied Flutter asset root:

- `mobile/assets/rtc/`

The web-only JavaScript module is intentionally not copied:

- `frontend/src/assets/rtc/catalog.js`

## Flutter Registration

Assets are registered in `mobile/pubspec.yaml`:

```yaml
flutter:
  assets:
    - assets/rtc/loading.gif
    - assets/rtc/admin/
    - assets/rtc/asset-image2/
    - assets/rtc/avatars/
    - assets/rtc/brand/
    - assets/rtc/live-ui/
    - assets/rtc/modern-project-svgs/
    - assets/rtc/rooms/
```

The source-of-truth Dart constants live in:

- `mobile/lib/ui/rtc_assets.dart`

`RtcAssets.allBundledAssets` lists the copied files that must be present in the
Flutter asset bundle. `mobile/test/widget_test.dart` loads Flutter's generated
asset manifest and verifies every listed asset is registered.

## Copied Folders

| Folder | Count | Purpose |
| --- | ---: | --- |
| `admin/` | 2 | Admin empty/sidebar states |
| `asset-image2/` | 8 | Smart mobile and lobby imagery |
| `avatars/` | 11 | User/avatar/action imagery |
| `brand/` | 1 | App screenshot graphic |
| `live-ui/` | 7 | Live room control/icon SVGs |
| `modern-project-svgs/` | 8 | Brand/navigation SVGs |
| `rooms/` | 11 | Room cover images |
| root | 1 | Loading animation |

Total copied files: 49.

## Step 9 Acceptance

- The Flutter tree matches the web RTC asset tree, excluding `catalog.js`.
- `pubspec.yaml` registers the asset root.
- `RtcAssets` exposes typed constants for screens/components.
- Tests verify assets are actually visible to Flutter's asset bundle.
