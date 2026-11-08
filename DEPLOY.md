# Sam'Space — Render Deployment & Cross-Device Guide

This guide walks you through deploying the **Sam'Space** backend and fullstack application to **Render**, connecting it with **Neon Serverless Postgres (SSL)**, and setting up instant real-time synchronization between your **PC** and **Phone**.

---

## 1. Why PC and Phone Couldn't Communicate (And How It's Solved)

Previously, the backend only ran on `localhost:3000` on your PC. Because `localhost` is isolated to your computer:
- Your phone could not reach `localhost:3000`.
- Tasks created on PC stayed on PC; tasks created on Phone stayed on Phone.

### The Solution:
1. **Public Cloud Backend on Render**: Accessible over HTTPS from any device (phone, laptop, desktop, tablet).
2. **0.0.0.0 & PORT Binding**: Configured for Render container networking via `process.env.PORT`.
3. **Neon PostgreSQL Cloud Database (SSL)**: Both PC and phone read and write to the same central database over TLS/SSL.
4. **Real-Time WebSockets (Socket.IO)**: Whenever you add, check, or edit a task on PC, a real-time event broadcasts to your phone (and vice-versa), updating both screens instantly.
5. **CORS & Dual-Token Auth (`CLIENT_URL`)**: Supports cross-origin calls (e.g. if the frontend is hosted on Vercel) and cookie + Bearer token auth for mobile browsers and PWAs.
6. **Health Check Probe (`GET /health`)**: Returns `200 OK` for Render automated health monitoring.

---

## 2. Render Web Service Configuration

When creating a new **Web Service** on [Render](https://render.com), use the following configuration:

| Setting | Value | Notes |
| :--- | :--- | :--- |
| **Name** | `sams-space-backend` (or your choice) | Used in your public `.onrender.com` URL |
| **Region** | Choose the region closest to you | e.g. `Frankfurt (EU)`, `Ohio (US East)` |
| **Branch** | `main` (or your active branch) | Automatic deploys on git push |
| **Root Directory** | `.` | Root of the repository |
| **Runtime** | `Node` | Node.js v20.x or v22.x+ |
| **Build Command** | `npm install && npm run build` | Compiles Next.js & Turbopack |
| **Start Command** | `npm start` | Runs `node server.js` (starts server on `0.0.0.0:$PORT` with Socket.IO) |
| **Health Check Path** | `/health` | Returns HTTP `200 OK` with JSON uptime & db status |
| **Instance Type** | Free or Starter | Free tier works great |

---

## 3. Required Environment Variables

Add the following environment variables in your Render Web Service dashboard under **Environment**:

| Variable Name | Required | Example Value | Description |
| :--- | :---: | :--- | :--- |
| `PORT` | Auto | `10000` | Injected automatically by Render. The server listens on `0.0.0.0:$PORT`. |
| `DATABASE_URL` | **Yes** | `postgres://user:pass@ep-xyz-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require` | Neon Postgres pooled connection string with SSL. |
| `APP_PASSWORD` | **Yes** | `MySecurePlanner2026!` | The master password to log into cloud sync and use AI planning. |
| `SESSION_SECRET` | **Yes** | `7f8a9b2c3d4e5f6a1b2c3d4e5f6a7b8c` | Random string (32+ chars) for HMAC signing session tokens. |
| `CLIENT_URL` | Optional | `https://your-planner.vercel.app,http://localhost:3000` | Allowed origin(s) for CORS and Socket.IO. Set if frontend is on Vercel. Defaults to `*` if empty. |
| `NEXT_PUBLIC_API_URL` | Optional | `https://sams-space-backend.onrender.com` | Public URL of this backend. Used if frontend is separated or pointing to Render. |
| `APP_URL` | Optional | `https://your-planner.onrender.com` | Public app URL used when generating Telegram links. |
| `FREE_LLM_API_URL` | Optional | `https://free-llm-api-7fue.onrender.com/v1` | OpenAI-compatible FreeLLM gateway base URL, including `/v1`; moon assistant only. |
| `FREE_LLM_API_KEY` | Required for gateway chat | (secret) | FreeLLM gateway unified API key. Set on Sam'Space backend only; never in browser storage. `RELAY_TOKEN` is not this key. |
| `FREE_LLM_MODEL` | Optional | `auto` | Default gateway model. |
| `GEMINI_API_KEY_1` | Optional | `AIzaSy...` | Primary Google Gemini API key for AI assistant & day planner. |
| `GEMINI_API_KEY_2` | Optional | `AIzaSy...` | Secondary Gemini API key (automatic fallback). |
| `GEMINI_API_KEY_3` | Optional | `AIzaSy...` | Tertiary Gemini API key. |
| `GEMINI_MODEL` | Optional | `gemini-3.5-flash` | Gemini model name (`gemini-3.5-flash`, `gemini-3.8-flash`). |
| `GROQ_API_KEY_1` | Optional | `gsk_...` | Primary Groq API key for zero-latency AI fallback. |
| `GROQ_MODEL` | Optional | `openai/gpt-oss-20b` | Groq model name (`openai/gpt-oss-20b`, `openai/gpt-oss-120b`). |
| `OPENAI_API_KEY` | Optional | (secret) | Enables neural Moon voice output (`gpt-4o-mini-tts`, with `tts-1-hd` fallback). Keep server-side only. If unset or unavailable, playback falls back to the browser's installed speech voice. Speech API usage may incur charges. |
| `ELEVENLABS_API_KEY` | Optional | (secret) | Enables ElevenLabs speech synthesis. Keep server-side only. |
| `ELEVENLABS_VOICE_ID` | Optional | (voice ID) | Default ElevenLabs voice. |
| `PIPER_TTS_URL` | Optional | `http://your-piper-service:5000` | URL of a self-hosted Piper TTS service. |
| `CLOUDINARY_CLOUD_NAME` | Optional | (cloud name) | Enables Cloudinary file uploads when configured with the API key and secret below. |
| `CLOUDINARY_API_KEY` | Optional | (secret) | Cloudinary API key. Keep server-side only. |
| `CLOUDINARY_API_SECRET` | Optional | (secret) | Cloudinary API secret. Keep server-side only. |
| `BOOK_DATA_DIR` | Recommended for book uploads | `/var/data` | Directory for private uploaded PDFs and cached OCR language data. Mount a persistent disk at the same path in Render. |
| `TELEGRAM_BOT_TOKEN` | For Telegram publishing | *(BotFather token)* | Secret backend environment variable. Do not use a `NEXT_PUBLIC_` name or paste the token into chat. |
| `TELEGRAM_CHAT_ID` | For Telegram publishing | `@your_channel` or numeric ID | Backend environment variable for the destination channel. The bot must be an administrator with permission to post. |
| `TELEGRAM_WEBHOOK_SECRET` | Optional | *(random secret)* | Validates Telegram webhook requests when configured. Keep server-side only. |
| `BOOKS_CRON_SECRET` | For scheduled publishing | *(random secret, 32+ characters)* | Same secret on the web service and Render Cron service. It protects the scheduler endpoint. |
| `BRIEFS_CRON_SECRET` | For scheduled briefs | *(random secret, 32+ characters)* | Protects the scheduled briefs endpoint. |
| `PDF_OCR_LANGS` | Optional | `eng` | Tesseract OCR language code(s), joined with `+`, such as `eng+fra`. The first OCR run downloads language data unless `TESSERACT_LANG_PATH` is configured in the application environment. |
| `YOUTUBE_API_KEY` | Optional | `AIzaSy...` | Google YouTube Data API v3 key for discovering relevant video lessons and lectures. If unset, the related videos section is omitted without error. |
| `PODCAST_INDEX_API_KEY` | Optional | *(key string)* | Podcast Index API key for discovering relevant podcast episodes. Used with signed SHA-1 auth. |
| `PODCAST_INDEX_API_SECRET` | Optional | *(secret string)* | Podcast Index API secret for signed header authentication. |
| `ZENQUOTES_API_KEY` | Optional | *(key string)* | ZenQuotes API key. If unset, uses the public free tier with strict rate-limiting and link-back attribution. |
| `WIKIPEDIA_USER_AGENT` | Optional | `NightPlanner-MoonAI/1.0 (...)` | Custom User-Agent header for Wikipedia & Wikiquote requests per Wikimedia policy. |

For book PDFs on Render, attach a persistent disk to the **web service** at `/var/data` and set `BOOK_DATA_DIR=/var/data`. The PDF binary and OCR cache live on that disk; extracted page text and book metadata use Neon when `DATABASE_URL` is configured. Without the disk, PDF files stored on the service filesystem may be lost when the service is replaced.

To connect Telegram, open Render **Dashboard → your NightPlanner web service → Environment**, add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, and redeploy. The connection check is available in the authenticated endpoint `GET /api/telegram/status`; delivery history is `GET /api/telegram/deliveries`. A manual publish request is `POST /api/books/{bookId}/assignments/{assignmentId}/publish` and requires an approved assignment. The application checks the bot's channel membership and posting permission before sending. Never include the bot token in frontend settings or client requests.

### Scheduled Telegram Publishing & Automatic Background Scheduler (`node-cron`)

NightPlanner now includes a built-in, reliable **background scheduling mechanism powered by `node-cron`** directly inside the Node.js backend:

- **Automatic Startup:** Initialized automatically when the backend boots (`src/instrumentation.ts` and `server.js`).
- **Cadence:** Ticks every minute using the cron expression `* * * * *`.
- **Zero-User-Dependency:** Runs in the background independently of whether any user has the website open.
- **Atomic Concurrency Protection:** Uses database-level atomic claiming (`RETURNING id`) and an in-memory lock to prevent duplicate deliveries across instances.
- **Overdue & Downtime Recovery:** Performs an immediate sweep upon boot and recovers any jobs that became due while the backend was restarting or asleep.
- **Diagnostics in `/health`:** The `GET /health` endpoint reports the scheduler's running state, cron expression, last execution timestamp, and error streak.

#### Render Deployment Considerations & Web Service Sleep:
- **`node-cron` Lifecycle:** `node-cron` runs inside the Node.js process and ticks as long as the process is alive.
- **Render Starter / Paid Tier ($7/mo):** The web service runs 24/7 without sleeping. `node-cron` executes continuously every minute with zero external setup needed.
- **Render Free Tier Sleep Limitation:** Free-tier web services on Render spin down into sleep after 15 minutes without incoming HTTP traffic. While asleep, the Node.js process is paused.
  - When the service wakes up (e.g. via any HTTP request, user visit, or health probe), the scheduler runs an **immediate recovery sweep** to deliver any overdue messages.
  - To ensure messages are sent at their exact minute on Render Free Tier, set up a free uptime monitor (e.g., [UptimeRobot](https://uptimerobot.com) or [cron-job.org](https://cron-job.org)) to ping `https://your-service.onrender.com/health` every 5–10 minutes to prevent sleep.
  - Alternatively, you can use Render's optional Cron Job service to call the protected endpoint:
    ```bash
    curl --max-time 600 -fsS -X POST "$NIGHTPLANNER_URL/api/cron/books" -H "Authorization: Bearer $BOOKS_CRON_SECRET"
    ```

---

## 4. Deployment Architectures

You have two simple ways to deploy:

### Option A: All-in-One on Render (Recommended & Easiest)
Deploy both the frontend UI and backend API together on Render as a single Web Service.
1. Render hosts the UI at `https://sams-space.onrender.com`.
2. Both PC and Phone visit `https://sams-space.onrender.com`.
3. Zero CORS configuration needed because frontend and backend share the exact same domain.

### Option B: Frontend on Vercel + Backend on Render
If you prefer hosting the Next.js frontend on Vercel and the backend on Render:
1. **On Render (Backend)**:
   - Set `CLIENT_URL` = `https://your-planner.vercel.app`
2. **On Vercel (Frontend)**:
   - Set `NEXT_PUBLIC_API_URL` = `https://sams-space-backend.onrender.com`
   - Set `APP_PASSWORD` and `SESSION_SECRET` (matching Render).

---

## 5. Step-by-Step Deployment Instructions

### Step 1: Set Up Neon Postgres Cloud Database
1. Go to [Neon](https://console.neon.tech/) and create a free project named `sams-space`.
2. In the dashboard, click on **SQL Editor**.
3. Open [`schema.sql`](./schema.sql) in this repository, copy its entire contents, and paste into Neon's SQL Editor.
4. Click **Run** to generate the tables (`sections`, `tasks`, `time_logs`, `days`, `weekly_plans`, `monthly_plans`) and sequence `server_seq`.
5. On the Neon dashboard, copy your **Connection String** (Pooled connection recommended). Ensure it ends with `?sslmode=require`.

### Step 2: Push Your Code to GitHub
```bash
git add .
git commit -m "feat: render production backend with 0.0.0.0, CORS, Socket.IO, and health check"
git push origin main
```

### Step 3: Deploy to Render
1. Log into [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** -> **Web Service**.
3. Select your GitHub repository.
4. Fill in the service configuration:
   - **Name**: `sams-space-backend`
   - **Root Directory**: `.`
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
5. Click **Advanced** and set:
   - **Health Check Path**: `/health`
6. Under **Environment Variables**, add:
   - `DATABASE_URL`: *(Your Neon connection string with `?sslmode=require`)*
   - `APP_PASSWORD`: *(Your personal master password)*
   - `SESSION_SECRET`: *(A random 32+ character string)*
   - `GEMINI_API_KEY_1`: *(Your Google AI Studio API key)*
   - `GROQ_API_KEY_1`: *(Your Groq API key, e.g. `gsk_...`)*
   - *(If using Vercel for frontend)*: `CLIENT_URL` = `https://your-planner.vercel.app`
7. Click **Create Web Service**.
8. Wait 2–3 minutes for the build and deployment to finish. Render will display:
   `> Sam'Space server ready on http://0.0.0.0:10000`
   `> Database configured (SSL enabled)`

---

## 6. How to Test From Both Phone and PC

### Test 1: Verify the Backend Health Check
Open your browser or run in terminal:
```bash
curl https://sams-space-backend.onrender.com/health
```
**Expected Response (HTTP 200)**:
```json
{
  "status": "ok",
  "service": "sams-space-backend",
  "uptime": 12.4,
  "timestamp": "2026-10-10T08:50:00.000Z",
  "database": "connected (SSL Postgres)",
  "port": 10000
}
```

---

### Test 2: Test from your PC
1. In your PC browser (Chrome/Edge/Firefox), open your deployed URL:
   `https://sams-space-backend.onrender.com` (or your Vercel URL).
2. Look at the top-right header:
   - If a **Cloud Sync (Lock)** icon appears, click it.
   - Enter your `APP_PASSWORD` and click **Sign In**.
3. The sync status badge in the header will transition:
   `Unsaved changes` → `Saving...` → `Saved` (with green check).
4. Create a new task (e.g. *"Test task from PC"* with 45 minutes).
5. Verify the task appears under your active category and the badge shows **Saved**.

---

### Test 3: Test from your Phone (Mobile Chrome / Safari)
1. Turn on Wi-Fi or mobile cellular data on your phone.
2. Open Safari (iOS) or Chrome (Android) and navigate to the same URL:
   `https://sams-space-backend.onrender.com`
3. Click the lock icon and enter the same `APP_PASSWORD`.
4. **Result**: Your *"Test task from PC"* instantly loads onto your phone screen!
5. **(Optional) Install as PWA**:
   - **iOS Safari**: Tap the Share button (square with arrow) → tap **Add to Home Screen**.
   - **Android Chrome**: Tap the three dots menu → tap **Install app** or **Add to Home screen**.
   - You now have a standalone, full-screen native app icon on your phone!

---

### Test 4: Real-Time Cross-Device Synchronization Test
1. Place your PC monitor and Phone screen side-by-side with Sam'Space open on both.
2. **On your PC**:
   - Click the checkbox to complete *"Test task from PC"*.
   - Within 1–2 seconds, the task automatically marks completed on your phone via Socket.IO without touching the phone!
3. **On your Phone**:
   - Create a task named *"Phone morning reflection"*.
   - Watch it appear on your PC screen automatically!

---

### Test 5: Offline-First Reliability Test
1. Put your phone in **Airplane Mode** (disconnect Wi-Fi and mobile data).
2. Open Sam'Space on your phone. Notice that the entire UI, tasks, and notes continue to open and work 100% offline via local IndexedDB.
3. Check off a task or add a note on the phone. The status indicator shows `Unsaved changes (offline)`.
4. Turn Airplane Mode **OFF**.
5. As soon as the phone reconnects to the internet, it automatically syncs all changes up to the Neon cloud database and notifies your PC!

---

## 7. Troubleshooting & FAQ

### Q1: The Render service takes 30–50 seconds to respond on the first click.
- **Cause**: Render's Free tier puts inactive web services to sleep after 15 minutes of inactivity.
- **Solution**: The first request wakes the service up. Once awake, response times are immediate. If you need zero cold-starts, you can upgrade Render to the Starter tier ($7/mo) or use a free uptime monitor (like UptimeRobot) to ping `/health` every 10 minutes.

### Q2: "Failed to fetch" or CORS error in browser console.
- **Cause**: The frontend origin is not allowed in `CLIENT_URL`.
- **Solution**: Check your Render environment variables. Ensure `CLIENT_URL` contains the exact URL of your frontend without trailing slashes (e.g., `https://my-app.vercel.app`). You can also set `CLIENT_URL="*"` to allow all origins.

### Q3: How do I change the backend URL directly from my phone?
- If you deployed the backend and want to point your existing frontend to it, open your phone browser console or Settings: the app reads `process.env.NEXT_PUBLIC_API_URL` by default, or you can set `localStorage.setItem('np_custom_api_url', 'https://your-backend.onrender.com')` to point to any custom backend URL.
