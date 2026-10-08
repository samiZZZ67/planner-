# 🌙 Night Planner

A personal, offline-first evening planning progressive web app (PWA) built with **Next.js (App Router)**, **React 19**, **TypeScript**, **Tailwind CSS**, **Dexie (IndexedDB)**, and **Neon Postgres**.

Designed for intentional evening planning: forces you to articulate **what** you will do, **how** you will do it (Strategy), **how long** it will take, and **how you will know it is finished** (Done means). Tracks your real time with clock-accurate timers and presents your execution analytics inspired by **YouTube Studio**.

---

## 🚀 Key Features

- **100% Offline-First Architecture**: Always reads and writes on-device IndexedDB via Dexie first. Works with zero internet connection.
- **Automatic Cloud Delta Sync**: Automatically synchronizes when online, on app open, and in the background. Uses monotonic Postgres sequence (`server_seq`) and *"newest `updatedAt` wins"* conflict resolution.
- **Adaptive Dual UI (Phone & PC)**:
  - **Phone UI**: Bottom tab bar, scrollable section chips, touch targets $\ge 48\text{px}$, sticky mini timer bar, big $+$ action button, 2x2 analytics cards.
  - **PC UI**: Left sidebar, top bar active timer, board-style columns with drag-and-drop, right-side Day summary panel, keyboard shortcuts (`N`, `Esc`, `1-4`, `Space`).
- **YouTube Studio-Style Analytics**:
  - 7 / 28 / 90-day periods with comparison delta vs prior period (green up $\nearrow$ / red down $\searrow$).
  - Smooth line/area chart with **Daily vs Cumulative** curve toggle (subscriber watch-hour growth curve).
  - Estimated vs Actual Hours bar chart.
  - Section time distribution donut chart with accessible legends.
- **Automated Planning from Previous Day**: Automatically detects yesterday's unfinished tasks and reviews, offering a 1-click import review to adjust and schedule.
- **Clock-Accurate Running Timer**: Calculates elapsed time using system clock epochs (`Date.now()`); survives phone screen locks, browser sleeps, and reloads.
- **1-Minute Evening Review**: Prompts for *What worked?*, *What blocked me?*, and *One change for tomorrow?*, automatically carrying forward tomorrow's change into the next day's plan.
- **Installable PWA**: Standalone display, maskable icons, offline service worker, and *"New version available - reload"* banner.
- **Self-Hosted & Privacy-First**: Zero external CDNs or Google Fonts. `@font-face` kit for **Bloody Hell** with robust system fallbacks.

---

## 📁 Project Structure

```
planner/
├── public/
│   ├── fonts/               # Put Bloody Hell @font-face kit here (.woff2, .woff, .ttf)
│   ├── icons/               # 192x192, 512x512, and maskable PWA icons
│   ├── manifest.json        # PWA Web App Manifest
│   └── sw.js                # Offline Service Worker with app shell precaching
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── login/       # Rate-limited single-user auth with 90-day cookie
│   │   │   ├── logout/      # Clears session cookie
│   │   │   └── sync/        # Cloud delta sync with Neon Postgres
│   │   ├── globals.css      # Custom @font-face, dark/light themes, WCAG contrast
│   │   ├── layout.tsx       # Root layout with PWA meta & viewport
│   │   └── page.tsx         # Unified client SPA shell with adaptive Phone/PC routing
│   ├── components/
│   │   ├── Header.tsx       # Top bar with sync status pill & PC timer
│   │   ├── Modals/          # TaskFormModal, LoginModal, ImagePreview, ManualTime, AutoPlan
│   │   ├── Navigation/      # PhoneTabBar, PCSidebar, UpdateBanner
│   │   ├── Plan/            # Plan screen (Phone chips / PC board columns)
│   │   ├── Today/           # Today action screen with live timers & 1-min review
│   │   ├── Progress/        # YouTube Studio analytics with Recharts
│   │   └── Settings/        # Section manager, sample data, JSON backup/restore
│   ├── lib/
│   │   ├── db/              # Dexie IndexedDB schemas & persistent storage
│   │   ├── plan/            # Auto-plan carry-over & default date calculations
│   │   ├── pwa/             # Service worker registration & update listener
│   │   ├── server/          # Neon client & HMAC signed auth tokens
│   │   ├── sync/            # Delta sync engine & pure conflict resolution logic
│   │   ├── timer/           # Sleep-safe system clock timer hook
│   │   └── utils/           # Image compressor & WCAG 2.1 color contrast tools
│   └── types/               # Shared TypeScript models
├── schema.sql               # Neon Postgres database schema & monotonic sequence
├── .env.example             # Environment template
└── vitest.config.ts         # Vitest configuration for sync engine tests
```

---

## 🛠️ Step-by-Step Setup Guide

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Fill in your variables:
```env
# Neon Postgres Connection URL
DATABASE_URL="postgres://username:password@ep-your-project.us-east-2.aws.neon.tech/neondb?sslmode=require"

# Your single-user login password
APP_PASSWORD="your-strong-password"

# At least 32 characters for HMAC cookie signing
SESSION_SECRET="generate-a-random-secret-key-at-least-32-chars-long"
```

### 3. Setup Neon Postgres Database
1. Go to [neon.tech](https://neon.tech) and create a project.
2. In the Neon Console, navigate to the **SQL Editor**.
3. Open `schema.sql` from this project, copy the contents, paste into the Neon SQL Editor, and click **Run**.
4. Copy the connection string into `DATABASE_URL` in `.env.local`.

*(Note: The app's `/api/sync` route also verifies and auto-creates tables if they don't exist yet!)*

### 4. Add the "Bloody Hell" Font
Place your font files in `public/fonts/`:
- `public/fonts/BloodyHell.woff2` (preferred)
- `public/fonts/BloodyHell.woff`
- `public/fonts/BloodyHell.ttf`

The app loads them via `@font-face` with `font-display: swap` and caches them in the service worker for offline use. If not provided, it gracefully falls back to clean, bold system typography.

### 5. Run the Local Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 6. Run the Automated Sync Tests
```bash
npm test
```
Runs the 7 automated unit tests covering:
- Newest `updatedAt` wins conflict rule
- Unsynced local offline edit priority
- Soft delete propagation
- Idempotent repeated sync passes
- Exponential backoff retry calculations

---

## 🚀 Deploy to Vercel

1. Push your repository to GitHub.
2. Go to [vercel.com](https://vercel.com) and click **Add New Project**.
3. Import your repository.
4. Add the 3 environment variables in Vercel Project Settings:
   - `DATABASE_URL`
   - `APP_PASSWORD`
   - `SESSION_SECRET`
5. Click **Deploy**.

---

## 📱 Installing the PWA on Phone and PC

### On Phone (iPhone / Android)
- **Safari (iOS)**: Open your deployed URL $\rightarrow$ Tap the **Share** button $\rightarrow$ Tap **Add to Home Screen**.
- **Chrome (Android)**: Open your deployed URL $\rightarrow$ Tap the three dots $\rightarrow$ Tap **Install App** (or **Add to Home screen**).

### On PC (Chrome / Edge / Brave)
- Look for the **Install Night Planner** icon on the right side of the address bar, or open browser settings $\rightarrow$ **Install Night Planner**.
- The app will run in its own standalone, distraction-free window.

---

## 🧪 Testing Offline Mode & Cloud Sync

1. **First-time Login**: Open the app while connected to the internet. Click the **Login to Sync** badge (or go to Settings $\rightarrow$ Login) and enter your `APP_PASSWORD`.
2. **Turn off Internet**:
   - On PC: Open Chrome DevTools $\rightarrow$ Network tab $\rightarrow$ select **Offline**, or disconnect Wi-Fi.
   - On Phone: Toggle **Airplane Mode**.
3. **Use the App Completely Offline**:
   - Create a task, adjust estimates, start and stop the timer, write your 1-minute evening review.
   - Notice the header badge shows **📡 Offline** or **⏳ X changes waiting**. Everything is saved instantly to IndexedDB on your device.
   - Refresh the page or close and re-open the browser: the app opens immediately from the service worker cache and your tasks are intact!
4. **Reconnect Internet**:
   - Turn off Airplane Mode / re-enable Wi-Fi.
   - Within seconds (or on the online event), the sync engine pushes your unsynced changes to Neon Postgres.
   - The status updates to **🟢 All saved (Last synced: HH:mm)**.
   - Check your Neon SQL Editor: `SELECT * FROM tasks;` and verify your offline changes are now in the cloud!
