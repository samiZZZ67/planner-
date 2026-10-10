# Night Planner — Render Deployment & Cross-Device Guide

This guide walks you through deploying the **Night Planner** backend and fullstack application to **Render**, connecting it with **Neon Serverless Postgres (SSL)**, and setting up instant real-time synchronization between your **PC** and **Phone**.

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
| **Name** | `night-planner-backend` (or your choice) | Used in your public `.onrender.com` URL |
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
| `NEXT_PUBLIC_API_URL` | Optional | `https://night-planner-backend.onrender.com` | Public URL of this backend. Used if frontend is separated or pointing to Render. |
| `GEMINI_API_KEY_1` | Optional | `AIzaSy...` | Primary Google Gemini API key for AI assistant & day planner. |
| `GEMINI_API_KEY_2` | Optional | `AIzaSy...` | Secondary Gemini API key (automatic fallback). |
| `GEMINI_API_KEY_3` | Optional | `AIzaSy...` | Tertiary Gemini API key. |
| `GEMINI_MODEL` | Optional | `gemini-3.5-flash` | Gemini model name (`gemini-3.5-flash`, `gemini-3.8-flash`). |
| `GROQ_API_KEY_1` | Optional | `gsk_...` | Primary Groq API key for zero-latency AI fallback. |
| `GROQ_MODEL` | Optional | `openai/gpt-oss-20b` | Groq model name (`openai/gpt-oss-20b`, `openai/gpt-oss-120b`). |

---

## 4. Deployment Architectures

You have two simple ways to deploy:

### Option A: All-in-One on Render (Recommended & Easiest)
Deploy both the frontend UI and backend API together on Render as a single Web Service.
1. Render hosts the UI at `https://night-planner.onrender.com`.
2. Both PC and Phone visit `https://night-planner.onrender.com`.
3. Zero CORS configuration needed because frontend and backend share the exact same domain.

### Option B: Frontend on Vercel + Backend on Render
If you prefer hosting the Next.js frontend on Vercel and the backend on Render:
1. **On Render (Backend)**:
   - Set `CLIENT_URL` = `https://your-planner.vercel.app`
2. **On Vercel (Frontend)**:
   - Set `NEXT_PUBLIC_API_URL` = `https://night-planner-backend.onrender.com`
   - Set `APP_PASSWORD` and `SESSION_SECRET` (matching Render).

---

## 5. Step-by-Step Deployment Instructions

### Step 1: Set Up Neon Postgres Cloud Database
1. Go to [Neon](https://console.neon.tech/) and create a free project named `night-planner`.
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
   - **Name**: `night-planner-backend`
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
   `> Night Planner server ready on http://0.0.0.0:10000`
   `> Database configured (SSL enabled)`

---

## 6. How to Test From Both Phone and PC

### Test 1: Verify the Backend Health Check
Open your browser or run in terminal:
```bash
curl https://night-planner-backend.onrender.com/health
```
**Expected Response (HTTP 200)**:
```json
{
  "status": "ok",
  "service": "night-planner-backend",
  "uptime": 12.4,
  "timestamp": "2026-10-10T08:50:00.000Z",
  "database": "connected (SSL Postgres)",
  "port": 10000
}
```

---

### Test 2: Test from your PC
1. In your PC browser (Chrome/Edge/Firefox), open your deployed URL:
   `https://night-planner-backend.onrender.com` (or your Vercel URL).
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
   `https://night-planner-backend.onrender.com`
3. Click the lock icon and enter the same `APP_PASSWORD`.
4. **Result**: Your *"Test task from PC"* instantly loads onto your phone screen!
5. **(Optional) Install as PWA**:
   - **iOS Safari**: Tap the Share button (square with arrow) → tap **Add to Home Screen**.
   - **Android Chrome**: Tap the three dots menu → tap **Install app** or **Add to Home screen**.
   - You now have a standalone, full-screen native app icon on your phone!

---

### Test 4: Real-Time Cross-Device Synchronization Test
1. Place your PC monitor and Phone screen side-by-side with Night Planner open on both.
2. **On your PC**:
   - Click the checkbox to complete *"Test task from PC"*.
   - Within 1–2 seconds, the task automatically marks completed on your phone via Socket.IO without touching the phone!
3. **On your Phone**:
   - Create a task named *"Phone morning reflection"*.
   - Watch it appear on your PC screen automatically!

---

### Test 5: Offline-First Reliability Test
1. Put your phone in **Airplane Mode** (disconnect Wi-Fi and mobile data).
2. Open Night Planner on your phone. Notice that the entire UI, tasks, and notes continue to open and work 100% offline via local IndexedDB.
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
