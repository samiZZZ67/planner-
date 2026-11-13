# Sam'Space Mobile Setup

The Flutter client is in `mobile_app/`. It is a native Flutter app, not a WebView wrapper. The original Next.js/PWA application and backend stay in their current locations.

## Requirements

- Flutter 3.47.9 or newer in the current project toolchain; Dart 3.13.7.
- Android Studio with Android SDK and platform tools for Android builds. Accept SDK licenses and confirm `flutter doctor -v` reports Android toolchain available.
- Xcode on macOS for iOS builds and signing.
- A reachable Sam'Space backend. Use a deployed HTTPS URL for production. The development app can use an HTTP LAN URL on Android debug builds.

The repository environment used for this migration does not currently have the Android SDK installed. Package resolution also encountered a `pub.dev` socket error; rerun `flutter pub get` once package access is available before analysis, testing, or building.

## Install packages and run

From `mobile_app/`:

```powershell
flutter pub get
flutter analyze
flutter test
flutter run --dart-define=API_BASE_URL=https://your-planner.example.com
```

On Android Emulator, the host computer is commonly available at `http://10.0.2.2:3000` when running the backend locally. For a physical phone, use the computer's LAN address and allow the dev server through the local firewall. These HTTP URLs are for debug only. iOS and release builds should use HTTPS.

If `API_BASE_URL` is omitted, enter the API origin on the sign-in screen or save it under **More → Settings → Cloud sync**. The app stores the URL in SQLite preferences. It asks for the existing shared master password; the returned session token is stored in platform secure storage.

## Data, offline use, and transfer

Tasks, sections, daily notes/reviews, timer logs, weekly/monthly plans, and timer state are stored locally in SQLite. Sync uses the existing `/api/sync` sequence contract, retries with capped backoff after a failed request, and runs when the user taps Sync now or returns to the app. Book PDFs, photos, assistant requests, and Telegram operations require server access.

The browser and mobile devices do not share IndexedDB. To move browser-only unsynced data, export a JSON backup from web Settings, then import it in mobile Settings. Mobile exports the supported six sync collections. Backups contain planner data, not the secure session token.

## Android configuration and builds

Application ID: `com.samsspace.sams_space`  
Display name: `Sam'Space`  
Android and iOS project scaffolds are present. Camera/photo usage messages and Android Internet/Camera permissions are configured.

Build commands from `mobile_app/`:

```powershell
flutter build apk --debug --dart-define=API_BASE_URL=https://your-planner.example.com
flutter build apk --release --dart-define=API_BASE_URL=https://your-planner.example.com
flutter build appbundle --release --dart-define=API_BASE_URL=https://your-planner.example.com
```

Artifacts are written under `build/app/outputs/flutter-apk/` and `build/app/outputs/bundle/release/`. Release builds read the private upload-key settings from `android/key.properties`; copy `android/key.properties.example`, replace every placeholder with the actual keystore path and passwords, and keep both that file and the keystore out of source control. Without a local key file, release signing is not configured. Confirm the package ID is available and appropriate before store publication.

If using a development backend over HTTP, Android debug permits cleartext traffic; the release client rejects HTTP URLs. The iOS project can be opened in Xcode on macOS for signing and builds. iOS provisioning, App Store signing, and push notification entitlements are not configured.

## Current feature coverage and limits

The app includes password sign-in/session persistence; Today tasks and completion; task create/edit/delete; timer and logs; categories; notes/review; weekly/monthly plans and weekly report; analytics; diary text/photos; JSON backup import/export; book upload/download, extraction, reading plans, generated notes, quizzes and Telegram publishing; Sam's AI and Moon AI text chat/history; Telegram status, quick text send, publishing pause and delivery history.

Mobile follow-up work remains for rich HTML note editing, full OCR preview/correction, in-app PDF reading, editing assignment notes/schedules, native local/push notifications, wake-word/dictation/speech playback, and AI image/video generation controls. See `MOBILE_MIGRATION_PLAN.md` and `TESTING_REPORT.md` for status.
