# WhatsApp tab

Connects the app to your own WhatsApp account, and lets you choose whose messages are read as bets (they arrive in the **Inbox** tab, see below). It uses `whatsapp-web.js`, which drives a headless Chromium browser on the **server** and links to your phone as a "Linked device".

The tab has two parts:

| Part | What it does |
|---|---|
| **WhatsApp (connection)** | Connect or disconnect WhatsApp, show the QR code, reset the session, test that the server can start Chrome |
| **Contacts** | One button, **Sync contacts from the phone**, copies the contacts of the phone. For each contact you type a **nickname** and tick whether to **listen** to it |

Sending messages, groups of contacts and sending reports or photos are **no longer in the app**. The server routes for them are still there (see the API list) but nothing in the app uses them.

## Before you start

- **Each app has its own WhatsApp session.** Phantom and Detori run as separate server processes, so each needs its own QR scan and counts as its own "linked device". One WhatsApp account can have several linked devices, so both apps may use the same number, but each runs its own Chrome (memory). Never copy one app's `.wwebjs_auth` folder to the other.
- The server needs **Chromium** and enough memory. See [DIGITAL_OCEAN_SETUP.md](DIGITAL_OCEAN_SETUP.md).
- The session is saved on the server in `backend/.wwebjs_auth/` (next to `server.js`). **Never commit or share this folder: it is a logged-in copy of your WhatsApp.** It is in `.gitignore`. A deployment does not remove it.

## Connecting

1. Open the **WhatsApp** tab.
2. Press **Initialize WhatsApp** and wait (about 10 to 20 seconds) for the QR code.
3. On your phone: WhatsApp, Settings, **Linked devices**, **Link a device**, scan the QR code.
4. The status changes to **Connected**. After that the server reconnects by itself; you only scan again if you disconnect, press **Reset & New QR**, or WhatsApp ends the session.

Buttons:
- **Refresh Status:** check the state again.
- **Disconnect:** close the connection (the saved session stays).
- **Reset & New QR:** delete the saved session and show a new QR code. Use this if the connection is stuck or authentication fails.
- **Test Server:** checks that Chrome can start on the server and shows the version or the problem.

**It reconnects by itself.** The server restarts at every deploy and reboot. When a saved session exists, it connects again about 10 seconds after the start without anyone pressing Initialize, and it connects again 30 seconds after a lost connection, unless the phone logged the device out (then a new QR code is needed). Set `WHATSAPP_AUTOSTART=false` in `backend/.env` to switch this off (for example on a development computer that has a saved session).

The QR code image is drawn in your browser. The text that links a device to your WhatsApp is not sent to any outside website. The server also prints the QR code in its own log.

## Contacts: nickname and who to listen to

1. Press **Sync contacts from the phone** (WhatsApp must be connected). It copies every person in the phone's address book that has a name; groups and your own number are left out. Press it again whenever you add contacts on the phone. Contacts already saved keep their nickname and listen choice, and only their name follows the phone.
2. For each contact type a **nickname**. It is the client name the bets are entered under; without one the contact name is used.
3. Tick the contacts to **listen** to. Nobody is listened to until you tick them. Use the search box, and **Listened to only**, to find them in a long list.

Contacts are saved in the app's database. Changes save as soon as you leave the nickname box or tick a contact.

## API (all need a login token)

Connection: `GET /api/whatsapp/status`, `POST /initialize`, `POST /disconnect`, `POST /reset`, `GET /test-puppeteer`.

Contacts: `POST /sync-contacts` (copy the phone's contacts), `GET /contacts`, `POST /contacts`, `DELETE /contacts/:id`, `GET /whatsapp-contacts`, `POST /import-contacts`. Nickname and listen: `GET /api/whatsapp-inbox/contacts`, `PATCH /api/whatsapp-inbox/contacts/:id`.

Routes the app no longer uses: groups (`GET/POST /groups`, `PUT/DELETE /groups/:id`), sending (`POST /send-message`, `/send-bulk`, `/send-to-group`, `/send-image-to-group`, `/send-report`, `GET /messages/:groupId`, `POST /delete-messages`) and chat "keep unread" tracking (`POST /mark-keep-unread`, `/unmark-keep-unread`).

All paths start with `/api/whatsapp` unless written in full.

## Troubleshooting

**The QR code does not appear**
- Press **Test Server**. If it fails, Chromium is missing or cannot start; see [DIGITAL_OCEAN_SETUP.md](DIGITAL_OCEAN_SETUP.md).
- Wait up to 3 minutes; after that the server gives up and you can press **Initialize** again.

**Authentication failed or the connection is stuck**
- Press **Reset & New QR** and scan again.

**A message does not send**
- The status must be **Connected**.
- Check the number: country code, digits only, and it must be registered on WhatsApp.
- Look at the server log (`pm2 logs <process>`).

**"A group with that name already exists" for a name you have not used**
- Group names are compared ignoring capitals, as plain text. Check the list of groups for the same name.

**The session ended**
- WhatsApp can unlink a device (for example if the phone is offline for weeks). Scan the QR code again.

## Reading bets from messages (Inbox tab)

Messages reach the inbox two ways: WhatsApp announces them as they arrive, and, in case that fails, every minute the server also asks the chat of each listened contact for its latest messages (only those from the last 3 hours). A message seen both ways is read once, and bets sent while the connection was down are picked up when it is back. The **Messages received** card in the WhatsApp tab shows how many messages WhatsApp announced and how many times the chats were checked.

The server can read the bets your contacts send and list them in the **Inbox** tab for you to confirm. Nothing is entered until you press **Confirm**.

**Set up**
1. In the **WhatsApp** tab connect WhatsApp, press **Sync contacts from the phone**, give each contact a **nickname** and tick the ones to **listen** to (see above). Nobody is listened to until you tick them.
3. Send your **odds lists** (from the broadcast list) from the linked account. The latest one tells the app which race is running and how many horses it has.

**What a message can look like** (one bet per line)

| Message | Read as |
|---|---|
| `11 500x90`, `11 500 120`, `11 500@120`, `11 500 #120`, `11 500c120`, `11 500 on 120` | race 1 horse 1 (there is no horse 11), **500 books at F500 120**: the second figure is 120 or less |
| `11 5000x420`, `11 5000 420`, `11 5000@420`, `11 5000 on 420` | **stake 5000 at odds 420**: the second figure is 420 or more |
| `11 500 200` | the second figure is between 121 and 419: could be an F500 or odds, **you choose** and both figures are kept |
| `11 5k` | stake 5000, **odds missing**, you type them |
| `11 500`, `capt mag 500` | one figure: **books or a stake?** It is put in the first box and you choose F500 or Odds |
| `3 11 500 120` | four figures: race 3, horse 11, 500 books at 120 |
| `cap mag 500x120` | the horse by name: matched against the horses of the selected meeting (see below) |

What sits between the amount and the second figure does not matter (`x`, `@`, `#`, `c`, `z`, a space, `on`, `lor`...): **the size of the second figure decides** (up to 120 an F500, from 420 odds, in between you choose). Prices of 121 to 419 can be either an F500 or odds because the two ranges overlap, which is why they are left to you.

**Only races and horses that exist (when Params are saved).** With no Params for the selected meeting nothing is checked: a number is taken as written (the odds list, when there is one, still says how many runners its race has), and a number that could mean two things, like `41` (horse 41, or race 4 horse 1), is marked unsure for you to decide. The races and horses of the selected meeting (from the Params page) are used to read the first number. `13` is race 1 horse 3 when the meeting has 8 races and no race has 13 horses; a race or a horse that does not exist is never proposed, and when nothing fits the horse is left empty with a note listing the races of the meeting. A race written in the message (`r13 2 5k`) must exist too, with that horse, or the line is marked unsure.

**Ignored on purpose.** A message that is mostly numbers (three or more lines of which half are only a number, such as a pasted column of odds), a message in the format of an odds list, a line that is only a number, and a line with more than four figures are not read as bets and do not reach the inbox.

**Horse names.** Instead of a number a contact can write the name, or part of it: `Captain Magpie`, `cap magpie`, `magp`, `cap mag`, `capmag`, `mag` all find Captain Magpie (capitals, spaces and punctuation do not matter; at least 3 letters). Every horse is scored for how well the typed letters fit its name and the best fit wins: the whole name, the start of its words (`cap mag`, `magp`), the same typed together (`capmag`), letters left out (`cptn mgp`), or small slips (`captin magpy`). The first three are taken as sure; the last two are a **best guess** and are marked unsure so you check them. Ordinary words (`thanks`, `market`) do not match. If more than one horse fits, the horses of the race that is running (from the latest odds list) are tried first; if several still fit, the first is chosen and the line is marked unsure with the others listed. If the name also fits a horse of another race (for example `magp` fits Captain Magpie in race 1 and Magpie Queen in race 2), the line is **marked unsure** and names both, because the odds list only suggests the race. Writing the race in the message (`r1 magp 500x90`) removes the doubt. A name found only in another race is marked unsure, a slightly misspelt name (one wrong letter) is matched as a last resort and marked unsure, and a name that is not found is left for you to fill in. Start a line with `r2` to search only race 2 (`r2 mag 500x90`). The horse list is the one saved in the Params page of the selected meeting.

Odds lists are read in two styles: `r1` followed by lines of `horse odds`, or a race number followed by one line of odds per horse (horse 1, 2, 3...). When the number sent is more than the horses in the list, the first digit is the race: with 5 horses `11` is race 1 horse 1, with 12 horses it is horse 11 and the line is marked unsure. For a stake, the **List** button next to the odds box offers the price from the latest odds list.

**In the inbox** each message is shown as it was written, and under it the **same betslip as the Entry page**, filled in from what was read: race and horse buttons, the horse name, Sales/Pur, F500/Odds, books or stakes, the F500 or odds, name and tax. Change anything the same way as on the Entry page. What is missing is outlined in red and listed under the Save button; a bare number (`1 500`) leaves F500/Odds unchosen until you choose. The same limits as the Entry page apply, and horses that are withdrawn (or in a race that has a winner) cannot be chosen.

**New bets keep arriving** while you work: the server stores every message from the contacts you listen to, whether or not the tab is open, and the open Inbox picks up new ones every 10 seconds without disturbing the bets you are editing (new ones are added at the end). The **Inbox tab shows a red counter** with the number of bets waiting for approval (checked every 20 seconds), and the same number is shown at the top of the inbox. On a **phone only one bet is shown at a time**, with Previous / Next and a position ("2 of 5"); on a wide screen all are listed. A single number without a mark (`11 5000`) is already put in the first box (marked "Books / Stakes"); you choose F500 or Odds and it becomes books or a stake.

**Save Bet** sends it through the normal bet entry, with the time the message was sent, so it is checked and saved like any other bet (and queued if the server cannot be reached). As soon as it is saved the card disappears and the saved bet is shown at the top, like the last bet on the Entry page (marked "queued" if it is waiting to be sent). It can never be entered twice. **Dismiss** throws a bet away. Lines that could not be read are kept so nothing is lost; fill them in or dismiss them.

**Limits**
- Messages are stored on the server for 7 days, then deleted. Only the lines with numbers in them are kept.
- Odds lists are recognised only when sent from the linked account itself. Whether broadcast lists are visible to the linked session depends on WhatsApp, so check the first one after setting this up (the green line at the top of the Inbox shows the race it found).
- Contacts using the newer hidden-number WhatsApp ids may not match the saved number.
- Free text is read **loosely**: in a line like "put 500 on the grey one" the 500 is taken as the amount (books or a stake, you choose; a second figure is read as usual), filler words (put, on, the, one...) are dropped and the rest ("grey") is tried as the horse name. The card is marked unsure. Only lines with three or four figures among words stay "unreadable", and lines with more than four figures are ignored. Understanding real sentences properly needs the AI step, which is not built yet.

## AI second opinion (optional)

**Claude (paid):** choose Service = Claude, paste an API key from console.anthropic.com (the API is billed per use, separately from a Claude subscription), and the model is claude-sonnet-5-5 (backup claude-haiku-5-5). Tick "The AI reads every line with a figure" so that every line goes to the AI, not only the unclear ones; the AI says which line each bet comes from, a line it finds no bet in keeps the rules reading (unless the rules could not read it), and everything it reads is still shown as unsure for you to confirm. With Claude the limits are 30 calls a minute and 500 a day, so a runaway cannot cost much; set a monthly spending limit in the Anthropic console as well.

The AI does not learn by itself, but the app keeps your corrections: when you change the race, horse or figures of a card before saving it, the line and your figures are kept (without any name or number), and the few that look most like the line being read are shown to the AI as examples. The card shows how many are kept, with a "Forget them" button. They are removed after 6 months.

If the free service answers "503 ... high demand" (or 429/500), that is the provider being busy for a moment, not a problem with your key: the program waits a second and asks again (twice), then tries the **Backup model** of the card (Gemini: gemini-flash-lite-latest, Groq: llama-3.1-8b-instant). A wrong key (401/403) is not retried. If everything stays busy, the message is read by the rules alone, as before.

Messages the rules cannot read with confidence ("put 500 on the grey one", a misspelt horse, a line in an odd order) can be given to an AI for a second opinion. It is off until you add a key.

**How it works**
- The rules read every message first. Only the lines they were not sure about (unreadable, read loosely, horse not found, a guess at a name) go to the AI, together with the races and horses of the selected meeting and the race that is running. The player's name and number are not sent.
- The AI only says **what the player wrote**: race, horse (or horse name), amount and the figure after it. The program then applies its own rules to the figures (up to 120 an F500, from 420 odds, in between you choose), and a race or horse that is not in the meeting is thrown away.
- Every bet read this way is marked **AI**, shown as unsure and left for you to confirm. Nothing is ever saved without you.
- If the AI finds no bet in a line the rules could not read at all, the line is dropped as chat. If the AI is off, has no key, is over its limit or fails, the rules' reading stays as it was.
- A message already in the inbox is never sent to the AI twice (for example after a restart).

**Set up (WhatsApp tab, "AI reader")**
1. Get a free key: **Google Gemini** at aistudio.google.com/apikey, or **Groq** at console.groq.com/keys.
2. Choose the service, check the model name (the free models change over time, so change it if the service says it no longer exists), paste the key and press **Save**.
3. Press **Test the AI** with a line such as `put 5k on the grey at 650` to see what it read, then switch it **On**.

Another service that speaks the common "chat completions" format (OpenRouter, Mistral, a local Ollama...) can be used with **Other**, giving its address (https://..., or http://localhost for your own server) and model.

**Limits and privacy**
- At most **10 calls a minute and 300 a day**, and only for unclear lines, so a free plan is enough and nothing can be charged.
- **The text of the unclear messages is sent to the AI service.** Free plans may use what is sent to improve their models. Do not use it if client messages must not leave your server.
- The key is kept in the app's database on the server and is never sent back to the browser. It can also be set on the server with `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` and `AI_ENABLED=true` in `backend/.env`.
- An AI can be wrong: that is why the bet is always marked and waits for you.

## Security notes

- Only logged-in users can reach the WhatsApp routes, and they can send as you to anyone in the contact list. Keep the login safe.
- Messages appear to come from your own WhatsApp account.
- Using an unofficial library such as `whatsapp-web.js` is against WhatsApp's terms and the account can be restricted. Send to people who expect your messages and avoid large unsolicited bulk sends.
- `.wwebjs_auth/` holds the live session: keep it out of git, backups you share, and screenshots.
