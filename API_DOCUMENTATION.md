# Sam'Space API Notes for the Flutter App

The mobile client talks to the existing Next.js backend. Set the API base URL to the deployed app origin (for example, `https://planner.example.com`); paths below already include `/api`. No backend routes or database tables were changed for this migration.

## Authentication

| Method and path | Request | Mobile behavior |
|---|---|---|
| `POST /api/login` | `{ "password": "…" }` | Uses the existing shared `APP_PASSWORD`; stores the returned signed `token` in Flutter Secure Storage. |
| `GET /api/auth/verify` | Bearer token | Checks a cached session. A `401` clears the token and returns the app to sign-in. |
| `POST /api/logout` | Bearer token | Clears the server cookie when available; the app always clears its secure local token. |

The web app has no registration, password recovery, individual profile, or role APIs. Flutter sends `Authorization: Bearer <token>`; it does not depend on browser cookies.

## Offline planning and synchronization

`POST /api/sync` carries the existing delta-sync contract. The JSON body contains `lastServerSeq` and arrays named `sections`, `tasks`, `timeLogs`, `days`, `weeklyPlans`, and `monthlyPlans`. The mobile app sends only local dirty rows in those arrays. The response supplies `currentServerSeq`, per-collection `acknowledgedIds`, and `serverChanges`; acknowledged local rows are marked synced and remote rows are merged by `updatedAt` using the web app's dirty/newer conflict rule. Deletions use the existing `deleted` field.

SQLite stores these records and the last sequence locally. Timer epoch/state and nonsecret app preferences also live on-device. The session token is never included in the JSON backup. A successful first sign-in is needed before offline access can use a cached session.

The web browser's IndexedDB is a separate store. Export its JSON backup in web Settings and import that file in mobile Settings to transfer unsynced browser-only records.

## Core and file routes

| Route | Mobile use |
|---|---|
| `GET`, `POST /api/tasks` | Existing task service; the mobile offline-first task edits use `/api/sync` for cloud persistence. |
| `POST /api/files`; `DELETE /api/files/{id}` | Authenticated diary photo upload and removal. Photos require a connection and the server's configured storage provider. |
| `GET /api/books`; `POST /api/books` | List books; upload a PDF as multipart field `pdf` with title, author, page range, schedule, and study-duration fields. The existing backend enforces its 100 MB limit and validates the PDF. |
| `GET /api/books/{id}/pdf` | Download the private PDF to a user-selected device location. |
| `GET`, `POST /api/books/{id}/extract` | Inspect extraction or extract a batch of pages. The mobile app repeats bounded batches and displays the returned progress/status. |
| `GET`, `POST /api/books/{id}/assignments` | Load assignments or generate a plan after extraction/review is complete. |
| `POST /api/books/{id}/assignments/{assignmentId}/notes` | Generate assignment study notes with the server's `auto` model selection. |
| `PATCH /api/books/{id}/assignments/{assignmentId}/notes` | Approve generated study notes and create the server publishing job. |
| `GET /api/books/{id}/assignments/{assignmentId}/learning-package` | Load/generate the backend study pack used by the quiz workflow. |
| `POST /api/books/{id}/assignments/{assignmentId}/publish` | After an explicit in-app confirmation, publish to the configured Telegram channel. |
| `DELETE /api/books/{id}` | Delete a book and its server-side assignments, jobs, and delivery records after confirmation. |
| `GET`, `POST /api/quiz` | Fetch questions for an assignment/session and submit `{ "assignmentId": "…", "answers": { "questionId": 0 } }`. |

## AI routes

- `POST /api/ai/chat` accepts `{ "messages": [{"role":"user|assistant","content":"…"}], "context": {…}, "stream": false }`. The mobile Sam's AI screen supplies local task and section context, receives the `message.content` and actions, and saves history through `/api/ai/history`.
- `GET /api/ai/history?assistant=sams_ai` returns conversations and messages. `POST /api/ai/history` supports `save_conversation` and `save_message` actions.
- `POST /api/ai/freellm/chat` accepts the message array and optional model/mode settings; the mobile Moon AI screen currently supports text chat and saves conversations through history with `assistant: "freellm"`.
- `POST /api/ai/weekly-report` generates a report from the saved weekly plan and its task/time-log context.
- Provider credentials, image/video/speech generation, transcription, voice configuration, and provider selection remain server-side. Mobile does not transmit those secrets.

## Telegram routes

- `GET /api/telegram/status` reports server-side configuration and channel connectivity.
- `POST /api/telegram/status` accepts optional `{ "botToken": "…", "chatId": "…" }` to update backend configuration. The mobile form clears the token after sending and never saves it in local preferences; use HTTPS.
- `POST /api/telegram/send` sends `{ "text": "…" }` to the configured channel after a send confirmation.
- `GET /api/telegram/deliveries` lists server delivery history.
- `GET`, `POST /api/telegram/automation` reads or changes `{ "paused": true|false }` for scheduled book publishing.

Cron, webhook, Socket.IO, and background scheduler routes remain server operations. The mobile app does not need to stay open for scheduled jobs.

## Error handling and data protection

The Dio client attaches the bearer token, uses finite connection/read timeouts, clears expired sessions on `401`, and maps backend `error` messages into user feedback. A release build rejects non-HTTPS API URLs; debug Android builds allow HTTP for LAN testing. Never put `APP_PASSWORD`, session signing secrets, database credentials, Cloudinary secrets, AI provider keys, or Telegram tokens into Dart build defines or source control.

Some routes listed above are documented for the existing backend but do not yet have a mobile UI. See `MOBILE_MIGRATION_PLAN.md` for implemented features and remaining gaps.
