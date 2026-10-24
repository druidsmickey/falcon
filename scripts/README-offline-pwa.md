# Offline mode and sync

How the app keeps working when the internet drops, what it can and cannot do offline, and how it catches up afterwards.

## What works offline

| Action | Offline? |
|---|---|
| Enter bets (Entry, Single, Chart) | **Yes**: saved in the browser and sent later |
| Save Params (horse names, Special, Rule 4) | **Yes**: queued |
| Save a meeting's races in Init | **Yes**: queued |
| Look at charts, lists and reports | Yes, from the data last loaded (see below) |
| Tick winners | **No**: needs the server |
| Cancel or uncancel a bet | **No** |
| Reports add-ons, deleting a meeting, change password, WhatsApp | **No** |

If a "No" action is tried offline it fails with an error message.

## How it works

- **Always current data.** The service worker asks the server first for every API call and uses its saved copy only when the server cannot be reached (after 8 seconds or when offline), so a page never shows hours-old bets.
- **Installable app (PWA).** In a production build a service worker keeps the app itself available offline. The app can be installed from the browser menu ("Install app"). It must have been opened **once while online** on that device first.
- **Outbox.** Offline saves are put in a queue in the browser (IndexedDB, `itb-offline`). Each item has a unique request id.
- **Data cache.** Races, params, bets and the last bet are also kept in the browser (localStorage) so the pages can still show data offline. Offline bets are added to this copy straight away, so the charts include them.
- **Sync.** When the connection returns, and every 30 seconds while online, the app sends the queued items in order, then downloads the latest data from the server. If anything was sent, the page reloads once to show the server's version.
- **No double entries.** The server remembers request ids, so an item sent twice is ignored the second time.
- **Conflicts.** For Params and Init the server compares the time the edit started from with the time the data last changed. If someone else changed it meanwhile, the server answers 409 and the item is marked **conflict**.

## The Online / Sync button

The button in the tab bar shows **Online** or **Offline** (green or red) and **Sync**. Press it, or open its tab, to see:

- **Network:** online or offline
- **Pending / Conflicts / Failed:** how many queued items are waiting, in conflict, or failed
- **A message:** for example `Sync successful: sent 3, fetched 120`, `Sync partial...` or `Sync issue...`
- **Last Sync:** time of the last attempt
- **Sync Now:** send everything now (only works when the app thinks you are online)

## Things to know

- **A conflict or a rejection is not retried and there is no screen to fix it.** The item stays counted under Conflicts. This also covers a bet the server refuses because its figures are wrong (the sync message and the audit say why). Look at what happened with the sync audit (`GET /api/sync/audit`, or `scripts/phase34-api-verify.ps1`), check the data on the server, and enter the change again by hand. Avoid editing the same meeting from two devices at once.
- **A failed item is retried** at the next sync.
- **How "Offline" is decided.** The app asks its own server (`/health`, every 10 seconds) besides the browser's own online flag. So **Offline** means "this app cannot reach its server", even if the rest of the internet works, and **Sync Now** only runs when the server answers.
- **Login and offline.** A login lasts 1 hour and the app logs out after 4 minutes without use. Logging out **clears the cached data** (not the outbox), so offline use after a logout or after the hour has passed is not possible until you log in again online. Queued bets stay in the outbox and are sent after the next login. See [../AUTHENTICATION.md](../AUTHENTICATION.md).
- **Clearing browser data** (site data, private windows) removes the cache and the outbox with anything not yet sent.
- **Fonts and icons** are loaded from Google, so the first load offline on a new device needs one online visit, and icons may show as text if they were never cached.
- **Development builds** (`npm start`) do not use the service worker. Test offline behaviour with a production build.
- **Meetings older than 6 days are deleted** at login, together with their bets (see [../AUTHENTICATION.md](../AUTHENTICATION.md)).

## Running it on your computer

- Follow [../README.md](../README.md) to start the backend and the frontend.
- `scripts/run-itb-local.bat` starts both for you, but its `ROOT` line has a folder on another computer. Change it to the project folder first.

## Testing offline

1. Log in and open the app while online.
2. In the browser's developer tools (Network tab) choose **Offline**, or turn Wi-Fi off. The button turns red.
3. Enter a few bets and save Params. The Pending count goes up.
4. Go online again. The app syncs by itself, or press **Sync Now**. Pending goes down and the message says `Sync successful`.
5. Optional: `powershell -ExecutionPolicy Bypass -File scripts/phase34-api-verify.ps1` checks the sync API, and `/api/sync/audit` lists what was synced, duplicated, rejected or failed.

## Further reading

- [../README.md](../README.md): setup, rules and deployment
- [../AUTHENTICATION.md](../AUTHENTICATION.md): login and session rules
