# Night Planner — Deployment & Operations Guide

This guide walks you through deploying **Night Planner** to production on **Vercel** with a **Neon Serverless Postgres** cloud database, enabling full cross-device synchronization and 100% offline functionality as an installable Progressive Web App (PWA).

---

## 1. Architecture Summary

- **Frontend**: Next.js 16 (App Router) client-side Single Page Application (SPA) with React 19, TypeScript, and Tailwind CSS.
- **Glassmorphic UI**: Deep obsidian glass cards, silver chrome borders, specular reflection highlights, pill controls, and responsive layouts for both Phone and PC.
- **Client Storage**: IndexedDB via Dexie (`night_planner_db`). Offline-first: all reads and writes happen locally first.
- **Service Worker**: Self-hosted service worker (`public/sw.js`) precaching fonts, icons, manifest, and runtime offline navigation fallback.
- **Cloud Database**: Neon Serverless Postgres (`@neondatabase/serverless`) accessed strictly through secure Next.js API route handlers (`/api/sync`, `/api/login`, `/api/logout`).
- **Sync Protocol**: Incremental sequence-based delta sync (`serverSeq`), conflict resolution via "newest `updatedAt` wins", and soft deletes (`deleted: true`).
- **Authentication**: Single-user password gate (`APP_PASSWORD`), HMAC-SHA256 signed `httpOnly` cookie (`SESSION_SECRET`), 90-day persistence, and in-memory rate limiting (5 attempts per 15 minutes).

---

## 2. Prerequisites

1. **Node.js** v20.x or v22.x+ installed.
2. A free **[Neon Postgres](https://neon.tech)** account.
3. A free **[Vercel](https://vercel.com)** account or any Node.js hosting platform (Docker, Railway, Render, etc.).
4. A Git repository (GitHub, GitLab, or Bitbucket) with your project files.

---

## 3. Step 1: Set Up Neon Postgres

1. Log into your [Neon Console](https://console.neon.tech/).
2. Click **Create Project**:
   - **Project Name**: `night-planner`
   - **Postgres Version**: `16` or `17`
   - **Region**: Choose the region closest to you (e.g., `us-east-1`, `eu-central-1`).
3. In your project dashboard, navigate to the **SQL Editor** tab on the left.
4. Copy the entire contents of [`schema.sql`](./schema.sql) and paste it into the SQL Editor:
   ```sql
   -- 1. Shared Sequence for Delta Sync
   CREATE SEQUENCE IF NOT EXISTS server_seq START WITH 1 INCREMENT BY 1;

   -- 2. Sections Table
   CREATE TABLE IF NOT EXISTS sections (
       id VARCHAR(64) PRIMARY KEY,
       name TEXT NOT NULL,
       color TEXT NOT NULL,
       icon TEXT NOT NULL,
       "order" INTEGER NOT NULL DEFAULT 0,
       daily_target_minutes INTEGER,
       target_type VARCHAR(20) DEFAULT 'at least',
       updated_at BIGINT NOT NULL,
       deleted BOOLEAN NOT NULL DEFAULT FALSE,
       is_sample BOOLEAN NOT NULL DEFAULT FALSE,
       server_seq BIGINT NOT NULL DEFAULT nextval('server_seq')
   );
   CREATE INDEX IF NOT EXISTS idx_sections_server_seq ON sections (server_seq);

   -- 3. Tasks Table
   CREATE TABLE IF NOT EXISTS tasks (
       id VARCHAR(64) PRIMARY KEY,
       date VARCHAR(10) NOT NULL,
       section_id VARCHAR(64) NOT NULL,
       title TEXT NOT NULL,
       description TEXT DEFAULT '',
       strategy TEXT DEFAULT '',
       done_means TEXT DEFAULT '',
       estimated_minutes INTEGER NOT NULL DEFAULT 0,
       priority VARCHAR(20) NOT NULL DEFAULT 'Medium',
       must_do BOOLEAN NOT NULL DEFAULT FALSE,
       tags JSONB NOT NULL DEFAULT '[]'::jsonb,
       icon TEXT DEFAULT '',
       text_color TEXT DEFAULT '',
       image TEXT,
       is_completed BOOLEAN NOT NULL DEFAULT FALSE,
       completed_at BIGINT,
       "order" INTEGER NOT NULL DEFAULT 0,
       created_at BIGINT NOT NULL,
       updated_at BIGINT NOT NULL,
       deleted BOOLEAN NOT NULL DEFAULT FALSE,
       is_sample BOOLEAN NOT NULL DEFAULT FALSE,
       server_seq BIGINT NOT NULL DEFAULT nextval('server_seq')
   );
   CREATE INDEX IF NOT EXISTS idx_tasks_server_seq ON tasks (server_seq);

   -- 4. Time Logs Table
   CREATE TABLE IF NOT EXISTS time_logs (
       id VARCHAR(64) PRIMARY KEY,
       task_id VARCHAR(64) NOT NULL,
       date VARCHAR(10) NOT NULL,
       minutes INTEGER NOT NULL DEFAULT 0,
       source VARCHAR(20) NOT NULL DEFAULT 'timer',
       created_at BIGINT NOT NULL,
       updated_at BIGINT NOT NULL,
       deleted BOOLEAN NOT NULL DEFAULT FALSE,
       is_sample BOOLEAN NOT NULL DEFAULT FALSE,
       server_seq BIGINT NOT NULL DEFAULT nextval('server_seq')
   );
   CREATE INDEX IF NOT EXISTS idx_time_logs_server_seq ON time_logs (server_seq);

   -- 5. Days Table
   CREATE TABLE IF NOT EXISTS days (
       id VARCHAR(10) PRIMARY KEY,
       date VARCHAR(10) NOT NULL,
       free_hours NUMERIC(4,2) DEFAULT 8.0,
       review JSONB DEFAULT '{"worked":"","blocked":"","change":""}'::jsonb,
       updated_at BIGINT NOT NULL,
       deleted BOOLEAN NOT NULL DEFAULT FALSE,
       is_sample BOOLEAN NOT NULL DEFAULT FALSE,
       server_seq BIGINT NOT NULL DEFAULT nextval('server_seq')
   );
   CREATE INDEX IF NOT EXISTS idx_days_server_seq ON days (server_seq);

   -- 6. Auth Rate Limit Table
   CREATE TABLE IF NOT EXISTS auth_rate_limit (
       ip_address VARCHAR(128) PRIMARY KEY,
       failed_attempts INTEGER NOT NULL DEFAULT 0,
       last_attempt_at BIGINT NOT NULL,
       blocked_until BIGINT NOT NULL DEFAULT 0
   );
   ```
5. Click **Run**. All tables and indexes will be created.
6. In the Neon Dashboard, go to **Dashboard** or **Connection Details**:
   - Select **Connection string** (choose `Pooled connection` or standard).
   - Copy the URI. It will look like:
     ```
     postgresql://neondb_owner:YOUR_PASSWORD@ep-xyz-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
     ```

---

## 4. Step 2: Environment Variables

Create your environment configuration with these three required variables:

| Variable | Description | Example / Recommendation |
|---|---|---|
| `DATABASE_URL` | Neon Postgres Connection String | `postgresql://user:pass@ep-xyz.neon.tech/neondb?sslmode=require` |
| `APP_PASSWORD` | Single-user master password for cloud sync | Any strong passphrase (e.g. `NightPlanner2026!SecureKey`) |
| `SESSION_SECRET` | 32+ character key for signing httpOnly cookies | Generate via `openssl rand -hex 32` |

### Generating a Secure Session Secret

On your terminal:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 5. Step 3: Deploying to Vercel

### Option A: Via Vercel Web Dashboard (Recommended)

1. Push your repository to GitHub / GitLab / Bitbucket:
   ```bash
   git add .
   git commit -m "Deploy Night Planner with Glassmorphism UI"
   git push origin main
   ```
2. Go to [Vercel](https://vercel.com) and click **Add New...** -> **Project**.
3. Select your repository and click **Import**.
4. In the **Configure Project** screen:
   - **Framework Preset**: Next.js
   - **Root Directory**: `./`
   - **Build Command**: `next build` (default)
   - **Output Directory**: `.next` (default)
   - **Install Command**: `npm install` (default)
5. Expand the **Environment Variables** section and add:
   - `DATABASE_URL`: Your Neon Postgres connection URI
   - `APP_PASSWORD`: Your secret sync password
   - `SESSION_SECRET`: Your generated 64-character secret
6. Click **Deploy**.
7. In ~60 seconds, your site is live with a secure HTTPS URL (e.g. `https://night-planner.vercel.app`).

### Option B: Via Vercel CLI

```bash
npm install -g vercel
vercel login
vercel link
vercel env add DATABASE_URL
vercel env add APP_PASSWORD
vercel env add SESSION_SECRET
vercel --prod
```

---

## 6. Step 4: Installing as a PWA

Night Planner includes a complete Progressive Web App manifest (`public/manifest.json`), icons, and service worker.

### On PC (Chrome / Edge / Brave):
1. Navigate to your deployed URL in Chrome or Edge.
2. In the browser URL bar, look for the **Install App** icon (computer screen with a down arrow).
3. Click **Install**.
4. Night Planner now runs in a standalone, borderless desktop window with keyboard shortcuts (`N`, `1-4`, `Space`) active.

### On Mobile (Android / Chrome):
1. Navigate to your deployed URL in Chrome.
2. A prompt `"Add Night Planner to Home screen"` will appear at the bottom, or tap the three dots `⋮` -> **Install app** / **Add to Home screen**.
3. Launch from your home screen. It will open full screen without address bar navigation.

### On Mobile (iOS / Safari):
1. Navigate to your deployed URL in Safari.
2. Tap the **Share** button (box with an arrow pointing up) at the bottom.
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**. Launch from your home screen.

---

## 7. Step 5: First-Time Login & Offline Verification

1. **First-Time Sync Login**:
   - Click/tap the **Login to Sync** badge in the header or in Settings -> Account.
   - Enter your `APP_PASSWORD`.
   - Your device receives a 90-day signed `httpOnly` cookie.
   - Any local data created offline will immediately sync to Neon Postgres.

2. **Offline Verification**:
   - Turn off Wi-Fi or enable Airplane Mode (or toggle "Offline" in Chrome DevTools Network tab).
   - Refresh the page or close and re-open the installed app.
   - The app loads instantly from cache.
   - The header displays an amber `Offline` badge.
   - Create, edit, reorder, or complete tasks; run the timer; record reviews.
   - Turn Wi-Fi back on.
   - Within seconds, the badge changes to `Syncing...` and then green `Saved`. All changes are synced to your Neon Postgres database.

3. **Deploying Future Updates**:
   - When you push new code to production, the service worker detects the updated build.
   - A purple glass banner will slide in at the top:
     *"New version of Night Planner is ready — reload to update."*
   - Clicking **Reload** triggers `skipWaiting()` and refreshes into the latest version without losing any unsaved work or IndexedDB data.

---

## 8. Custom Font Installation ("Bloody Hell")

To enable the custom gothic title font:
1. Place your font kit files in `public/fonts/`:
   - `BloodyHell.woff2` (primary format)
   - `BloodyHell.woff`
   - `BloodyHell.ttf`
2. The `@font-face` declaration in `src/app/globals.css` is preconfigured to load these files with `font-display: swap` and system fallbacks.
3. Commit and redeploy:
   ```bash
   git add public/fonts/
   git commit -m "Add Bloody Hell font files"
   git push
   ```

---

## 9. Local Development & Testing

```bash
# Install dependencies
npm install

# Run unit test suite (7 tests verifying sync, soft deletes, conflicts, backoff)
npm test

# Run Next.js Turbopack development server
npm run dev

# Run production build check
npm run build
```

---

## 10. Security & Data Protection Checklist

- [x] **No CDN / External font leakage**: Zero fonts or scripts loaded from external CDNs.
- [x] **Persistent Storage requested**: App automatically requests `navigator.storage.persist()`.
- [x] **Conflict Resolution**: Newest `updatedAt` always wins, preventing overwrites across devices.
- [x] **Rate Limiting**: Wrong passwords throttled to 5 tries per 15 minutes per IP.
- [x] **Soft Deletes**: Deleted records mark `deleted: true` rather than hard deletion, ensuring remote devices synchronize deletions cleanly.
- [x] **Sleep & Screen-Off Safe Timer**: Timer uses timestamp epochs (`startedAt` + `accumulatedMs`) so OS sleep or lock screen does not cause timer drift.
