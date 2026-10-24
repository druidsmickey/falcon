# WhatsApp tab

Send messages, reports and photos to clients from the app, through your own WhatsApp account. It uses `whatsapp-web.js`, which drives a headless Chromium browser on the **server** and links to your phone as a "Linked device".

The tab has four parts:

| Part | What it does |
|---|---|
| **Connection** | Connect or disconnect WhatsApp, show the QR code, reset the session, test that the server can start Chrome |
| **Contacts** | Add contacts by hand or import them from your WhatsApp, delete contacts |
| **Groups** | Create, edit and delete groups of contacts (a group is only a sending list kept in the app) |
| **Send Message** | Send text to one contact, several contacts or a whole group; send a photo to a group; see and delete what was sent |

## Before you start

- **Each app has its own WhatsApp session.** Phantom and Detori run as separate server processes, so each needs its own QR scan and counts as its own "linked device". One WhatsApp account can have several linked devices, so both apps may use the same number, but they will then send from the same account and each runs its own Chrome (memory). Never copy one app's `.wwebjs_auth` folder to the other.
- The server needs **Chromium** and enough memory. See [DIGITAL_OCEAN_SETUP.md](DIGITAL_OCEAN_SETUP.md).
- The session is saved on the server in `backend/.wwebjs_auth/` (next to `server.js`). **Never commit or share this folder: it is a logged-in copy of your WhatsApp.** It is in `.gitignore`. A deployment does not remove it.

## Connecting

1. Open the **WhatsApp** tab, then **Connection**.
2. Press **Initialize WhatsApp** and wait (about 10 to 20 seconds) for the QR code.
3. On your phone: WhatsApp, Settings, **Linked devices**, **Link a device**, scan the QR code.
4. The status changes to **Connected**. After that the server reconnects by itself; you only scan again if you disconnect, press **Reset & New QR**, or WhatsApp ends the session.

Buttons on Connection:
- **Refresh Status:** check the state again.
- **Disconnect:** close the connection (the saved session stays).
- **Reset & New QR:** delete the saved session and show a new QR code. Use this if the connection is stuck or authentication fails.
- **Test Server:** checks that Chrome can start on the server and shows the version or the problem.

The QR code image is drawn in your browser. The text that links a device to your WhatsApp is not sent to any outside website. The server also prints the QR code in its own log.

## Contacts

- **Add by hand:** name and number with the country code and no `+`, spaces or dashes (for example `61412345678`). The app adds `@c.us` itself.
- **Import from WhatsApp:** fetches the contacts of the linked phone, you tick the ones to import. Contacts already in the list are skipped.
- Contacts are saved in the app's database. Deleting a contact also removes it from every group.

## Sending

- **To contacts:** tick one or more contacts, write the message, send. Several contacts are sent in batches of 7 with a 1 second pause, to stay within WhatsApp's limits.
- **To a group:** choose the group (it is remembered for next time), write the message and send. Each send is saved in the history below.
- **Photo to a group:** press the camera button, take or pick a photo. It is shrunk (longest side 1920 px, JPEG) before sending. The text box, if filled, becomes the caption.
- **History:** messages sent to the selected group are listed. You can copy one back into the text box, or **delete** one: this removes it **for everyone** in each contact's chat (WhatsApp only allows this for a limited time after sending).
- Formatting: `*bold*`, `_italic_`, `~strikethrough~`.
- If a chat had unread messages, the app marks it unread again after sending, so you do not lose track of it.

There are no message templates in the app.

## API (all need a login token)

Connection: `GET /api/whatsapp/status`, `POST /initialize`, `POST /disconnect`, `POST /reset`, `GET /test-puppeteer`.

Contacts: `GET /contacts`, `POST /contacts`, `DELETE /contacts/:id`, `GET /whatsapp-contacts`, `POST /import-contacts`.

Groups: `GET /groups`, `POST /groups`, `PUT /groups/:id`, `DELETE /groups/:id`.

Sending: `POST /send-message`, `POST /send-bulk`, `POST /send-to-group`, `POST /send-image-to-group`, `POST /send-report`, `GET /messages/:groupId`, `POST /delete-messages`.

Chat "keep unread" tracking: `POST /mark-keep-unread`, `POST /unmark-keep-unread`.

All paths start with `/api/whatsapp`.

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

The server can read the bets your contacts send and list them in the **Inbox** tab for you to confirm. Nothing is entered until you press **Confirm**.

**Set up**
1. Import your contacts in the WhatsApp tab as usual.
2. In the Inbox tab open **Who I listen to**, tick the contacts to listen to and give each a **nickname**. The nickname is the client name the bets are entered under; without one the contact name is used. Nobody is listened to until you tick them.
3. Send your **odds lists** (from the broadcast list) from the linked account. The latest one tells the app which race is running and how many horses it has.

**What a message can look like** (one bet per line)

| Message | Read as |
|---|---|
| `11 500x90` | race 1 horse 1 (there is no horse 11), 500 books at F500 90 |
| `11 5000@2000` | stake 5000 at odds 2000 |
| `11 5000`, `11 5k` | stake 5000, **odds missing**, you type them |
| `1 500` | **books or stake?**: you choose, then type the F500 or the odds |
| `3 11 500x90` | race 3, horse 11 |
| `cap mag 500x90` | the horse by name: matched against the horses of the selected meeting (see below) |

**Horse names.** Instead of a number a contact can write the name, or part of it: `Captain Magpie`, `cap magpie`, `magp`, `cap mag`, `capmag`, `mag` all find Captain Magpie (capitals, spaces and punctuation do not matter; at least 3 letters). Every horse is scored for how well the typed letters fit its name and the best fit wins: the whole name, the start of its words (`cap mag`, `magp`), the same typed together (`capmag`), letters left out (`cptn mgp`), or small slips (`captin magpy`). The first three are taken as sure; the last two are a **best guess** and are marked unsure so you check them. Ordinary words (`thanks`, `market`) do not match. If more than one horse fits, the horses of the race that is running (from the latest odds list) are tried first; if several still fit, the first is chosen and the line is marked unsure with the others listed. If the name also fits a horse of another race (for example `magp` fits Captain Magpie in race 1 and Magpie Queen in race 2), the line is **marked unsure** and names both, because the odds list only suggests the race. Writing the race in the message (`r1 magp 500x90`) removes the doubt. A name found only in another race is marked unsure, a slightly misspelt name (one wrong letter) is matched as a last resort and marked unsure, and a name that is not found is left for you to fill in. Start a line with `r2` to search only race 2 (`r2 mag 500x90`). The horse list is the one saved in the Params page of the selected meeting.

Odds lists are read in two styles: `r1` followed by lines of `horse odds`, or a race number followed by one line of odds per horse (horse 1, 2, 3...). When the number sent is more than the horses in the list, the first digit is the race: with 5 horses `11` is race 1 horse 1, with 12 horses it is horse 11 and the line is marked unsure. For a stake, the **List** button next to the odds box offers the price from the latest odds list.

**In the inbox** each bet shows the message as it was written, what was understood, and what is missing (red boxes, and a Needs line). Confirm sends it through the normal bet entry, using the time the message was sent, so it is checked and saved like any other bet (and queued if the server cannot be reached). It can never be entered twice. Dismiss throws it away. Lines that could not be read are kept so nothing is lost; fill them in or dismiss them.

**Limits**
- Messages are stored on the server for 7 days, then deleted. Only the lines with numbers in them are kept.
- Odds lists are recognised only when sent from the linked account itself. Whether broadcast lists are visible to the linked session depends on WhatsApp, so check the first one after setting this up (the green line at the top of the Inbox shows the race it found).
- Contacts using the newer hidden-number WhatsApp ids may not match the saved number.
- Reading free text ("put 500 on the grey") needs the AI step, which is not built yet; those lines appear as unreadable.

## Security notes

- Only logged-in users can reach the WhatsApp routes, and they can send as you to anyone in the contact list. Keep the login safe.
- Messages appear to come from your own WhatsApp account.
- Using an unofficial library such as `whatsapp-web.js` is against WhatsApp's terms and the account can be restricted. Send to people who expect your messages and avoid large unsolicited bulk sends.
- `.wwebjs_auth/` holds the live session: keep it out of git, backups you share, and screenshots.
