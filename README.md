# ITB

Bet-taking and settlement tool for horse racing. Staff enter bets against a meeting's races, the app keeps a live book (books, profit and loss, average) per horse, and works out each client's profit or loss at the end, including special withdrawals, Rule 4 deductions and dead heats. Reports can be printed and sent to clients over WhatsApp.

The same code is deployed as two separate apps, **Phantom** and **Detori**, each with its own database and users.

- **Frontend:** Angular 21 (standalone components, Angular Material), installable as a PWA with an offline queue (IndexedDB via Dexie).
- **Backend:** Node.js, Express 5, MongoDB (Mongoose), JWT login, `whatsapp-web.js` for WhatsApp.

## The tabs

| Tab | What it is for |
|---|---|
| Entry | Fast bet entry: pick race, horse, client, books/odds, tax |
| Single | One race at a time: live books, P&L and average per horse, tap a horse to bet |
| Chart | All races side by side with the same figures |
| WhatsApp | Connect WhatsApp, manage contacts and groups, send messages, reports and images |
| List | Every bet of the meeting, search, cancel/uncancel, print |
| Winners | Tick the winner of each race (several for a dead heat) |
| Reports | Client reports: detail and summary (Collect / Pay), add-ons, print |
| Merge | Combine up to 4 meetings into one client report |
| Params | Horse names, Special and Rule 4 withdrawals with times and deduction % |
| Init | Create a meeting, its races and number of horses; choose the selected meeting; delete a meeting |
| Password | Change your password |
| Online / Sync | Connection status and the offline queue |

Only one meeting is *selected* at a time. All tabs work on the selected meeting, except Merge.

## Settlement rules

These are applied in Reports, Merge, Chart, Single and List.

- **Special withdrawal:** if a horse is withdrawn "special", every bet in that race placed *before* the withdrawal time is void.
- **Rule 4 horse:** every bet on the withdrawn Rule 4 horse is ignored, whenever it was placed.
- **Rule 4 deduction on the other horses:** a bet placed *before* a Rule 4 time has its payout reduced by that deduction. With several withdrawals the reductions multiply: a 10,000 payout with a 10% then a 20% withdrawal after the bet becomes 10,000 × 0.9 × 0.8 = 7,200.
- **Dead heat:** payout is divided by the number of winners.
- **Profit/loss per client** = (stake + tax) minus payout. Purchases (negative stake) reduce the total.

Bet amounts: with **F500**, stake = F500 × books and payout = books × 500. With **Odds**, books = stake × odds / 50000 and payout = odds × stake / 100.

## Running it on your computer

You need Node.js 22 and a MongoDB database (a free Atlas cluster is fine).

1. **Backend**
   ```bash
   cd backend
   npm install
   ```
   Create `backend/.env` (it is git-ignored):
   ```
   PORT=3000
   MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/itb_dev?retryWrites=true&w=majority
   JWT_SECRET=a-long-random-string
   ```
   Put a database name (here `itb_dev`) in the connection string. Without one MongoDB uses `test`. Use a database of your own so that testing never touches real data.

   Create the first user, then start the server:
   ```bash
   APP_SCOPE=phantom npm run create-user   # see AUTHENTICATION.md
   npm start
   ```
2. **Frontend** (project root)
   ```bash
   npm install
   npm start
   ```
   Open http://localhost:4200. In development the app talks to `http://localhost:3000` (see `src/environments/environment.ts`).

## Tests and builds

```bash
npm run build            # production build of the frontend
npm test -- --watch=false   # frontend tests (Vitest)
cd backend && npm test      # backend tests (Node's built-in test runner)
```

- **Frontend tests** cover the Rule 4 calculation (`src/app/services/settlement.spec.ts`) and the login session rules, including the 4-minute and 1-hour limits (`auth.service.spec.ts`).
- **Backend tests** (`backend/test/`) cover the check of incoming bets, the fields of a single-horse update, how rows are saved, and the login rate limit. `integration.test.js` starts the real server against a throwaway MongoDB (the first run downloads a small test database program) and checks the data protections: simultaneous saves leave no duplicate rows, winners survive saves, leftover duplicates are removed at start-up, meetings older than 6 days are deleted, the server listens only on `127.0.0.1`, and it refuses to start without a JWT secret.
- The deploy workflow runs both before it builds anything; a failing test stops the deploy.
- The screens themselves (components) have no automated tests. After changing a calculation, compare Reports, Merge, Chart and Single on real data before deploying.

## Deployment

Pushing to `main` of this repository runs `.github/workflows/deploy.yml`, which builds the frontend twice (once per app) and deploys both to the droplet over SSH.

| | Phantom | Detori |
|---|---|---|
| Web address | `/Phantom/2027/` | `/Detori/2027/` |
| API address | `/api-phantom-2027/` | `/api-detori-2027/` |
| Folder on the server | `/root/Phantom/itb/2027` | `/root/Detori/itb/2027` |
| Backend port | 3010 | 3011 |
| PM2 process | `phantom-backend-2027` | `detori-backend-2027` |

- nginx (`/etc/nginx/sites-enabled/apps`) serves `dist/itb/browser/` of each folder and forwards the API paths to the ports above. Use the address **with the trailing slash**; without it nginx answers 404.
- Each app's backend reads `backend/.env` **on the server**. The workflow does not write it and does not overwrite it. To change a database or secret, edit that file and run `pm2 restart <process>`. The file needs `PORT`, `MONGODB_URI` and `JWT_SECRET`; the server **refuses to start without `JWT_SECRET`**. `CORS_ORIGINS` (a comma-separated list of web addresses) is only needed if the app is ever opened from an address other than the one the API is on; it defaults to `http://localhost:4200` for local development.
- GitHub secrets needed in the repository settings: `SSH_HOST`, `USERNAME`, `SSH_PRIVATE_KEY`.
- The workflow installs npm 11.6.3 (the version in `package.json`); the npm that comes with the GitHub runner crashes on this dependency tree.
- The earlier Gambit and Cumbre apps run beside these under other names and ports, from another repository. Never reuse their process names, ports or folders.
- After a deploy, check the health addresses: `/api-phantom-2027/health` and `/api-detori-2027/health` should answer `"database":"Connected"`.

More detail for the server and for WhatsApp: [DIGITAL_OCEAN_SETUP.md](DIGITAL_OCEAN_SETUP.md), [WHATSAPP-SETUP.md](WHATSAPP-SETUP.md).

## Sessions and security

- A login lasts **1 hour**, then you log in again.
- You are logged out after **4 minutes without using the app** (no click, tap or typing; also when the tab is hidden, the window is minimised or left on another screen, or the computer sleeps). Details in [AUTHENTICATION.md](AUTHENTICATION.md).
- Rows of the Params and Init pages are saved in place (found by race and horse number) and the database allows only one row per horse and per race, so two saves at the same time can never create duplicates. At start-up the server removes any duplicates left by older versions.
- Wrong passwords are limited: after 10 failures for one user name from one address, or 100 from one address, login is refused for 15 minutes.
- Logging out clears the data saved in the browser for offline use.
- Meetings older than **6 days** are deleted, with their bets, at the next login. This applies to every meeting, selected or not. The age counts from when the meeting was first input; saving its races again does not restart it. Print or export what you need before then.
- The server checks every bet it receives: stake, books and payout must agree with the F500 or odds that were entered, and only known fields are stored.

## Known issues

- **No HTTPS yet.** The apps are served over plain HTTP, so passwords and tokens travel unencrypted. Put a domain and a certificate in front of the server. HTTPS is also what makes the app installable on a phone and lets the offline app files work (see below). The server itself is locked down: firewall, SSH keys only, fail2ban (see [DIGITAL_OCEAN_SETUP.md](DIGITAL_OCEAN_SETUP.md)).
- **No offline app files and no "install app" without HTTPS.** The service worker that keeps the app available offline only runs on HTTPS (or `localhost`). On the current HTTP address, bets queued offline are kept and sent later, but reloading or reopening the app while offline does not work.
- **Offline use is limited by the login rules.** Logging in needs the server, and the app logs out after 4 minutes without use, so a device that goes offline and then sits idle cannot sign back in until it is online again.
- **11 `npm audit` findings remain in the backend**, all inside `whatsapp-web.js` and its Puppeteer (browser) dependency. They are not reachable from the web; the suggested fix is a downgrade that does not remove them.
- **Every user can do everything.** There is one kind of user and no screen to add users.
- Meetings of more than 6 days are removed automatically (see above).

More in [AUTHENTICATION.md](AUTHENTICATION.md) and [scripts/README-offline-pwa.md](scripts/README-offline-pwa.md).

## Other documents

- [AUTHENTICATION.md](AUTHENTICATION.md): users, login and session rules
- [WHATSAPP-SETUP.md](WHATSAPP-SETUP.md): WhatsApp tab
- [DIGITAL_OCEAN_SETUP.md](DIGITAL_OCEAN_SETUP.md): server setup and troubleshooting
- [scripts/README-offline-pwa.md](scripts/README-offline-pwa.md): offline mode and sync
- [scripts/ONE-PAGE-DEMO.md](scripts/ONE-PAGE-DEMO.md): offline demo script
