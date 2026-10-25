# Data on the device: encryption, duress code, erase

What the browser keeps on a phone or computer that uses the app, how it is protected, and how to wipe it in a hurry.

## What is protected

Everything the app saves in the browser is encrypted: the copy of the races, params and bets, the answers kept for offline use, the user name of the login, and the contents of every bet or change waiting in the offline queue. Someone who takes the device and looks inside the browser's storage (developer tools, files on disk) sees only random-looking text under meaningless names.

Left readable on purpose: the name of the app copy (`appContext`: phantom or detori), the **number** of items waiting in the offline queue and their type and status (needed to show the sync state), and the app files themselves (public code).

## How it works

- The **password you log in with is also the key of the vault.** It is stretched with scrypt (slow on purpose, so guessing is expensive) into a key that opens a random data key; the data is encrypted with that (XChaCha20-Poly1305). Changing the password in the Password tab re-locks the vault with the new password and keeps the data.
- The login token and the data key are kept **in memory only**. Logging out, the 4-minute idle logout, the 1-hour limit, **reloading the page** and closing the tab all forget them. The next visit starts at the login page and the saved data opens only after you type the password.
- **Logging out no longer deletes** the saved data: it stays on the device, encrypted, so a bet queued offline survives a logout and a reload.
- **Working without the server:** if the server cannot be reached, the password still opens the saved data on this device (a banner says you are working from it). Bets and changes made then wait in the queue and are sent after you log in again with the server reachable. Only the user who was last logged in on the device can open it.
- Another user logging in on the same device does not see the saved data of the previous one.
- The password was changed on another device: the first login here asks for the previous password so the unsent bets can be kept, or lets you give them up.
- The service worker no longer saves API answers (they would sit unencrypted in the browser's cache); only the public app files.

## Duress code

In the **Password** tab, under "This device", set a duress code (at least 6 characters, different from the password).

Typing the duress code **in the password field of the login page** (with any user name) does not log in. It immediately:

1. destroys the vault key, so whatever was left of the encrypted data can no longer be opened;
2. deletes everything stored by the app: browser storage, the offline queue, cached data, the service worker;
3. opens a **pinball game** (`/arcade`) that looks like an ordinary game and says nothing about the app.

 The game has four tables (**Dino Rampage**, **Turbo Garage** with cars and motorbikes, **Jungle Grove** with plants and trees, **Deep Blue** with fish, sharks and whales). The whole screen is the control: touch the **left or right half** for that flipper, **hold a finger anywhere** while the ball waits and let go to launch, **swipe up** to nudge the table (4 per ball). On a keyboard: Z and / for the flippers, Space to launch, N to nudge, P to pause. What keeps you playing: a multiplier from hits in quick succession and from four **lanes** at the top (the flipper buttons shift the lit lanes), four targets that start a **multiball**, two **mystery saucers** (double score, ball saver, extra ball or multiball), rotating **missions** on each table, a meter that grows, a short ball save, an extra ball every 10,000 points, **1 to 3 stars** for each game, **experience and levels** that unlock six **ball styles**, a **daily streak** bonus, a "so close!" line at the end and a tap to play again. The best score, stars, experience, ball style and streak are saved in the browser under the neutral name `arcade-v1` (plain, nothing secret). A wipe or "Erase this device" removes them too, so after a wipe the game starts with empty scores.

Only a one-way check of the code is kept (under the neutral name `itb-ui`); it survives the wipe so the code keeps working. The code itself is never stored. Typing it makes no request to the server.

What this does **not** do:
- Bets that were still waiting in the offline queue are lost.
- Nothing on the server is touched. Logging in again with the real password downloads everything again.
- It cannot protect against someone who already copied the browser's files and the password, and a short or common password can be guessed offline. Use a long password.
- Until HTTPS is set up the traffic between the browser and the server is not encrypted (see below).

## The Pinball tab

The same game is also a tab in the app (after Password), and **it is the tab that opens after logging in**, instead of Entry. Anyone looking over your shoulder at login sees a pinball game; press Entry (or any tab) to work. The scores are the same ones the duress code's game uses. Leaving the tab closes the game, and the page gets its name back.

## Erase this device

The same tab has **Erase this device**: it does the same wipe but goes back to the login page. Use it before giving the device away. It warns first if bets are still waiting to be sent.

## Still to do

- **HTTPS.** The apps are still served over plain HTTP. Once a domain is bought: point it at the server, get a Let's Encrypt certificate (certbot with nginx), redirect HTTP to HTTPS and update `API_URL` in the deploy workflow. HTTPS also lets the service worker and "Install app" work on the live site.

## Where it lives in the code

- `src/app/security/vault-crypto.ts`: the cryptography (tested in `vault-crypto.spec.ts`).
- `src/app/security/vault.service.ts`: the encrypted storage used by everything else (never call `localStorage` directly for data).
- `src/app/security/duress.service.ts`, `device-wipe.service.ts`: the duress check and the wipe.
- `src/app/services/auth.service.ts`: in-memory token, sign-in (online, offline, duress), session rules.
- `src/app/services/offline-store.service.ts`: the queue, with sealed payloads.
- `src/app/arcade/`: the game (`pinball-engine.ts` has the rules and tests).
