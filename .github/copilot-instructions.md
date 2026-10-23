# ITB - Betting Management System

## Architecture Overview

This is a full-stack betting/race management application:
- **Frontend**: Angular 21 standalone components with Material Design, signals for state management
- **Backend**: Express.js + MongoDB (Mongoose) REST API
- **Authentication**: JWT tokens with 2-minute inactivity timeout, stored in localStorage

The app manages horse racing meetings, tracks bets (sales/purchases), calculates payouts, and generates reports.

## Project Structure

### Frontend (`src/app/`)
- **Routing**: Login page → authenticated tabs (home) with route guards
- **Main App** ([app.ts](../src/app/app.ts)): Tab-based interface importing all feature components
- **Features as tabs**: `dataentry`, `single`, `chart`, `list`, `winners`, `reports`, `params`, `init`, `merge`, `change-password`
- **Auth System**: `guards/auth.guard.ts` protects routes, `interceptors/auth.interceptor.ts` adds JWT to requests, `services/auth.service.ts` manages login/logout with activity tracking

### Backend (`backend/`)
- **Entry**: `server.js` - Express server with MongoDB connection
- **Models**: `models/bets.js` (bet records), `models/init.js` (meetings/races), `models/params.js` (horse parameters), `model/user.js` (authentication)
- **Routes**: `routes/auth.js` (login, password change), `routes/winner.js`
- **API Base**: All endpoints prefixed with `/api/` except `/auth/`

### Data Flow
1. **Init Tab**: Create meeting → define races → mark as selected
2. **Params Tab**: Configure horses per race (odds, special conditions)
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

## Authentication Flow

**Critical**: 2-minute inactivity auto-logout is enforced client-side in [auth.service.ts](../src/app/services/auth.service.ts):
- Activity tracked on mouse/keyboard/scroll events (throttled every 10s)
- `AUTH_TOKEN_TTL = 2 * 60 * 1000` (120 seconds)
- Token + `lastActivity` timestamp stored in localStorage
- Backend JWT tokens expire in 24h but client logs out at 2 minutes

**Setup** (see [AUTHENTICATION.md](../AUTHENTICATION.md)):
1. Create `backend/.env` with `MONGODB_URI`, `JWT_SECRET`, `PORT`
2. Run `cd backend && npm run create-user` to create Admin/admin123@
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
- Production: `environment.prod.ts` (configure as needed)
- Update `environment.apiUrl` if backend runs on different port

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
[recent-clients.service.ts](../src/app/services/recent-clients.service.ts) manages localStorage for client name autocomplete:
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
- Only one winner per race
- Affects all bets for that race

## Common Pitfalls

1. **Don't use `standalone: true`** - It's the default in Angular 21, setting it explicitly is redundant
2. **Backend runs on port 3000** - Frontend proxies are NOT configured, use full URL `http://localhost:3000`
3. **Auto-logout at 2 minutes** - Test quickly or increase `AUTH_TOKEN_TTL` during development
4. **Selected meeting pattern** - Always ensure only one meeting is selected (see backend pattern above)
5. **Mongoose connection** - Check `.env` file exists in `backend/` folder, not root
6. **Material imports** - Import specific modules, don't use `MatLegacyModule` or similar

## Testing Notes

- Test files: `*.spec.ts` (using Vitest framework)
- Tests may need updating for Angular 21 patterns (signals, inject())
- Backend has no tests currently (`"test": "echo \"Error: no test specified\" && exit 1"`)
