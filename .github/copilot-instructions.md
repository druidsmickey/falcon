# ITB - Betting Management System

## Architecture Overview

This is a full-stack betting/race management application:
- **Frontend**: Angular 21 standalone components with Material Design, signals for state management
- **Backend**: Express.js + MongoDB (Mongoose) REST API
- **Authentication**: JWT tokens valid for 1 hour, plus an auto-logout after 4 minutes without use; the token and the data key live in memory only and everything saved in the browser is encrypted (see below)

The app manages horse racing meetings, tracks bets (sales/purchases), calculates payouts, and generates reports.

## Project Structure

### Frontend (`src/app/`)
- **Routing**: Login page → authenticated tabs (home) with route guards
- **Main App** ([app.ts](../src/app/app.ts)): Tab-based interface importing all feature components
- **Features as tabs**: `dataentry`, `single`, `chart`, `whatsapp-inbox`, `whatsapp` (connection and contacts only), `list`, `winners`, `reports`, `merge`, `params`, `init`, `change-password` (plus the Online/Sync and Logout buttons in the tab bar)
- **Auth System**: `guards/auth.guard.ts` protects routes, `interceptors/auth.interceptor.ts` adds JWT to requests, `services/auth.service.ts` manages login/logout with activity tracking

### Backend (`backend/`)
- **Entry**: `server.js` - Express server with MongoDB connection
- **Models**: `models/bets.js` (bet records), `models/init.js` (meetings/races), `models/params.js` (horse parameters), `models/syncAudit.js` (offline sync log), `models/whatsapp*.js` (contacts, groups, messages), `model/user.js` (authentication), `model/report.js` (client add-ons)
- **Routes**: `routes/auth.js` (login, password change), `routes/whatsapp.js` (WhatsApp client, contacts, sync of the phone's contacts, and the old group/sending routes the app no longer uses), `routes/whatsappInbox.js` (inbox, nickname and listen)
- **Helpers and tests**: `lib/save.js` (checks the rows of the Params and Init pages and prepares the in-place writes; the winner flag is simply not touched), `lib/db.js` (removes leftover duplicate rows and builds the unique indexes at start-up), `lib/params.js` (checks single-horse updates), `lib/bets.js` (checks every incoming bet: amounts must agree with the F500 or odds), `lib/ratelimit.js` (login attempt limits), `test/` (run with `npm test` in `backend/`)
- **API Base**: All endpoints prefixed with `/api/` except `/auth/`

### Data Flow
1. **Init Tab**: Create meeting → define races → mark as selected
2. **Params Tab**: Horse names per race, plus Special and Rule 4 withdrawals (time, and the Rule 4 deduction %)
3. **Dataentry/Single Tabs**: Record bets (sales to clients, purchases from bookmakers)
4. **Winners Tab**: Mark winners → calculate payouts
5. **Reports/Chart**: Analyze betting data

## Angular Conventions (See .claude/CLAUDE.md)

- **Standalone components only** (no NgModules) - `standalone: true` is default, don't set it
- **Signals for state**: Use `signal()`, `computed()`, avoid `mutate()` - use `set()` or `update()`
- **Modern syntax**: `input()`, `output()` functions instead of decorators
- **Native control flow**: `@if`, `@for`, `@switch` instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- **Dependency injection**: Use `inject()` function, not constructor injection
- **ChangeDetection**: Set `OnPush` in `@Component` decorator
- **Host bindings**: Use `host: {}` in decorator, not `@HostBinding`/`@HostListener`
- **Styling**: Use class/style bindings directly, not `ngClass`/`ngStyle`

## Types and data

- Shared data shapes (`Bet`, `HorseParam`, `SelectedRace`, `BetRequest`, ...) are in [models.ts](../src/app/models.ts). Use them instead of `any`; the project has none.
- Rule 4 deductions: use `applyRule4`, `rule4Applies`, `rule4Percentages` from [settlement.ts](../src/app/services/settlement.ts) rather than writing the loop again.
- Templates use `@if`/`@for` and `[class.name]` bindings; services and components use `inject()`.
- Sending a bet goes through `MeetingDataService.submitBet()`: it sends the bet, or queues it in the outbox when offline or when the server cannot be reached (status 0 or 5xx); only a 4xx is reported. Bets still in the outbox are merged into `getBets()` and `getLastBet()`, so every screen shows them. Do not post bets directly from a component.
- The API data is fetched fresh from the server; the encrypted vault copy is used only when the server cannot be reached. The service worker (`ngsw-config.json`) caches only the app files, no API data.

## Authentication Flow

**Critical**: the session rules are enforced client-side in [auth.service.ts](../src/app/services/auth.service.ts) and by the token expiry set in [auth.js](../backend/routes/auth.js):
- The JWT is valid for **1 hour** (`expiresIn: "1h"`); the app reads its `exp` and logs out when it has passed
- **4 minutes without use** logs out (`IDLE_LIMIT`): clicks, taps and key presses always count; mouse moves and scrolling only count while the window has focus. A hidden tab, minimised window, unfocused window or sleeping PC therefore times out too
- The limits are checked before the activity time (kept in memory) is refreshed, so the first touch after a long break logs out instead of extending the session
- `interceptors/auth.interceptor.ts` sends the user back to login on a 401/403 (except for the `/auth/` calls)
- Logging out locks the vault (`VaultService.lock()`) and does a hard navigation to `/login`, so nothing stays in memory; the encrypted data stays on the device
- **Never call `localStorage` directly for data.** Everything goes through `VaultService` (`src/app/security/`): the login password derives the key (scrypt), values are XChaCha20-Poly1305 sealed and stored under hashed names. Only `appContext` and the duress check `itb-ui` are plain. Offline queue payloads are sealed too (`OfflineStoreService`). See [DEVICE_SECURITY.md](../DEVICE_SECURITY.md)
- `AuthService.signIn()` first checks the **duress code** (`DuressService`): a match runs `DeviceWipeService.wipeAndLeave()` (destroy the vault key first, then storage, IndexedDB, caches, service worker) and goes to `/arcade` (pinball). Tests: `security/*.spec.ts`, `arcade/pinball-engine.spec.ts`
- Without a token (server unreachable) the app works from the saved data (`isOfflineSession()`); `OfflineSyncService` sends the queue only when a token exists

**Setup** (see [AUTHENTICATION.md](../AUTHENTICATION.md)):
1. Create `backend/.env` with `MONGODB_URI`, `JWT_SECRET`, `PORT`
2. Run `cd backend && APP_SCOPE=phantom npm run create-user` to create `Admin` with a random password that is printed once (change it at once in the Password tab)
3. Start backend: `cd backend && npm start` (port 3000)
4. Start frontend: `npm start` (port 4200)

## Development Workflows

### Running the Application
```bash
# Terminal 1 - Backend
cd backend
npm start  # Runs on port 3000

# Terminal 2 - Frontend
npm start  # Runs ng serve on port 4200
```

### Testing
```bash
npm test  # Runs Vitest (Angular 21 uses Vitest, not Karma)
```

### API Environment
- Development: `environment.ts` → `http://localhost:3000`
- Production: `environment.prod.ts` (the deploy workflow rewrites `apiUrl` with `sed`, so do not hand-edit it for deployment)
- Update `environment.apiUrl` if backend runs on different port
- Deployment, folders, ports and PM2 names: see [README.md](../README.md) and [DIGITAL_OCEAN_SETUP.md](../DIGITAL_OCEAN_SETUP.md). On Windows with Git Bash, set `MSYS_NO_PATHCONV=1` when running `ng build --base-href /x/`, or the slash is turned into a Windows path

## Backend API Patterns

### Standard REST Conventions
```javascript
// GET list
app.get('/api/meetings', async (req, res) => { ... });

// GET by ID/param
app.get('/api/meetings/:meetingName/races', async (req, res) => { ... });

// POST create/update (replaces existing data pattern)
app.post('/api/meetings/races', async (req, res) => {
  // Delete existing → Insert new approach
  await Init.deleteMany({ meetingName });
  await Init.insertMany(races);
});
```

### Meeting Selection Pattern
Only ONE meeting can be `selected: true` at a time. When setting selected:
```javascript
if (selected) {
  await Init.updateMany(
    { meetingName: { $ne: meetingName } },
    { $set: { selected: false } }
  );
}
```

### Error Handling
Return `{ error: error.message }` with appropriate status codes (400, 401, 500)

## Frontend Data Patterns

### HTTP Calls with Services
Components use `HttpClient` directly (no separate service layer for API calls):
```typescript
constructor(private http: HttpClient) {}

this.http.get<Race[]>(`${this.apiUrl}/meetings/${meetingName}/races`)
  .subscribe(races => this.races = races);
```

### Recent Clients Service
[recent-clients.service.ts](../src/app/services/recent-clients.service.ts) loads the client names for autocomplete from the API (the saved copy, used offline, is in the encrypted vault):
```typescript
await this.recentClientsService.addClient(clientName);  // Adds to recent list
this.recentClients = await this.recentClientsService.loadRecentClients();
```

## Material Design Integration

Import specific modules per component (see [dataentry.ts](../src/app/dataentry/dataentry.ts)):
```typescript
imports: [
  CommonModule, FormsModule,
  MatFormFieldModule, MatInputModule, MatSelectModule, 
  MatButtonModule, MatCardModule, MatRadioModule, MatChipsModule
]
```

Main theme: [material-theme.scss](../src/material-theme.scss) defines custom Material palette

## Key Business Logic

### Bet Calculations (in dataentry components)
- **Sales (to clients)**: Client pays stake, bookmaker pays out if horse wins
- **Purchase (from bookmakers)**: Bookmaker pays stake, client pays out if horse wins
- **Tax**: Default 5%, configurable per bet
- **Odds types**: Fixed 500 (`f500`) or standard odds (`odds`)
- Formulas calculate `books`, `payout`, `odds100` based on bet type

### Winner Management
- [winners/winners.ts](../src/app/winners/winners.ts): Mark horse as winner → triggers payout calculations
- Several winners are allowed (dead heat): each payout is divided by the number of winners
- Saving Params keeps the winners: rows are written in place and the page does not send `winner` (see `backend/lib/save.js`). Never go back to delete-then-insert: two saves at the same time then create duplicate rows, and a duplicated winner row makes Reports see a dead heat
- Affects all bets for that race

## Common Pitfalls

1. **Don't use `standalone: true`** - It's the default in Angular 21, setting it explicitly is redundant
2. **Backend runs on port 3000** - Frontend proxies are NOT configured, use full URL `http://localhost:3000`
3. **Auto-logout after 4 minutes without use** - change `IDLE_LIMIT` in `auth.service.ts` when developing, and restore it afterwards
4. **Selected meeting pattern** - Always ensure only one meeting is selected (see backend pattern above)
5. **Mongoose connection** - Check `.env` file exists in `backend/` folder, not root
6. **Material imports** - Import specific modules, don't use `MatLegacyModule` or similar

## Testing Notes

- Frontend: `npm test -- --watch=false` runs Vitest. The specs cover the Rule 4 calculation (`services/settlement.spec.ts`) and the session rules (`services/auth.service.spec.ts`). The screens (components) have no tests, so after changing a calculation compare Reports, Merge, Chart and Single on real data.
- Backend: `cd backend && npm test` runs the built-in Node test runner on `backend/test/*.test.js`: unit tests (bet checks, row saving, update fields, login rate limit) and `integration.test.js`, which starts the real server against an in-memory MongoDB (simultaneous saves, duplicate clean-up, 6 day clean-up, loopback only). The deploy workflow runs both suites before building.
- The settlement rules are written out in [README.md](../README.md). The Rule 4 deduction lives in one place, `src/app/services/settlement.ts`; special withdrawals, dead heats and the rest are still written out in reports, merge, chart and single and must be kept in step.
