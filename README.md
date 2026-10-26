# Atlas Quest

A geography game that makes the world interesting for young players. Everything runs in the browser, with a world map built into each page. There is no server and nothing to install.

## What's here

| Path | What it is |
|---|---|
| `index.html` | **Telegram Mini App.** Find countries on the map and name them by their shape. 10 rounds, Easy and Hard modes. |
| `web/index.html` | **Full web game** with five expeditions: Countries, Capitals & big cities, Rivers/lakes/seas, Mountains & relief, and Border journey. |
| `tools/` | Script and templates that rebuild the embedded map data. |

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

Players open `t.me/<your_bot>/play`. The same link works in a normal browser, so it can be shared in WhatsApp too.

## Rebuilding the map data

The map comes from [Natural Earth](https://www.naturalearthdata.com/) via the `world-atlas` package (public domain).

```bash
cd tools
npm install
npm run build-map        # writes map.json
```

Then put the contents of `map.json` in place of `/*MAPDATA*/` in a template.
