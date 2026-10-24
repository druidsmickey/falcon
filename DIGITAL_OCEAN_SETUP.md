# Server setup and troubleshooting (DigitalOcean droplet)

How the apps are laid out on the server, how to restart and check them, and how to fix the WhatsApp "Could not find Chrome" problem.

## Layout on the server

| | Phantom | Detori |
|---|---|---|
| Folder | `/root/Phantom/itb/2027` | `/root/Detori/itb/2027` |
| Backend config | `/root/Phantom/itb/2027/backend/.env` | `/root/Detori/itb/2027/backend/.env` |
| PM2 process | `phantom-backend-2027` | `detori-backend-2027` |
| Backend port | 3010 | 3011 |
| Web address | `/Phantom/2027/` | `/Detori/2027/` |
| API address | `/api-phantom-2027/` | `/api-detori-2027/` |

- **nginx** is configured in `/etc/nginx/sites-enabled/apps`. It serves `<folder>/dist/itb/browser/` for each web address and forwards each API address to the backend port. The older apps (Gambit, Cumbre) use the same file, with their own paths and ports 3000 and 3001. **Do not change or reuse those.**
- A deploy (push to `main`) copies the project into the folders above, runs `npm install` in `backend/` and restarts the PM2 process. It does **not** write `.env` and does not delete `backend/.wwebjs_auth/`.
- Node.js and PM2 are on the server's path through the normal login shell.

### Everyday commands

```bash
pm2 list                                  # all processes and their state
pm2 logs phantom-backend-2027 --lines 100 # recent log of one app
pm2 restart phantom-backend-2027          # after editing its .env
pm2 save                                  # remember the process list across reboots

curl http://localhost/api-phantom-2027/health   # should show "database":"Connected"
free -m ; df -h /                               # memory and disk
```

### Changing nginx safely

```bash
cp /etc/nginx/sites-enabled/apps /root/nginx-apps.bak-$(date +%Y%m%d)   # backup first
nano /etc/nginx/sites-enabled/apps
nginx -t && systemctl reload nginx        # reload only if the test says OK
```

If the test fails, copy the backup back over the file. A mistake in this file affects every app on the server.

### Checks after a deploy

- `http://<server>/Phantom/2027/` and `/Detori/2027/` load. Use the address **with a trailing slash**; without it nginx answers 404.
- Both health addresses answer `"database":"Connected"`.
- `pm2 list` shows all backends `online`, including the older ones.

## WhatsApp: "Could not find Chrome"

The WhatsApp tab drives a headless Chromium browser on the server. This error means the server cannot find one.

### Quick fix

```bash
sudo apt-get update && sudo apt-get install -y chromium-browser
pm2 restart phantom-backend-2027 detori-backend-2027
```

On Ubuntu 24.04 `chromium-browser` installs Chromium as a snap; the backend looks for it in `/usr/bin/chromium-browser`, `/usr/bin/chromium`, `/snap/bin/chromium` and the usual Chrome names. If none is found, Puppeteer tries its own downloaded copy:

```bash
cd /root/Phantom/itb/2027/backend
npx puppeteer browsers install chrome
pm2 restart phantom-backend-2027
```

### Check that it works

1. In the app open **WhatsApp**, then **Connection**.
2. Press **Test Server**. You should see `Server test passed! Browser: HeadlessChrome/...`.
3. Press **Initialize WhatsApp** (or **Reset & New QR**). The QR code appears in 10 to 20 seconds.

You can also test from the server:

```bash
cd /root/Phantom/itb/2027/backend
node -e "const p=require('puppeteer');(async()=>{const b=await p.launch({headless:true,args:['--no-sandbox']});console.log('Puppeteer works', await b.version());await b.close()})()"
```

### Missing libraries

If Chrome starts but fails with "Failed to launch the browser process", install the libraries it needs (Ubuntu/Debian):

```bash
sudo apt-get install -y ca-certificates fonts-liberation libasound2t64 libatk-bridge2.0-0 libatk1.0-0 \
  libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 \
  libnss3 libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 \
  libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 wget xdg-utils
```

(On older Ubuntu or Debian the package is called `libasound2` instead of `libasound2t64`.)

## Log messages to look for

In `pm2 logs <process>`:
- `Calling client.initialize()...` initialisation started
- `Loading screen: X% ...` WhatsApp Web is loading
- `QR Code received!` the QR code was produced
- `WhatsApp Client is ready!` connected
- `Client initialization error: ...` read the details that follow

## Common errors

| Error | Cause and fix |
|---|---|
| `Failed to launch the browser process` | Missing libraries, see above |
| `EACCES: permission denied` on `.wwebjs_auth` | Fix the owner: `sudo chown -R $USER:$USER <backend>/.wwebjs_auth` |
| Nothing after 3 minutes | The server is too slow or short of memory: `free -m`, `top` |
| 502 from `/api-...-2027/` | The backend is not running: `pm2 list`, `pm2 logs`, then `pm2 restart` |
| 500 from `/Phantom/2027/` | The `dist` folder is missing, the deploy did not finish; check the GitHub Actions run |
| 404 from `/Phantom/2027` | Missing trailing slash; use `/Phantom/2027/` |
| Page looks old after a deploy | The browser or the service worker has the old version: reload twice or clear the site data |

## Memory

Each WhatsApp session runs its own Chrome and needs roughly 300 to 500 MB on top of the Node processes. Everything on the server shares the memory (the older apps and any other site hosted there), so check `free -m` before connecting WhatsApp in a second app. A 1 GB droplet is too small for several apps with WhatsApp; 2 GB or more is comfortable.

## Firewall

Only ports 80 (web) and 22 (SSH) are needed. The backend ports (3010, 3011 and the older 3000, 3001) are used only through nginx on the same machine and should not be opened:

```bash
sudo ufw status
```

## Environment file

Each backend has its own `backend/.env` on the server (it is not in git and is not changed by deploys):

```
PORT=3010
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/phantom2027?retryWrites=true&w=majority
JWT_SECRET=a-long-random-string
```

Use a different port, database name and `JWT_SECRET` for each app. After editing: `pm2 restart <process>`. See [AUTHENTICATION.md](AUTHENTICATION.md) for creating the first user.

## Still not working?

1. Run the Puppeteer test above.
2. `node --version` should be 20 or newer (22 is used here).
3. Reinstall the backend's packages: `cd backend && rm -rf node_modules && npm install`, then restart.
4. When asking for help, include the last 100 lines of `pm2 logs`, the Puppeteer test output, and the server's memory and Ubuntu version.
