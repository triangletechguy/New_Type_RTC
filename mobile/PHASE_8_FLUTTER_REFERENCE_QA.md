# Phase 8 - Flutter Reference QA

This phase verifies the Flutter mobile app against the 100-frame mobile RTC reference set.

## Scope

- Static Flutter checks.
- 100-frame reference set verification.
- Emulator screenshot capture when an Android device is available.
- Manual comparison against the contact sheet:
  - `mobile/sdk_reference/images/new_mobile_RTC_100_contact_sheet.jpg`

## Script

Run from the repository root:

```bash
bash mobile/sdk_reference/scripts/verify_phase8_flutter_reference.sh
```

The script:

- Verifies all 100 reference frames and the contact sheet.
- Runs `flutter analyze`.
- Runs `flutter test`.
- Captures an emulator screenshot if an authorized adb device is connected.
- Writes evidence under:

```text
mobile/sdk_reference/phase8_evidence/
```

## Emulator Capture

Start an emulator:

```bash
flutter emulators --launch rtc_pixel_api_36
```

Run the app:

```bash
cd mobile
flutter run -d emulator-5554 \
  --dart-define=API_BASE_URL=https://funint.online/api \
  --dart-define=SIGNALING_URL=https://funint.online
```

Capture and compare:

```bash
cd ..
DEVICE_ID=emulator-5554 \
  bash mobile/sdk_reference/scripts/verify_phase8_flutter_reference.sh
```

If no device is connected, the script still runs static QA and records that screenshot capture was skipped. To require a device, run:

```bash
REQUIRE_DEVICE=1 bash mobile/sdk_reference/scripts/verify_phase8_flutter_reference.sh
```

## Manual Comparison Checklist

- Room feed matches the intended mobile flow.
- Live room has a main media stage.
- Local preview is visible after permissions are granted.
- Remote participant tile appears when a second client joins.
- Bottom controls are visible and usable.
- Chat opens without hiding the whole call.
- Room Admin panel opens correctly.
- Leave room ends the session and removes participants.

## Current Verification

Static checks should pass before emulator QA:

```bash
flutter analyze
flutter test
```

Current run status:

- 100-frame reference verification passed.
- `flutter analyze` passed.
- `flutter test` passed.
- Emulator screenshot capture was attempted but blocked before Android boot because the WSL Android emulator runtime is missing `libpulse.so.0`.
- `sudo` is not available in this shell, so `libpulse0` cannot be installed from here.

Emulator runtime fix for the local machine:

```bash
sudo apt-get update
sudo apt-get install -y libpulse0
flutter emulators --launch rtc_pixel_api_36
```

After the emulator boots, rerun:

```bash
DEVICE_ID=emulator-5554 \
  bash mobile/sdk_reference/scripts/verify_phase8_flutter_reference.sh
```
