# ITB One-Page Production Demo (Offline + Sync Proof)

## Purpose
Use this page to demonstrate and sign off that ITB is production-ready for offline operation and safe sync recovery.

## Prerequisites (Before Demo)
1. Frontend and backend are running.
2. Browser has opened the app at least once while online (PWA cache installed).
3. Test user can log in.
4. Backend sync audit endpoint is reachable.

## Start Commands
1. Backend:
  - `cd backend`
  - `npm start`
2. Frontend:
  - `cd ..`
  - `npm start`

## Client-Facing Success Criteria
1. App remains usable when internet drops.
2. New records are queued offline without data loss.
3. Queued records sync after reconnect.
4. UI clearly reports Online/Offline, Pending, Conflict, Failed, Last Sync, and Sync result message.
5. Conflict cases are visible and do not silently overwrite server data.

## 3-Minute Live Demo Script
1. Keep internet ON and create one normal record.
2. Turn Wi-Fi OFF.
3. Confirm red badge: `Internet Offline`.
4. Create 2-3 records while offline.
5. Show `Pending` count increased.
6. Turn Wi-Fi ON.
7. Click `Sync Now`.
8. Confirm proof on UI:
  - `Pending` goes down to 0 (or lower than before)
  - Sync message shows `Sync successful: X item(s) sent` (or partial/issue)
  - `Last Sync` timestamp updates

## Server-Side Proof (Optional but Recommended)
1. Run: `powershell -ExecutionPolicy Bypass -File "scripts/phase34-api-verify.ps1"`
2. Show sync audit entries from backend endpoint (`/api/sync/audit`).

## Important Production Behavior
1. Offline refresh works only after first successful online load on that browser/device.
2. If browser storage is cleared, cache/outbox is cleared too.
3. `localhost` is for local machine only; production must use real server URL/domain.

## Production Checklist (Go-Live)
1. Replace localhost API URL with production API URL.
2. Enable HTTPS for frontend and backend.
3. Protect secrets with environment variables (no secrets in repo).
4. Confirm backup/restore policy for MongoDB.
5. Confirm monitoring/logging for backend uptime and sync failures.
6. Verify role/access rules and token policy in production environment.

## Acceptance Statement
"ITB supports offline data capture and safe deferred synchronization. During outages, records are queued locally and synced when connectivity returns, with visible proof in UI and audit evidence on server."
