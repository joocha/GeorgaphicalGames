# Geography Game API

The Express backend for Atlas Quest. It listens **only on `127.0.0.1:3020`**, and Nginx is the public entry point for `/api/`. In production it runs as a native **systemd** service and writes its logs to the systemd journal. It doesn't use any third-party process manager.

## Architecture

```
Browser / Telegram ──HTTPS──▶ Nginx ──┬── /          static frontend (unchanged)
                                      └── /api/  ──▶ 127.0.0.1:3020  Node.js (systemd)
                                                         │
                                                         └──▶ PostgreSQL (local)
```

| Path | Purpose |
|---|---|
| `src/server.js` | Entry point: starts the HTTP server and shuts down cleanly on SIGINT/SIGTERM |
| `src/app.js` | Express app; all routes are mounted under `/api` |
| `src/config.js` | Reads `HOST`/`PORT` and refuses to start on a non-loopback host |
| `.env.example` | Environment template |
| `deployment/geography-game-api.service.example` | Example systemd unit (not installed automatically) |
| `prisma/` | PostgreSQL schema, migrations and constraint checks (Prisma 7) |
| `docs/database.md` | Database design: ER diagram, tables, relationships, indexes, constraints |

Health check: `GET /api/health` returns `{"status":"ok","uptime":<seconds>}`.

## Development

Requires Node.js 20.6 or later.

```bash
cd backend
cp .env.example .env     # set NODE_ENV=development if you like
npm install
npm run dev              # restarts on file changes
curl http://127.0.0.1:3020/api/health
```

## Database

The PostgreSQL schema is defined with Prisma in `prisma/schema.prisma`. Read [docs/database.md](docs/database.md) before changing it. The API doesn't connect to the database yet.

```bash
npm run db:validate          # check the schema
npm run db:status            # pending migrations on DATABASE_URL
npm run db:migrate:deploy    # apply them (never resets data)
```

**Migrations are never applied automatically**, and `deploy.yml` doesn't run them. On production an administrator runs `npm run db:migrate:deploy` manually, after taking a backup.

## Production: systemd

These steps are for a server administrator. **Nothing here runs automatically.** Paths assume the repository is checked out at `/home/projects/geographical-games`.

### 1. Create a dedicated service user

The `geogame` user doesn't exist by default. Create it as a system account with no login shell, no home directory, and no sudo or admin groups:

```bash
sudo useradd --system --user-group --no-create-home \
  --home-dir /nonexistent --shell /usr/sbin/nologin geogame

id geogame               # verify
```

Don't add `geogame` to `sudo`, `wheel`, `adm`, `docker`, or any other privileged group.

### 2. Make sure Node.js is at a path the service user can reach

```bash
which node
node --version
```

The unit file uses `/usr/bin/node`. If `which node` prints something else, edit `ExecStart=` to match. **If it prints a path inside a user's home directory (for example `~/.nvm/...`), `geogame` usually can't read it.** In that case, install a system-wide Node.js (for example from your distribution or NodeSource) so that it lives under `/usr/bin` or `/usr/local/bin`.

Check that the service user can run it:

```bash
sudo -u geogame /usr/bin/node --version
```

### 3. Install dependencies and create `.env`

Run as the user who owns the checkout (the deploy user):

```bash
cd /home/projects/geographical-games/backend
npm ci --omit=dev        # or `npm install --omit=dev` if there is no package-lock.json
cp .env.example .env
nano .env                # keep HOST=127.0.0.1 and PORT=3020
```

### 4. File ownership and permissions

The deploy user keeps ownership of the code, so `git pull` and deployments still work. The `geogame` group gets **read-only** access. The service never needs write access to its own code.

```bash
DEPLOY_USER=<deploy-user>    # the account that owns the checkout
APP=/home/projects/geographical-games/backend

# Application files: owner rw, group (geogame) read and traverse, others nothing
sudo chown -R "$DEPLOY_USER":geogame "$APP"
sudo chmod -R u=rwX,g=rX,o= "$APP"

# Secrets: owner rw, group read, others nothing
sudo chmod 640 "$APP/.env"

# New files from future deployments (git reset, npm ci) inherit the geogame group
sudo find "$APP" -type d -exec chmod g+s {} +
```

The automated deploy (`deploy.yml`) runs `sudo systemctl restart geography-game-api` as the deploy user. That user needs passwordless sudo for that command, for example through `/etc/sudoers.d/geography-game-api` (edit it with `sudo visudo -f`):

```
<deploy-user> ALL=(root) NOPASSWD: /usr/bin/systemctl restart geography-game-api, /usr/bin/systemctl status geography-game-api *, /usr/bin/systemctl is-active --quiet geography-game-api, /usr/bin/journalctl -u geography-game-api *
```

`geogame` also needs execute (traverse) permission on every parent directory:

```bash
namei -l "$APP/src/server.js"                     # look for missing x bits
sudo -u geogame test -r "$APP/.env" && echo ".env readable"
sudo -u geogame test -r "$APP/src/server.js" && echo "code readable"
```

If a parent such as `/home/projects` blocks access, grant only traverse: `sudo chmod o+x /home/projects` (or use `setfacl -m u:geogame:x /home/projects`).

### 5. Install and start the service

```bash
sudo cp /home/projects/geographical-games/backend/deployment/geography-game-api.service.example \
        /etc/systemd/system/geography-game-api.service
sudo nano /etc/systemd/system/geography-game-api.service   # fix ExecStart node path if needed
sudo systemd-analyze verify /etc/systemd/system/geography-game-api.service

sudo systemctl daemon-reload
sudo systemctl enable geography-game-api
sudo systemctl start geography-game-api
sudo systemctl status geography-game-api

curl http://127.0.0.1:3020/api/health
ss -ltnp | grep 3020     # must show 127.0.0.1:3020, never 0.0.0.0 or *
```

### Service management and logs

```bash
sudo systemctl daemon-reload                 # after editing the unit file
sudo systemctl enable geography-game-api     # start on boot
sudo systemctl start geography-game-api
sudo systemctl status geography-game-api
sudo systemctl restart geography-game-api    # after deploying new code or editing .env
sudo systemctl stop geography-game-api
sudo journalctl -u geography-game-api -f     # follow logs
```

The app writes its logs to stdout and stderr, and systemd captures them in the journal. It doesn't create any log files. On stop, systemd sends `SIGINT` and waits up to 30 seconds. The server closes connections and exits within 25 seconds.

### Firewall

Port 3020 is bound to loopback, so it can't be reached from outside. Don't open it in `ufw` or any other firewall.

## Nginx (future, manual)

**Nothing changes Nginx automatically.** When the API is ready to go public, an administrator adds this block to the existing server block. Leave the existing static frontend `location` blocks as they are.

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3020;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`proxy_pass` has no trailing URI, so Nginx forwards the full `/api/...` path. That matches the app's route prefix. Test the config with `sudo nginx -t` before reloading. On this server, Nginx is GitLab's bundled one, which is managed through `gitlab-ctl`.
