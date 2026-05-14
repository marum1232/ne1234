# AJKMart — Setup Guide

**Single source of truth for all environments.**

---

## Replit (Recommended)

### Fresh GitHub Import → Replit

1. **Import:** New Repl → Import from GitHub → paste repo URL
2. **Secrets:** Open the padlock icon (Secrets panel) → add `DATABASE_URL`
3. **Run:** Press ▶ — all 4 services start automatically

That's it. Everything else is pre-configured in `.replit`.

### Why it works automatically on every import

| What | Where it's configured | Effect |
|---|---|---|
| All 4 workflows | `.replit → [[workflows.workflow]]` | Start automatically on ▶ |
| Self-install on first boot | Each `package.json` dev script checks for `node_modules/.pnpm` | `pnpm install` runs if missing |
| Vite binary (permanent fix) | `artifacts/admin`, `artifacts/vendor-app`, `artifacts/rider-app` `package.json` | Uses `../../node_modules/.bin/vite` directly — no `pnpm exec` race condition |
| tsx binary (version-agnostic) | `artifacts/api-server/scripts/start-with-restart.mjs` | Dynamically finds tsx in pnpm store — no hardcoded version |
| Dev JWT secrets | `.replit → [userenv.development]` | All JWT keys pre-set — no Secrets panel needed for auth in dev |
| Post-merge auto-setup | `.replit → [postMerge] → scripts/post-merge.sh` | Runs after every task-agent merge — verifies binaries + env |

### Ports

| Service | URL | Local Port |
|---|---|---|
| API Server | `https://<repl>.replit.dev` (port 80) | 5000 |
| Admin Panel | `https://<repl>.replit.dev:3000/admin/` | 3000 |
| Vendor App | `https://<repl>.replit.dev:3001/vendor/` | 3001 |
| Rider App | `https://<repl>.replit.dev:3002/rider/` | 3002 |

### Required Secrets (add in Replit Secrets panel before pressing Run)

| Secret | Required | Description |
|---|---|---|
| `DATABASE_URL` | **YES — must add** | PostgreSQL connection string |
| `GEMINI_API_KEY` | optional | AI moderation & content features |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` | optional | SMS OTP |
| `SENDGRID_API_KEY` | optional | Email delivery |
| `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` | optional | Push notifications |
| `GOOGLE_MAPS_API_KEY` | optional | Maps |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_CONTACT_EMAIL` | optional | Web push notifications |
| `REDIS_URL` | optional | JWT blacklisting on logout + rate limiting |
| `STORAGE_BUCKET_URL` + `STORAGE_ACCESS_KEY` + `STORAGE_SECRET_KEY` | optional (required in production) | S3-compatible file uploads |

> **All JWT signing keys are pre-set** in `.replit` `[userenv.development]` as strong dev placeholders.  
> Replace them with fresh random values before any production deployment.  
> Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

### Default Admin Login

```
Username: superadmin
Password: Admin@123
```

Change the password immediately via the security prompt shown after first login.

---

## GitHub Codespaces

Open the repo on GitHub → click **Code → Codespaces → Create codespace**.

`.devcontainer/devcontainer.json` handles:
- Node.js 20 + pnpm 10 installation
- `bash scripts/setup.sh` (installs all workspace deps)
- Port forwarding: 5000, 3000, 3001, 3002, 20716

Set secrets in **Codespaces → Manage secrets** before creating the codespace, then start manually:

```bash
pnpm --filter @workspace/api-server run dev    # API server (port 5000)
pnpm --filter @workspace/admin run dev         # Admin panel (port 3000)
pnpm --filter @workspace/vendor-app run dev    # Vendor app (port 3001)
pnpm --filter @workspace/rider-app run dev     # Rider app (port 3002)
```

---

## Ubuntu / Debian VPS

```bash
git clone https://github.com/your-org/ajkmart.git
cd ajkmart
bash scripts/setup.sh     # installs Node 20, pnpm, all deps

cp .env.example .env
nano .env                 # fill DATABASE_URL + all JWT secrets

pnpm build
NODE_ENV=production pnpm start
```

Use `pm2` with the included `ecosystem.config.cjs` for process management:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

---

## Local Development (Mac / Linux)

```bash
git clone https://github.com/your-org/ajkmart.git
cd ajkmart
bash scripts/setup.sh

export DATABASE_URL="postgresql://user:pass@localhost/ajkmart"
pnpm --filter @workspace/api-server run dev
```

---

## Monorepo Structure

```
ajkmart/
├── artifacts/
│   ├── api-server/     # Node.js/Express backend (port 5000)
│   ├── admin/          # React + Vite admin panel (port 3000)
│   ├── vendor-app/     # React + Vite vendor portal (port 3001)
│   ├── rider-app/      # React + Vite rider PWA (port 3002)
│   └── ajkmart/        # Expo customer super-app (port 20716)
├── lib/                # Shared workspace libraries
│   ├── db/             # Drizzle ORM schema + migrations
│   ├── api-client-react/  # TanStack Query API hooks
│   ├── api-zod/        # Zod API contracts
│   ├── i18n/           # Trilingual string catalogue
│   ├── auth-utils/     # JWT helpers
│   └── ...             # phone-utils, service-constants, etc.
├── scripts/
│   ├── post-merge.sh   # Auto-runs after merges (verifies binaries + env)
│   └── setup.sh        # Universal first-time setup (VPS / Codespaces)
├── .replit             # Replit workflows, ports, env vars — all pre-configured
├── .npmrc              # pnpm hoisting config (do not remove)
└── pnpm-workspace.yaml # Workspace package declarations
```

---

## All Environment Variables

| Category | Variable | Required | Notes |
|---|---|---|---|
| **Database** | `DATABASE_URL` | **YES** | PostgreSQL connection string |
| **JWT / Auth** | `JWT_SECRET` | yes | Min 64 chars |
| | `ADMIN_JWT_SECRET` | yes | |
| | `ADMIN_ACCESS_TOKEN_SECRET` | yes | |
| | `ADMIN_REFRESH_TOKEN_SECRET` | yes | |
| | `ADMIN_REFRESH_SECRET` | yes | |
| | `ADMIN_SECRET` | yes | |
| | `ADMIN_CSRF_SECRET` | yes | |
| | `VENDOR_JWT_SECRET` | yes | |
| | `RIDER_JWT_SECRET` | yes | |
| | `ERROR_REPORT_HMAC_SECRET` | yes | |
| | `ENCRYPTION_MASTER_KEY` | yes | Min 16 chars |
| | `JWT_ISSUER` | yes | e.g. `ajkmart-dev` |
| **Admin Seed** | `ADMIN_SEED_USERNAME` | yes | |
| | `ADMIN_SEED_PASSWORD` | yes | |
| | `ADMIN_SEED_EMAIL` | yes | |
| | `ADMIN_SEED_NAME` | yes | |
| **Ports / URLs** | `PORT` | yes | Default `5000` |
| | `APP_BASE_URL` | yes | e.g. `https://yourdomain.com` |
| | `ADMIN_BASE_URL` | yes | |
| | `ALLOWED_ORIGINS` | yes | Comma-separated CORS origins |
| | `ALLOWED_DOMAINS` | yes | Socket.IO CORS in prod |
| **Firebase** | `FIREBASE_PROJECT_ID` | optional | |
| | `FIREBASE_CLIENT_EMAIL` | optional | |
| | `FIREBASE_PRIVATE_KEY` | optional | |
| **Twilio / SMS** | `TWILIO_ACCOUNT_SID` | optional | |
| | `TWILIO_AUTH_TOKEN` | optional | |
| | `TWILIO_FROM_NUMBER` | optional | |
| **Email** | `SENDGRID_API_KEY` | optional | |
| | `SMTP_HOST` | optional | |
| **AI** | `GEMINI_API_KEY` | optional | |
| **Maps** | `GOOGLE_MAPS_API_KEY` | optional | |
| | `OSRM_API_URL` | optional | |
| **Push** | `VAPID_PUBLIC_KEY` | optional | |
| | `VAPID_PRIVATE_KEY` | optional | |
| | `VAPID_CONTACT_EMAIL` | optional | |
| **Storage** | `STORAGE_BUCKET_URL` | optional (prod: YES) | |
| | `STORAGE_ACCESS_KEY` | optional (prod: YES) | |
| | `STORAGE_SECRET_KEY` | optional (prod: YES) | |
| | `STORAGE_BUCKET_NAME` | optional | Auto-extracted from URL |
| | `STORAGE_ENDPOINT` | optional | |
| | `STORAGE_REGION` | optional | Default `us-east-1` |
| **Infrastructure** | `REDIS_URL` | optional | JWT blacklisting |
| | `SENTRY_DSN` | optional | |
| | `SENTRY_WEBHOOK_SECRET` | optional | |
| **Runtime** | `NODE_ENV` | yes | `development` / `production` |
| | `LOG_LEVEL` | optional | `debug`, `info`, `warn` |
| | `DB_POOL_MAX` | optional | Default `10` |
| **Vite / Expo** | `VITE_API_PROXY_TARGET` | yes (dev) | `http://127.0.0.1:5000` |
| | `EXPO_PUBLIC_DOMAIN` | optional | |

---

## Troubleshooting

### "vite not found" on fresh import
**Fixed permanently.** All frontend `package.json` dev scripts use `../../node_modules/.bin/vite` directly instead of `pnpm exec vite`. This is committed to the repo and will never need manual fixing again.

### "tsx not found" or tsx version errors
**Fixed permanently.** `start-with-restart.mjs` dynamically discovers tsx from the pnpm store without any hardcoded version number. It will work regardless of what tsx version is installed.

### API server won't start
1. Check `DATABASE_URL` is set in Replit Secrets (padlock icon)
2. Check workflow logs for the specific error message
3. Health check: `curl http://localhost:5000/api/health` → should return `{"status":"ok","db":"ok",...}`

### Admin panel shows blank / 404
Ensure the Admin Panel workflow is running (port 3000). Admin is served at `/admin/`.

### Database schema errors after a merge ("column does not exist")
Drizzle migrations run automatically on every API server start. Restart the "Start application" workflow to trigger them.

### Multiple workflows crashing on pnpm install at the same time
The `post-merge.sh` and each workflow's dev script use `flock` to serialize concurrent installs — only one runs at a time, others wait. This is handled automatically.
