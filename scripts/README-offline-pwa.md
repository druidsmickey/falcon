# ITB Offline/PWA & Sync Guide

This document explains how the offline (PWA) features work, how the client interacts with them, and how the system is set up for offline/online operation.

---

## 1. How does the offline feature work?

- **PWA (Progressive Web App):**
  - The app is installable on desktop and mobile browsers (look for the install prompt or use browser menu > "Install App").
  - A service worker caches static assets and API data for offline use.
- **Offline Data Entry:**
  - When the internet is lost, you can still enter bets, params, and init data.
  - All offline actions are queued in the browser (IndexedDB outbox).
  - A yellow banner shows when you are offline.
- **Syncing:**
  - When you reconnect, the app auto-syncs all queued actions to the server.
  - You can also press the "Sync Now" button (top bar) to force a sync when online.
  - If a conflict is detected (e.g., someone else changed the same data), you’ll see a conflict status in the sync queue.
- **Idempotency:**
  - Each offline action has a unique request ID, so duplicate syncs are ignored by the backend (no double entries).

---

## 2. Where does the project run?

- **Local System:**
  - You can run the backend (Node.js/Express) and frontend (Angular) on your own computer for development or demo.
  - Use the provided batch script: `scripts/run-itb-local.bat` to start both servers.
- **Website/Production:**
  - The app is designed to be deployed to a web server (frontend build + backend API).
  - Users access it via browser (Chrome, Edge, etc.), and can install it as a PWA for offline use.

---

## 3. How was the PWA/offline system implemented?

- **Frontend:**
  - Angular 21 with service worker enabled (`ngsw-config.json`).
  - IndexedDB outbox (Dexie) for queuing offline actions.
  - Sync service that auto-syncs on reconnect or on "Sync Now".
  - Manual sync button and status display in the app shell.
  - UI banners for offline/online state.
- **Backend:**
  - Express.js API with idempotency checks (clientRequestId) for all write endpoints.
  - Conflict detection for params/init using last-updated timestamps.
  - Sync audit log for all sync attempts and conflicts.

---

## 4. How to use offline features as a client

1. **Go offline (disconnect WiFi or unplug cable).**
2. Enter bets, params, or meeting data as usual.
3. See the yellow "Offline mode" banner.
4. Reconnect to the internet.
5. Wait for auto-sync, or press "Sync Now".
6. Check sync status (pending/conflict/failed) in the top bar.
7. If a conflict occurs, resolve it manually (see audit log for details).

---

## 5. Troubleshooting

- If sync does not work, check your internet connection and backend server status.
- If you see repeated conflicts, ensure you are not editing the same data from multiple devices at the same time.
- For advanced troubleshooting, use the API verification script: `scripts/phase34-api-verify.ps1`.

---

## 6. Further Reading

- See main [README.md](../README.md) for full setup and deployment instructions.
- See [AUTHENTICATION.md](../AUTHENTICATION.md) for login and security details.

---

*This file summarizes all offline/PWA changes and usage for client handover.*
