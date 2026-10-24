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
cd backend && npm test   # backend tests (Node's built-in test runner)
```

The frontend unit tests (`npm test` in the project root) do not run yet: `src/app/list/list.spec.ts` imports a class that does not exist, and the other spec files are the generated "should create" stubs. The settlement rules have no automated tests yet.

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
- Each app's backend reads `backend/.env` **on the server**. The workflow does not write it and does not overwrite it. To change a database or secret, edit that file and run `pm2 restart <process>`.
- GitHub secrets needed in the repository settings: `SSH_HOST`, `USERNAME`, `SSH_PRIVATE_KEY`.
- The workflow installs npm 11.6.3 (the version in `package.json`); the npm that comes with the GitHub runner crashes on this dependency tree.
- The earlier Gambit and Cumbre apps run beside these under other names and ports, from another repository. Never reuse their process names, ports or folders.
- After a deploy, check the health addresses: `/api-phantom-2027/health` and `/api-detori-2027/health` should answer `"database":"Connected"`.

More detail for the server and for WhatsApp: [DIGITAL_OCEAN_SETUP.md](DIGITAL_OCEAN_SETUP.md), [WHATSAPP-SETUP.md](WHATSAPP-SETUP.md).

## Sessions and security

- A login lasts **1 hour**, then you log in again.
- You are logged out after **4 minutes without using the app** (no click, tap or typing; also when the tab is hidden, the window is minimised or left on another screen, or the computer sleeps). Details in [AUTHENTICATION.md](AUTHENTICATION.md).
- Logging out clears the data saved in the browser for offline use.
- Meetings older than **6 days** are deleted, with their bets, at the next login. Print or export what you need before then.

## Known issues

See "Recommendations" in [AUTHENTICATION.md](AUTHENTICATION.md) and the notes in [scripts/README-offline-pwa.md](scripts/README-offline-pwa.md).

## Other documents

- [AUTHENTICATION.md](AUTHENTICATION.md): users, login and session rules
- [WHATSAPP-SETUP.md](WHATSAPP-SETUP.md): WhatsApp tab
- [DIGITAL_OCEAN_SETUP.md](DIGITAL_OCEAN_SETUP.md): server setup and troubleshooting
- [scripts/README-offline-pwa.md](scripts/README-offline-pwa.md): offline mode and sync
- [scripts/ONE-PAGE-DEMO.md](scripts/ONE-PAGE-DEMO.md): offline demo script
