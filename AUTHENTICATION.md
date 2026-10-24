# Authentication

How users, login and sessions work, and how to create the first user.

## How it works

- Users are stored in the `users` collection of the app's own database (each app, Phantom and Detori, has its own users).
- Passwords are stored hashed (bcrypt). The login returns a **JWT** that the app sends with every request.
- Each user has an **app scope**: `phantom`, `detori` or `default`. The API refuses a token from one app on the other (HTTP 403). The scope is chosen from the web address (`/Phantom/...` or `/Detori/...`) or from the user's saved scope.
- Wrong passwords are limited: after 10 failed attempts for one user name from one address, or 100 from one address, login is refused for 15 minutes (a correct login is never counted). The address is the real client address that nginx passes on.
- Every API route needs a valid token, including the WhatsApp routes. Only the login and the two status pages (`/` and `/health`) are open.

## Session rules

| Rule | Value |
|---|---|
| Login lasts | **1 hour**, set by the server when the token is created (`backend/routes/auth.js`) |
| Logged out when the app is not used | **4 minutes** (`IDLE_LIMIT` in `src/app/services/auth.service.ts`) |
| Expired or invalid token | the app goes back to the login page |

"Not used" means no click, tap, key press or typing in the app. Moving the mouse or scrolling counts only while the window has focus. So all of these end the session after 4 minutes: sitting idle, a hidden tab, a minimised window, a window left on a second screen, the computer sleeping, or the browser being closed and reopened. The first click after such a break logs you out; it does not extend the session.

Things to know:
- Logging out clears the data the browser saved for offline use (cached races, params and bets). Bets queued in the offline outbox (IndexedDB) are kept and sent after the next login.
- Because the login lasts 1 hour, the app cannot be used offline for longer than about an hour after logging in.
- Watching races without touching the app for 4 minutes logs you out.

## Creating the first user

A new database has no users, so nobody can log in until one is created. Run this **on the server** (or on your computer for a local database), in the backend folder of the app:

```bash
cd /root/Phantom/itb/2027/backend        # or /root/Detori/itb/2027/backend, or backend/ locally
APP_SCOPE=phantom npm run create-user    # use APP_SCOPE=detori for Detori
```

It reads `MONGODB_URI` from that folder's `.env`, creates the user `Admin` with a **random 16-character password** and prints it once at the end. Write it down, log in, and change it in the **Password** tab (at least 6 characters).

Optional settings, given on the same command line:

| Variable | Meaning |
|---|---|
| `APP_SCOPE` | `phantom`, `detori` or `default` |
| `ADMIN_USERNAME` | user name (default `Admin`; stored in lower case) |
| `ADMIN_PASSWORD` | choose the password yourself instead of a random one (at least 6 characters) |

Running it again for an existing user **resets that user's password**.

## Environment (`backend/.env`)

```
PORT=3000
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/DATABASE_NAME?retryWrites=true&w=majority
JWT_SECRET=a-long-random-string
# optional: web addresses allowed to call the API from another address (comma separated)
# CORS_ORIGINS=http://localhost:4200
```

- Put a database name in `MONGODB_URI`. Without one MongoDB uses `test`.
- Use a different `JWT_SECRET` for every app. Anyone who knows it can create valid logins.
- **The server refuses to start without `JWT_SECRET`.** There is no built-in fallback.
- `CORS_ORIGINS` is not needed when the app and the API share one address (as in production behind nginx). It defaults to `http://localhost:4200` for the development server. Any other website is refused cross-site access.
- On the server this file is created by hand once and is not touched by deployments.

## Troubleshooting

**"Invalid credentials"**
- Check the user exists in the right database (`create-user` uses the `.env` of the folder you run it in).
- The password may have been changed from the Password tab. Run `create-user` again to reset it.

**"Too many failed login attempts" (HTTP 429)**
- Wait 15 minutes. Only wrong passwords are counted, and only for that user name from that address (and 100 from one address in total).

**Logged out straight after logging in**
- The computer's clock may be wrong. The app compares the token's expiry with the local clock.

**"Token scope mismatch" (403)**
- A token from Phantom was used on Detori or the other way round. Log in again on the app you are using.

**The server will not start: "JWT_SECRET is not set"**
- Add `JWT_SECRET=...` to that app's `backend/.env`, then `pm2 restart <process>`.

**Backend cannot connect to MongoDB**
- Check `MONGODB_URI` in `.env` and that the database server allows the server's IP address.
- `http://<server>/api-<app>-2027/health` should show `"database":"Connected"`.

## What is still open

- **HTTPS.** The apps are served over plain HTTP, so passwords and tokens travel unencrypted. Put a domain and a free Let's Encrypt certificate in front of the server. This is the most important remaining item.
- **One kind of user.** There is no screen to add users or roles; every user can do everything, including deleting a meeting.
- **Meetings are deleted automatically.** At every login the server deletes meetings older than 6 days, with all their bets. This applies to every meeting, selected or not. The age counts from when the meeting was first input (saving its races again does not restart it). Export or print what must be kept.
- **Known package warnings.** `npm audit` in `backend/` still reports 11 findings, all inside `whatsapp-web.js` and its Puppeteer dependency (the browser that drives WhatsApp Web). They cannot be reached from the web.

## Protections in place

- Login attempts are rate limited (see above).
- The API answers only the origins in `CORS_ORIGINS`, does not announce that it is Express, and refuses requests over 2 MB.
- The server will not start without a `JWT_SECRET`.
- The server checks every bet (the amounts must agree with the F500 or odds entered) and stores only known fields; single-horse updates accept only the fields they are meant to change.
- New users get a random password, never a published default.
- The backend listens only on `127.0.0.1`; the firewall allows only SSH, web and HTTPS, so the login limit cannot be bypassed by calling the backend directly with a made-up client address.
- The server allows SSH logins by key only, and bans addresses that keep guessing (see [DIGITAL_OCEAN_SETUP.md](DIGITAL_OCEAN_SETUP.md)).
