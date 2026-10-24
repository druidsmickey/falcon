# ITB one-page demo: offline entry and sync

Use this page to show that ITB keeps taking bets when the internet drops and catches up safely afterwards. For how it works in detail, see [README-offline-pwa.md](README-offline-pwa.md).

## Before the demo

1. The backend and frontend are running (locally: see [../README.md](../README.md); or use a deployed app).
2. A meeting is **selected** in the Init tab, with races and horse names in Params.
3. For the offline part, use a **production build** (`npm run build` and serve it, or the deployed app). The development server (`npm start`) has no service worker.
4. Open the app once **while online** in the browser you will use, so it is cached.
5. Log in **just before** you start. The login lasts 1 hour and the app logs you out after **4 minutes without use**, which would interrupt a slow demo. Keep clicking, or log in again if it happens (queued bets are kept).

## Success criteria

1. The app stays usable when the internet drops.
2. New bets and saves are queued offline with no loss.
3. Queued items are sent after reconnecting, with no double entries.
4. The screen shows Online/Offline, Pending, Conflicts, Failed, the last sync time and a result message.
5. A conflict is shown and never silently overwrites the server's data.

## 3-minute script

1. With the internet **on**, enter one normal bet in the **Entry** tab.
2. Turn Wi-Fi **off**. The tab-bar button turns red and says **Offline**.
3. Enter 2 or 3 more bets. Each shows "Saved offline".
4. Open the sync tab (the **Offline | Sync** button). **Pending** has gone up.
5. Turn Wi-Fi **on** and press **Sync Now** (or wait up to 30 seconds).
6. Show the proof on screen:
   - **Pending** drops to 0
   - the message reads `Sync successful: sent 3, fetched ...`
   - **Last Sync** shows the new time
7. Open the **List** tab: all bets are there, once each.

## Proof on the server (optional)

- Run `powershell -ExecutionPolicy Bypass -File scripts/phase34-api-verify.ps1`, or
- open `/api/sync/audit` (needs a login token) to list what was synced, ignored as a duplicate, rejected as a conflict, or failed.

## Limits to mention

1. Offline pages only work after the app was opened once online on that device.
2. Entering bets, saving Params and saving Init work offline. Ticking winners, cancelling bets and WhatsApp need the internet.
3. Clearing the browser's site data removes the saved copy and any unsent items. Logging out clears the saved copy of the data but not the unsent items.
4. The app decides it is online by contacting its own server. If the server cannot be reached (even though the internet works), it shows Offline and keeps the work in the queue.
5. A conflict (the same Params or Init data was changed elsewhere) or a bet the server refuses is not retried and has no resolve screen: check the data and enter it again.

## Go-live checklist

| Item | State |
|---|---|
| Production API address set | Done by the deploy workflow (`/api-phantom-2027`, `/api-detori-2027`) |
| Secrets kept out of the repository | `backend/.env` lives on the server only; GitHub secrets hold the SSH key |
| Server hardening | Done: firewall (22, 80, 443 only), SSH keys only, fail2ban, backends on 127.0.0.1, log rotation |
| HTTPS for the web address and API | **Not done.** Passwords and tokens travel unencrypted until a domain and certificate are added |
| Login attempts limited | Done: 10 wrong passwords per user and address, 100 per address, then 15 minutes |
| Database backups | Confirm the backup policy of the MongoDB cluster |
| Monitoring | `pm2 list` and the `/health` addresses; consider an uptime monitor |
| Automatic deletion | Meetings older than 6 days are deleted at login. Confirm this is wanted |

## Acceptance statement

"ITB supports offline bet entry and safe deferred synchronisation. During an outage, records are queued in the browser and sent when the connection returns, with the result visible on screen and an audit trail on the server."
