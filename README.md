# Atlas Quest

A geography game that makes the world interesting for young players. The games run in the browser, with a world map built into each page. Inside Telegram, the Mini App also signs the player in through the backend API, which saves their profile, game sessions and results. Without the API it still works and keeps scores on the device.

## What's here

| Path | What it is |
|---|---|
| `index.html` | **Telegram Mini App.** Find countries on the map and name them by their shape. 10 rounds, Easy and Hard modes. |
| `web/index.html` | **Full web game** with five expeditions: Countries, Capitals & big cities, Rivers/lakes/seas, Mountains & relief, and Border journey. |
| `tools/` | Script and templates that rebuild the embedded map data. |
| `backend/` | Node.js API (Express, `127.0.0.1:3020`) for Telegram login, player profiles, game sessions and results. It runs as a systemd service behind Nginx. See [backend/README.md](backend/README.md). The PostgreSQL schema is described in [backend/docs/database.md](backend/docs/database.md). The games still work without it. |

## Play it

Open either HTML file in a browser. To host it for free with **GitHub Pages**:

1. Go to **Settings → Pages**.
2. Set the source to **Deploy from a branch**, choose `main` and `/ (root)`, then save.
3. After about a minute the games are live at:
   - `https://<user>.github.io/<repo>/` (Telegram version)
   - `https://<user>.github.io/<repo>/web/` (full game)

## Put it on Telegram

1. In Telegram, message **@BotFather** and send `/newbot` to create a bot.
2. Send `/newapp`, choose your bot, set the short name `play`, and paste your GitHub Pages link.
3. In `index.html`, replace `YOUR_BOT_USERNAME` in `GAME_LINK` with your bot's username, then commit.
4. To save players' progress, host `index.html` on the same domain as the API (Nginx proxies `/api/`). Set `TELEGRAM_BOT_TOKEN`, `SESSION_SECRET` and `DATABASE_URL` in `backend/.env`. See [backend/README.md](backend/README.md#api). `API_BASE` in `index.html` sets where the app looks for the API.

Players open `t.me/<your_bot>/play`. The same link works in a normal browser, so it can be shared in WhatsApp too.

## Rebuilding the map data

The map comes from [Natural Earth](https://www.naturalearthdata.com/) via the `world-atlas` package (public domain).

```bash
cd tools
npm install
npm run build-map        # writes map.json
```

Then put the contents of `map.json` in place of `/*MAPDATA*/` in a template.
