# Production deployment

## 1. Prepare environment

Copy `.env.production.example` to `.env.production` and replace every `CHANGE_ME` / placeholder with real values.

The PostgreSQL password in `POSTGRES_PASSWORD` must match the password embedded in `DATABASE_URL` when using the bundled compose file.

## 2. Build

```bash
cd backend
npm ci
npm run build
cd ../frontend
npm ci
npm run build
```

## 3. Start infrastructure and application

From the repository root:

```bash
docker compose --env-file .env.production -f deploy/docker-compose.production.yml up -d --build
```

## 4. Apply database schema explicitly

The API does not modify the schema on startup.

```bash
docker compose --env-file .env.production -f deploy/docker-compose.production.yml exec api npm run db:push
```

Do not run `npm run db:seed` in production.

## 5. Verify

```bash
curl https://api.example.com/health
```

Expected response:

```json
{"status":"ok","database":"ok","redis":"ok"}
```

Then complete `RELEASE_CHECKLIST.md` before opening registration to real users.
