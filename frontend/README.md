# Eye Gaze Chess

Play chess with your eyes. Webcam gaze tracking, a Stockfish opponent, and
accounts — all in one Next.js app, deployable to Vercel on its own.

## Architecture

Everything runs from this single Next.js project. There is no separate backend
service.

| Concern | Where it lives | Runs on |
|---|---|---|
| Gaze pipeline (MediaPipe, calibration, dwell) | `lib/eye-tracking/` | The browser, always. Webcam frames never leave the device. |
| Chess engine | `app/api/ai-move/` → `lib/server/stockfish.ts` | Node serverless function (Stockfish WASM) |
| Accounts | `app/api/auth/*` → `lib/server/{auth,session}.ts` | Node serverless function (Prisma + Postgres) |
| Sign-in / sign-up UI | `app/signin/`, `app/signup/`, `components/auth/` | Server-rendered, client form |

### API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Liveness check |
| `/api/ai-move` | POST | `{ fen, skillLevel?, depth? }` → best move in UCI |
| `/api/auth/signup` | POST | `{ name, email, password }` → creates account, starts session |
| `/api/auth/signin` | POST | `{ email, password }` → starts session |
| `/api/auth/signout` | POST | Clears the session cookie |
| `/api/auth/me` | GET | Current user, or `null` |

Sessions are a JWT in an httpOnly, SameSite=Lax cookie (`egc_session`), signed
with `AUTH_SECRET` and valid for 7 days.

## Local development

```bash
cp .env.example .env.local   # then fill in both values
npm install                  # runs `prisma generate`
npm run db:migrate           # applies migrations to the database
npm run dev
```

`AUTH_SECRET` must be at least 32 characters. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Deploying to Vercel

1. **Root Directory** — set it to `frontend` in the Vercel project settings.
   The repository root is not the app.
2. **Environment variables** — add `DATABASE_URL` and `AUTH_SECRET` for every
   environment you deploy (Production, Preview, Development). Use a *different*
   `AUTH_SECRET` per environment; changing it invalidates all existing sessions.
3. **Migrations** — Vercel does not run them. Apply them yourself against the
   production database before the first deploy:
   ```bash
   DATABASE_URL="<production url>" npx prisma migrate deploy
   ```

`npm run build` runs `prisma generate` first, so a clean checkout builds without
extra setup. The build needs no database connection.

### Why the engine config in `next.config.mjs` matters

The `stockfish` package ships every engine flavour, including two ~113 MB WASM
builds — far past Vercel's 250 MB uncompressed function limit. `next.config.mjs`
explicitly includes only the 7 MB `lite-single` build and excludes the rest,
which brings the traced `/api/ai-move` function to about 9 MB. Removing those
`outputFileTracing*` entries will break the deploy, in one direction or the
other: either the WASM is missing at runtime, or the function is too large.

Searches are bounded by wall-clock time as well as depth (`lib/server/stockfish.ts`),
so a complex position returns a weaker move rather than timing out the function.
