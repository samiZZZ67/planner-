# Sam'Space Mobile Migration Plan

**Review date:** 2026-11-12  
**Scope:** Native-feeling Flutter application in `mobile_app/`; keep the existing web/PWA and backend operating independently.  
**Phase:** Analysis complete; implementation in progress; package verification and Android builds are blocked by unavailable dependencies and SDK tooling.

## 1. Executive Summary

The repository contains Sam'Space, an offline-first productivity and study-planning PWA. It uses Next.js 16.4 App Router, React 19.3, TypeScript, Tailwind CSS 4, Dexie/IndexedDB, a custom Node.js server, optional Neon Postgres, and Socket.IO. It is not a website-only frontend: the app already has an API, server-side business logic, file storage integration, and scheduled Telegram services.

The Flutter app should be a separate client under `mobile_app/`. It should reuse the existing authenticated API and keep the current web application unchanged. Core planning records can be edited offline in a mobile local database and synchronized through the existing delta-sync endpoint. Book files and most AI, voice, and Telegram operations require a network connection and remain backed by existing server endpoints.

No database schema change is currently needed. Do not put server-side credentials in the app. Production use requires a configured HTTPS API base URL. The deployed API URL is not discoverable from this repository alone, so the app must support an explicit build-time URL and a user-editable development override.

## 2. Repository and Runtime Findings

| Area | Finding | Evidence |
|---|---|---|
| Web framework | Next.js 16.4.0 App Router, React 19.3.0, TypeScript 5, Tailwind CSS 4 | `package.json`, `next.config.ts`, `src/app/` |
| Client-side data | Dexie database named `NightPlannerDB` in browser IndexedDB | `src/lib/db/index.ts` |
| Server | Next.js route handlers plus custom Node server with Socket.IO and `node-cron` | `src/app/api/**/route.ts`, `server.js` |
| Cloud database | Neon Postgres via `@neondatabase/serverless`; a local server-store fallback also exists | `src/lib/server/neon.ts`, `src/lib/server/localDb.ts`, `schema.sql` |
| Files | Optional Cloudinary upload API; private book PDFs are stored by the backend and need persistent server storage in production | `src/lib/server/files.ts`, `src/lib/server/cloudinary.ts`, `src/lib/server/books.ts`, `DEPLOY.md` |
| Authentication | One shared `APP_PASSWORD`; signed session token returned by `/api/login`, accepted as a bearer token or cookie; no user registration, password reset, profile, or role system was found | `src/lib/server/auth.ts`, `src/app/api/login/route.ts`, `src/app/api/auth/verify/route.ts` |
| Web API client | `apiFetch` adds the local `np_session_token`, includes cookies, and uses `NEXT_PUBLIC_API_URL` or a local override | `src/lib/api/apiClient.ts` |
| Offline behavior | Main planning records and timer state are local first. Sync uses monotonically increasing `server_seq`, server acknowledgements, soft-delete flags, `updatedAt`, and newest-timestamp conflict resolution | `src/lib/db/index.ts`, `src/lib/sync/`, `src/app/api/sync/route.ts`, `src/lib/server/neon.ts` |
| Web deployment | All-in-one Render or split Vercel frontend/Render backend; environment and scheduled-job details are in `DEPLOY.md` | `server.js`, `DEPLOY.md` |
| Mobile tooling | Flutter 3.47.9 and Dart 3.13.7 are installed. Android SDK is absent, so Gradle APK/AAB packaging is not currently available. | `flutter doctor -v`, local environment inspection |
| Worktree | Clean at start of review | `git status --short --branch` |

### Existing local and server data

The local IndexedDB schema contains `sections`, `tasks`, `timeLogs`, `days`, `weeklyPlans`, `monthlyPlans`, `aiConversations`, and `aiMessages`, plus sync metadata and drafts. The existing `/api/sync` contract covers the first six collections. AI history uses `/api/ai/history` separately. The SQL schema also contains books, extracted book pages, assignments, AI history, Telegram deliveries, publishing jobs/settings, and related indexes. The mobile work must preserve those field meanings and avoid DDL changes.

The web browser's IndexedDB is not directly readable by Flutter. Data already synced to the shared server is available to the mobile app after authentication. Unsynced browser-only records require an explicit transfer, preferably using the existing Settings JSON export/import format; automatic access to browser-local records is not possible.

### Authentication behavior to preserve

- The app uses one shared master password, not individual accounts. The current code has no sign-up, password-recovery, or profile APIs.
- `/api/login` returns a signed session token and sets an HTTP-only cookie. The API also accepts the token in `Authorization: Bearer ...`, which is suitable for Flutter.
- `/api/auth/verify` checks a session; `/api/logout` clears the cookie. Flutter should also clear its secure token on logout and on a confirmed invalid-session response.
- The web shell shows a full-screen lock until a session is verified. When verification fails because the network is unavailable, it allows access if a token is already stored. The README also describes local-first use without cloud sync; the mobile implementation should preserve offline access after a successful sign-in, while making initial sign-in requirements clear.
- The web client currently stores its token in localStorage. The mobile client must use platform secure storage.

## 3. Routes and Feature Inventory

### Visible application routes

| Route / view | Current implementation | Mobile destination |
|---|---|---|
| `/` | Main client shell in `src/app/page.tsx`; includes auth gate, date/theme state, deep links, the feature tabs, modals, timer, and AI entry points | GoRouter shell with prioritized bottom navigation and secondary screens in a drawer or More area |
| `/?tab=...` | Deep links select one of ten root tabs; book quiz links can set book/assignment IDs | Typed GoRouter paths and query parameters with equivalent book/assignment context |
| `/books` | Redirect to the root Book Planner tab, retaining query parameters | Book Planner route |
| `/quiz` | Standalone interactive assignment/session quiz | Quiz route with persisted in-progress answers |
| `/health` and `/api/health` | Server health checks, not user-facing screens | Not a primary mobile screen; useful for API connection diagnostics |

The ten active root tabs are **To-Do List, Weekly Plan, Monthly Plan, Add Task, Note, Diary, Category, Book Planner, Analytics, and Settings**. The phone UI currently provides a scrollable bottom tab bar. The PC UI has a sidebar and keyboard shortcuts. The top bar also provides timer controls, sync status, settings, theme toggle, lock/logout, and Sam's AI.

`TodayScreen`, `TodoScreen`, `PlanScreen`, and `ProgressScreen` exist as component modules but are not imported by the active root shell. Treat their code as legacy/reference material and reconcile their distinct behavior with the active views before claiming that every one is a current route.

### Feature-level inventory

| Feature | Existing implementation | Data and backend relationship |
|---|---|---|
| Authentication and protected access | `src/components/Auth/MasterLockScreen.tsx`, `src/components/Modals/LoginModal.tsx`, root shell, `src/lib/server/auth.ts` | Shared master password; session token verified with `/api/auth/verify`; login/logout use `/api/login` and `/api/logout`. No account/profile CRUD. |
| To-do list and daily schedule | `src/components/TodoList/TodoListScreen.tsx`; related planning logic in `src/lib/plan/` | Tasks, dates, sections, order, status, priority, duration, schedule times, due dates, tags, notes, completion, and day sheet data are local first and included in `/api/sync`. |
| Task authoring and editing | `src/components/AddTask/AddTaskScreen.tsx`, `src/components/Modals/TaskFormModal.tsx` | Task title, description, strategy, done-means, estimated/scheduled time, priority, must-do flag, tags, section, style/image, completion and result fields; saved locally and synced. Existing task JSON is defined in `src/types/index.ts`. |
| Timer and time logging | `src/lib/timer/useTimer.ts`, `src/components/Header.tsx`, active daily/task screens, `src/lib/notifications/notificationManager.ts` | Active timer epoch/state is stored locally; stopping creates timer/manual `TimeLog` records that sync. Includes focus/break Pomodoro sessions, pause/resume, elapsed-time recovery, completion alerts and chimes. |
| Categories and targets | `src/components/Category/CategoryScreen.tsx` | Section name, color, icon, ordering and daily target/type; section CRUD and associated task grouping use local DB plus `/api/sync`. |
| Weekly plan and report | `src/components/Weekly/WeeklyPlanScreen.tsx`, `src/lib/plan/weeklyPlanUtils.ts` | Weekly prompt, goals, commitments, deep-work targets, constraints, outcomes, status and completion percentage sync as `weeklyPlans`; generated report calls `/api/ai/weekly-report`. |
| Monthly plan and goals | `src/components/Monthly/MonthlyPlanScreen.tsx` | Monthly title/prompt, academic priorities, editing targets, commitments, goal checklist, status and completion percentage sync as `monthlyPlans`. |
| Daily notes and reflection | `src/components/Note/NoteScreen.tsx`, `src/components/Note/VisualRichEditor.tsx`, `src/components/Today/TodayScreen.tsx` | Day review fields and quick-note HTML are stored in `days.review` and `days.sheetData`, then included in sync. Review includes worked/blocked/change and additional reflection prompts. |
| Day sheet and routines | `src/components/Plan/PlanScreen.tsx` (currently not wired into root), related task/sheet logic | `days.sheetData` supports notes, schedule slots, meals, water glasses and exercise. Preserve if this screen is reintroduced; do not mistake its lack of a current root tab for an API-backed route. |
| Diary and photos | `src/components/Diary/DiaryScreen.tsx` | Diary text/photos are stored under `days.sheetData.diary`; text is local-first and syncs with the day. Photo upload requires an authenticated session and uses `POST /api/files` (optional Cloudinary). Photo removal updates the diary record and file API as implemented. |
| Analytics and progress | Active `src/components/Analytics/AnalyticsScreen.tsx`, `FullScreenDailyGraphModal.tsx`; `src/components/Progress/ProgressScreen.tsx` is not wired into root | Aggregates local tasks/time logs/sections into period comparisons, daily/cumulative curves, estimated-vs-actual time, section distribution, ranking and daily breakdowns. Mostly computed on-device; no separate analytics API. |
| Book planner and study workflow | `src/components/Books/BookPlannerScreen.tsx`, `BookReviewModal.tsx`, `BookAnalyticsModal.tsx`, `InteractiveQuizCard.tsx`, `LiveBookDeliveryCountdown.tsx`, `src/lib/server/books/` | Upload PDF, book metadata, extraction/OCR status, page-level extracted text and review state, reading assignments, learning packages, notes, quizzes, progress and delivery status. API under `/api/books/**`; PDFs/page previews are server-backed. Upload limit and PDF storage behavior are enforced server-side. |
| Book quiz | `src/app/quiz/page.tsx`, `/api/quiz`, assignment quiz routes | Questions reference PDF pages; selected answers and results are persisted locally in web storage during the quiz. Submission/results use the backend; mobile should persist attempts locally and preserve assignment/session deep links. |
| Sam's AI and plan actions | `src/components/Chat/AIChatPanel.tsx`, `src/lib/server/ai/`, `src/app/api/ai/**` | Chat history is stored locally and synchronized separately through `/api/ai/history`; chat can use tasks, sections, plans, timer context and actions. AI chat, plan interview, day-plan generation, weekly report and provider configuration are server endpoints. Provider credentials remain server-only. |
| FreeLLM assistant | `src/components/FreeLLM/FreeLLMAssistant.tsx`, `TelegramQuickSend.tsx`, `src/lib/server/freellm/` | Separate assistant/conversation state and model selection; gateway chat, status, transcription, speech, image and asynchronous video generation use `/api/ai/freellm/**`. Voice mode uses mic capture and speech playback; Telegram quick-send can send text/image/voice. Keep model/API secrets on the backend. |
| Voice assistant and speech | `src/lib/voice/`, `src/lib/server/voice/`, `/api/ai/voice-assistant`, `/api/voice/config`, `/api/voice/synthesize` | Browser wake-word/intent routing, dictation/transcription, action intents, neural or system voice, provider selection and playback. Mobile equivalents need native permission and lifecycle handling; do not assume browser speech APIs exist in Flutter. |
| Telegram messaging and scheduled briefs | `src/components/Telegram/BriefSchedulingModal.tsx`, `src/lib/server/telegram*`, `src/lib/server/scheduler/` | Telegram status, direct text/media sends, task alerts, morning/evening briefs, quiz interactions, deliveries, automation controls, webhook, and cron routes. Server-side bot token/chat ID only. `node-cron` and protected `/api/cron/**` endpoints run without the mobile app. |
| External learning content | `src/lib/server/sources/` and book learning-generation code | Wikipedia, Wikiquote, Gutendex, ZenQuotes, YouTube and Podcast Index enrichment; credentials and provider-specific requests stay server-side. Related use is through existing server learning/AI workflows. |
| Local import/export and settings | `src/components/Settings/SettingsScreen.tsx`, `src/lib/data/sampleData.ts` | JSON data export/import; theme, Ethiopian/Gregorian calendar preference, notifications, AI config and Telegram scheduling controls. Mobile should support a compatible export/import file workflow and native settings equivalents. |
| Install/update and feedback | `src/lib/pwa/registerSw.ts`, `public/sw.js`, `UpdateBanner.tsx`, `ActionFeedbackHost.tsx`, icons/manifest | PWA cache/update banner and action feedback. Replace service-worker installation/update flows with Flutter app packaging and native loading/error/success feedback; keep the existing web PWA independent. |

### Core business rules to carry over

- Keep the core planner local-first. A network or sync failure must not discard local task, plan, review, or timer changes.
- Preserve record IDs, timestamps, soft deletion, server sequence tracking, `synced` state, and the existing `/api/sync` acknowledgement/remote-change format. When a local unsynced row is newer, keep it; otherwise apply the server row, including the current tie behavior.
- Preserve time tracking based on real clock epochs so elapsed time survives suspension/restarts. Mobile background notification behavior must be verified on device because Android can limit background execution.
- Preserve the app's Ethiopian/Gregorian date mode and Ethiopian clock rules. The default traditional planning day boundary is 06:00 in `Africa/Addis_Ababa`; book delivery times are timezone-aware.
- Keep existing AI, Telegram, file, and book policy/business logic on the backend. The mobile client should consume their current request/response contracts rather than reimplement server secrets or provider selection.
- Do not silently drop fields not yet displayed in a first mobile screen. Models and import/export should preserve fields so round-trips do not destroy existing data.

## 4. Backend Endpoint Inventory

All paths below are served by the existing Next.js backend unless noted. Protected endpoints use the existing signed session mechanism; `/api/login` establishes it. Cron and webhook endpoints are server operations, not ordinary mobile UI routes.

| Domain | Existing endpoints and methods | Mobile use |
|---|---|---|
| Session | `POST /api/login`; `GET /api/auth/verify`; `POST /api/logout` | Login, cached-session validation, logout. Send bearer token; do not depend on web cookies. |
| Core sync | `POST /api/sync` | Primary cloud delta sync for sections, tasks, time logs, days, weekly plans and monthly plans. Request includes `lastServerSeq` and pending arrays; response includes `currentServerSeq`, `acknowledgedIds`, and `serverChanges`. |
| Task service | `GET`, `POST /api/tasks` | Existing server task read/create/action endpoint; inspect action payload variants before using it. Core offline sync remains `/api/sync`. |
| Files | `POST`, `GET /api/files`; `GET`, `DELETE /api/files/{id}` | Diary/media upload and metadata; optional Cloudinary. |
| AI planning/chat | `POST /api/ai/chat`; `GET`, `POST /api/ai/config`; `GET`, `POST /api/ai/history`; `POST /api/ai/plan-interview`; `POST /api/ai/generate-day-plan`; `POST /api/ai/weekly-report`; `POST /api/ai/voice-assistant` | Connected chat, plan generation/interview, report, config and voice intent. Preserve server provider fallback and action validation. |
| FreeLLM | `OPTIONS`, `POST /api/ai/freellm/chat`; `OPTIONS`, `POST /api/ai/freellm/generate-image`; `GET`, `POST`, `OPTIONS /api/ai/freellm/generate-video`; `POST /api/ai/freellm/speech`; `POST`, `OPTIONS /api/ai/freellm/transcribe`; `GET`, `POST`, `OPTIONS /api/ai/freellm/status` | Assistant, media generation, job polling, speech/transcription and status. Not all features are useful offline. |
| Voice | `GET /api/voice/config`; `POST /api/voice/synthesize` | Voice provider/config discovery and audio synthesis. |
| Books | `GET`, `POST /api/books`; `PATCH`, `DELETE /api/books/{id}`; `GET`, `POST /api/books/{id}/assignments`; `GET`, `PATCH /api/books/{id}/assignments/{assignmentId}`; `PATCH /api/books/{id}/assignments/{assignmentId}/schedule`; `GET`, `POST /api/books/{id}/assignments/{assignmentId}/learning-package`; `POST`, `PATCH /api/books/{id}/assignments/{assignmentId}/notes`; `GET`, `POST /api/books/{id}/assignments/{assignmentId}/quiz`; `POST /api/books/{id}/assignments/{assignmentId}/publish`; `GET`, `POST /api/books/{id}/extract`; `GET`, `PATCH /api/books/{id}/pages`; `POST /api/books/{id}/pages/review`; `GET /api/books/{id}/pages/{page}/preview`; `GET /api/books/{id}/pdf`; `GET /api/books/assignment-lookup`; `GET`, `POST /api/books/external-sources` | Reuse for upload, reading schedule, extraction/review, learning package, study notes, quiz, PDF access, and publishing. |
| Quiz | `GET`, `POST /api/quiz` | Load and submit quiz/session outcomes. |
| Telegram | `GET`, `POST /api/telegram/status`; `POST /api/telegram/send`; `GET`, `POST /api/telegram/task-alerts`; `GET`, `POST /api/telegram/briefs`; `GET /api/telegram/deliveries`; `GET`, `POST /api/telegram/automation`; `GET`, `POST /api/telegram/quiz`; `GET`, `POST /api/telegram/webhook` | Status, manual sends and user scheduling controls. Webhook is Telegram-to-server only. |
| Scheduled jobs | `GET`, `POST /api/cron/books`; `GET`, `POST /api/cron/briefs`; custom-server `GET /health`; `GET /api/health` | Not called by the app except a health check. Keep scheduled work running on the backend even when the mobile app is closed. |

The Next.js 16.4 Route Handler guide in `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` was consulted for the existing App Router endpoint conventions. The mobile client does not require changes to those route handlers.

## 5. Proposed Flutter Architecture

Create a self-contained `mobile_app/` Flutter project; do not move or replace the Next.js project.

```text
mobile_app/
  lib/
    main.dart
    app/                 # Material 3 theme, GoRouter shell, app bootstrap
    core/
      config/            # API base URL, build flavors
      network/           # Dio client, auth interceptor, typed API errors
      storage/           # secure token and user preferences
      database/           # local offline records and migrations
      sync/               # sync state, delta merge, retry policy
      date/               # Ethiopian/Gregorian conversion and boundary rules
    features/
      auth/ planning/ tasks/ timer/ plans/ diary/ notes/ analytics/
      books/ quiz/ ai/ voice/ telegram/ settings/
    shared/
  test/
  pubspec.yaml
```

Use Riverpod for repositories and view state, GoRouter for nested navigation/deep links, Dio for API calls, Flutter Secure Storage for the bearer token, SQLite for offline planning records and nonsecret preferences, and File Picker/Image Picker for mobile files. Preserve the API's JSON shape at repository boundaries. Use generated JSON serialization only if it reduces repetitive model risk; a dependency is not required just to mirror a small model set.

The installed Flutter/Dart toolchain is confirmed. Current dependencies are Riverpod, GoRouter, Dio, SQLite/path, secure storage, intl, File Picker, and Image Picker. Native notifications, PDF rendering, audio, and speech packages are not included in this implementation.

### API configuration

- Read a compile-time `API_BASE_URL`/`--dart-define` value for release builds.
- Offer a Settings override for local development and self-hosted deployments; persist only the URL, never secrets.
- Require HTTPS in release mode. Development can explicitly allow a LAN HTTP URL for emulator/device testing.
- Preserve typed status handling: distinguish `401`/expired session, validation errors, server errors, timeouts and offline/no-route errors. Prevent duplicate submissions for mutating controls.

### Navigation proposal

Use five frequent destinations in the bottom bar: **Today**, **Plans**, **Add**, **Books**, and **More**. Place To-Do, Category, Diary, Notes, Analytics, Settings, and assistant entry points in Today/Plans/More flows. Keep quiz and assignment context deep-linkable. This avoids carrying the web's ten-item horizontal tab strip onto a phone while preserving access to every active feature.

## 6. Migration Phases and Deliverables

### Phase 1 — Project analysis (complete)

- Inspect frontend, API, backend, schema, integration configuration, and current worktree.
- Record the feature/data map, mobile architecture, known constraints, and route inventory.
- No source implementation changes and no schema changes.

**Deliverable:** `MOBILE_MIGRATION_PLAN.md`.

### Phase 2 — Flutter project setup (scaffold and core configured)

- Confirm `flutter doctor`, Android SDK, Java, and available emulator/device.
- Create `mobile_app/` without touching the web project; establish architecture, themes, routing, API base URL configuration, secure token storage, and local database.
- Implement connection diagnostics and the existing master-password sign-in/verify/logout contract.
- Keep iOS project scaffolding compatible; document any macOS-only build steps.

**Deliverable:** runnable Flutter shell and `MOBILE_SETUP.md`.

### Phase 3 — Mobile planning interface (implemented; analyzer pending)

- Implement local-first sections, tasks, daily schedule, task editing, timer/manual time, day review/notes, weekly/monthly plans, and analytics.
- Port and verify the exact date/schedule and conflict rules; add loading, empty, offline, and error states.
- Add a bottom navigation and route/deep-link handling designed for phones.

**Deliverable:** navigable mobile planning experience backed by local persistence.

### Phase 4 — Backend and sync integration (implemented; live-server verification pending)

- Implement bearer-token Dio calls and session expiry handling.
- Implement the existing `/api/sync` request/response contract, sequence metadata, acknowledgements, conflict resolution and retry/backoff.
- Verify existing shared-server records load and update; preserve locally queued records during errors.
- Add JSON export/import compatibility for records from the web app.

**Deliverable:** mobile data synchronizes with current web users without database DDL changes.

### Phase 5 — Remaining feature families (partial implementation)

- Add diary photo/file selection and upload, books/PDFs/page review/assignments/learning packages, and interactive quizzes.
- Add Sam's AI/FreeLLM text chat and history, Telegram status/manual text send/publishing pause, and settings. Voice capture/playback, image/video generation controls, complete book OCR review/editing, and native notifications remain follow-up work.
- Keep server-only providers, scheduled jobs, webhook processing and credentials on the backend.
- Document any mobile-specific differences before treating a feature as complete.

**Deliverable:** feature coverage with explicit implementation status for each inventory row.

### Phase 6 — Verification and quality assurance (pending package resolution)

- Run Flutter analysis and automated unit/widget tests for model serialization, sync merge, Ethiopian date/time, form validation, navigation, authentication and error handling.
- Exercise create/update/delete, offline queue/reconnect, duplicate prevention, app restart, deep links, permission states, different screen sizes and account compatibility.
- Compare mobile behavior against the actual web workflow and backend responses.

**Deliverable:** `TESTING_REPORT.md` with commands, device/tool versions, results and remaining limits.

### Phase 7 — Android build and release instructions (blocked by missing SDK)

- Set app display name and a confirmed package ID; configure launcher icon, splash screen, signing placeholders and release build settings.
- Generate debug APK, release APK and AAB when the local Android toolchain is installed and configured.
- Document HTTPS API setup, build commands and secure signing requirements. Document iOS build requirements separately.

**Deliverable:** buildable Android project plus `MOBILE_SETUP.md` and deployment instructions.

## 7. Risks, Dependencies, and Decisions

| Risk / dependency | Effect | Handling |
|---|---|---|
| Android SDK is not installed or discoverable | APK/AAB builds cannot run in this environment yet | Install Android Studio/SDK, accept licenses, then run the documented build commands. |
| No production API URL is committed | Sign-in and cloud operations need configuration | Use compile-time URL plus Settings override; require a working HTTPS endpoint for release. |
| Browser-only unsynced data is isolated in IndexedDB | It will not appear on a new mobile install automatically | Support current JSON export/import and explain that unsynced web data must be transferred by the user. |
| Current web app uses one shared password and owner identity | It is not a conventional multi-user profile system | Reuse the existing auth model; do not add registration or schema changes. |
| The PWA permits offline work but some web screens lock before first successful auth | README and shell behavior differ | Preserve access after a cached successful session; document initial sign-in/offline behavior precisely. |
| Books, AI, Telegram, OCR, and speech have server-side or platform dependencies | Not all functions can operate offline or identically on Android | Reuse current API contracts, add mobile equivalents and permission prompts, report unavailable services accurately. |
| Socket.IO delivers near-real-time updates in the web app | Poll/delta sync alone may feel slower on mobile | Start with reliable delta sync and add Socket.IO only if it can be maintained efficiently on supported app lifecycle states. |
| Native notification/timer execution differs from a browser tab | OS background limits can affect alerts | Use local notifications and persisted epoch state; test on physical Android devices before claiming background parity. |
| Project data includes optional server fallback modes and local book files | Deployment behavior varies by environment | Surface backend health/config diagnostics and do not embed server filesystem or provider assumptions in the client. |

No backend endpoint or database change is proposed at this stage. If later inspection shows a missing mobile contract, document the exact gap and propose the smallest compatible change before altering backend behavior.

## 8. Implementation Status

- [x] Repository and source inventory completed; frontend, database, authentication, sync, active routes, integrations and deployment notes inspected.
- [x] Core feature inventory and API route families documented.
- [x] Mobile architecture and phased migration approach documented.
- [x] Flutter project scaffolded with Android/iOS targets, Material 3 theme, GoRouter, Dio, secure session token storage and SQLite.
- [x] Login with saved API URL, task/category/day/plan CRUD, timer and manual time logging, notes/review, diary/photo upload, analytics, export/import, AI text chat/history, book upload/extraction/plan/quiz, and Telegram status/manual send/history/pause screens added.
- [x] Sync retries with capped backoff while signed in and refreshes after app resume.
- [ ] Resolve Flutter packages and rerun `flutter analyze` / `flutter test`; current attempts are blocked by missing package resolution.
- [ ] Exercise authenticated flows against the deployed API and Android device.
- [ ] Generate debug/release APK and AAB after installing Android SDK; configure production signing before distribution.

### Current implementation limits

- API-backed books, AI, photos, and Telegram need network connectivity; planning collections and timer state are SQLite-backed and sync through the existing sequence API.
- Rich HTML notes are edited as plain text. OCR pages can be extracted, but the mobile UI does not yet include the web app's full page preview/review/text-correction workflow.
- Book PDFs can be uploaded/downloaded; an in-app PDF reader and assignment-note editor are not included.
- The assistant supports text chat and history. Native wake-word/voice capture, speech playback/transcription controls, AI image/video generation controls, and push/local notifications are not included.
- Flutter package resolution hit a `pub.dev` socket error during this run. Android SDK is also absent; package analysis/tests and APK/AAB outputs must not be treated as successful until rerun on a configured machine.

The migration is not complete until package resolution, analysis/tests, live API/device checks, and Android build deliverables are complete.
