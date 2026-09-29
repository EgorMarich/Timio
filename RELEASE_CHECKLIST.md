# Timio 1.0.0 — Release Checklist

## A. Infrastructure
- [ ] PostgreSQL 16+ provisioned
- [ ] Redis 7+ provisioned with persistence where appropriate
- [ ] PostgreSQL automated backups enabled
- [ ] Restore test completed
- [ ] DNS configured
- [ ] HTTPS configured for frontend and API
- [ ] Reverse proxy forwards `X-Forwarded-For` correctly

## B. Environment
- [ ] `NODE_ENV=production`
- [ ] `DATABASE_URL` points to production PostgreSQL
- [ ] `REDIS_URL` points to production Redis
- [ ] `CORS_ORIGINS` contains only the production frontend origin(s)
- [ ] `FRONTEND_URL` is the production frontend URL
- [ ] `API_PUBLIC_URL` is the public API URL
- [ ] `RESEND_API_KEY` and `RESEND_FROM` are configured
- [ ] `PUBLIC_API_BASE_URL` points to the public API URL
- [ ] OAuth credentials configured only if those login methods are enabled
- [ ] YooKassa credentials configured only when billing is enabled

## C. Deployment
- [ ] Build backend with `npm ci && npm run build`
- [ ] Build frontend with `npm ci && npm run build`
- [ ] Apply schema explicitly with `npm run db:push`
- [ ] Never run demo seed in production
- [ ] Start API and frontend
- [ ] Verify `GET /health` returns database and Redis `ok`

## D. Smoke test
- [ ] Register
- [ ] Receive verification email
- [ ] Verify email
- [ ] Create business
- [ ] Create 3 services
- [ ] Create employee
- [ ] Configure working hours
- [ ] Create client
- [ ] Create appointment
- [ ] Open public booking page
- [ ] Confirm booking appears in schedule
- [ ] Check Daily Business Intelligence
- [ ] Check Empty Slot Intelligence
- [ ] Generate AI message draft
- [ ] Log out / log in
- [ ] Terminate a session
- [ ] Password reset

## E. First users
- [ ] Start with 5–10 real businesses
- [ ] Monitor errors and `/health`
- [ ] Collect onboarding friction
- [ ] Do not enable broad paid acquisition yet
- [ ] Keep a rollback plan and database backup before every schema change
