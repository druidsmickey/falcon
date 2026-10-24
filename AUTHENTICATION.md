# Authentication

How users, login and sessions work, and how to create the first user.

## How it works

- Users are stored in the `users` collection of the app's own database (each app, Phantom and Detori, has its own users).
- Passwords are stored hashed (bcrypt). The login returns a **JWT** that the app sends with every request.
- Each user has an **app scope**: `phantom`, `detori` or `default`. The API refuses a token from one app on the other (HTTP 403). The scope is chosen from the web address (`/Phantom/...` or `/Detori/...`) or from the user's saved scope.
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

It reads `MONGODB_URI` from that folder's `.env` and creates (or resets) the user `Admin` with the password **`admin123@`**. This password is public (it is in the repository), so:

1. Log in straight away and change it in the **Password** tab (at least 6 characters).
2. Never leave it as it is on a server that is reachable from the internet.

To use another username or password, edit the two constants at the top of `backend/create-or-update-user.js` before running it. User names are stored in lower case.

Running the script again for an existing user **resets that user's password** to the one in the file.

## Environment (`backend/.env`)

```
PORT=3000
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/DATABASE_NAME?retryWrites=true&w=majority
JWT_SECRET=a-long-random-string
```

- Put a database name in `MONGODB_URI`. Without one MongoDB uses `test`.
- Use a different `JWT_SECRET` for every app. Anyone who knows it can create valid logins.
- If `JWT_SECRET` is missing, the backend silently falls back to a fixed built-in value. Always set it.
- On the server this file is created by hand once and is not touched by deployments.

## Troubleshooting

**"Invalid credentials"**
- Check the user exists in the right database (`create-user` uses the `.env` of the folder you run it in).
- The password may have been changed from the Password tab. Run `create-user` again to reset it.

**Logged out straight after logging in**
- The computer's clock may be wrong. The app compares the token's expiry with the local clock.

**"Token scope mismatch" (403)**
- A token from Phantom was used on Detori or the other way round. Log in again on the app you are using.

**Backend cannot connect to MongoDB**
- Check `MONGODB_URI` in `.env` and that the database server allows the server's IP address.
- `https://<server>/api-<app>-2027/health` should show `"database":"Connected"`.

## Recommendations (not done yet)

- **HTTPS.** The apps are served over plain HTTP, so passwords and tokens travel unencrypted. Put a domain and a free Let's Encrypt certificate in front of the server.
- **Limit login attempts.** Wrong passwords are not slowed down or blocked. Add rate limiting to `/auth/login` (for example the `express-rate-limit` package).
- **Restrict CORS.** The API answers requests from any website. Allow only the app's own addresses.
- **Require `JWT_SECRET`.** Make the server refuse to start without it instead of using the built-in fallback.
- **Make `create-user` take its password from an environment variable** so the public default is never used.
- **One user only.** There is no screen to add users or roles; every user can do everything, including deleting a meeting.
- **Meetings are deleted automatically.** At every login the server deletes meetings older than 6 days with all their bets. Age is taken from when the meeting's races were last saved in the Init tab (saving resets it), so a meeting that is not re-saved for 6 days is removed even if it is still in use. Export or print what must be kept.
- **Run `npm audit` in the backend.** It reports known vulnerabilities in several packages (including the WhatsApp library's dependencies).
