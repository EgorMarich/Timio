# Timio 1.0.0 — production release

Timio 1.0.0 is the first release candidate intended for real SMB users.

## Product scope

- Online booking and public booking page
- Schedule and appointment management
- Clients / CRM
- Services and staff
- Retention / reactivation engine
- Retention campaigns and attribution
- Daily Business Intelligence
- Empty Slot Intelligence
- AI retention recommendations
- AI message drafts
- Email verification and password reset
- Redis-backed HttpOnly sessions
- Google / VK OAuth when configured
- Telegram notifications and retention offers
- YooKassa subscription foundation
- Responsive mobile UI and PWA shell

## Production requirements

Required before opening registration to real users:

1. PostgreSQL and Redis are provisioned and backed up.
2. `NODE_ENV=production` is set.
3. `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `FRONTEND_URL`, `RESEND_API_KEY`, and `RESEND_FROM` are set.
4. HTTPS is enabled for the frontend and API.
5. The API and frontend are deployed under the intended production domains.
6. Database schema is applied as an explicit deployment step. The API container does **not** run `db:push` or seed demo data automatically.
7. Email verification and password reset are tested with a real mailbox.
8. `/health` is monitored.
9. PostgreSQL backups and restore procedure are verified.
10. Payment webhooks are configured only when YooKassa credentials are enabled.

## Deployment artifacts

- `deploy/docker-compose.production.yml` — production Docker Compose
- `deploy/README.md` — deployment commands
- `.env.production.example` — production environment template
- `RELEASE_CHECKLIST.md` — launch checklist
- `.github/workflows/ci.yml` — backend/frontend build CI

## Recommended deployment order

```text
PostgreSQL + Redis
        ↓
apply DB schema
        ↓
API
        ↓
Frontend
        ↓
HTTPS / DNS
        ↓
health check
        ↓
registration smoke test
        ↓
real user onboarding
```

## Smoke test

- register a new account
- receive verification email
- verify email
- create business
- create 3 services
- create employee
- configure working hours
- create client
- create appointment
- open public booking page
- verify appointment appears in schedule
- verify daily intelligence
- verify empty-slot intelligence
- create retention recommendation
- generate an AI message draft
- log out and log back in
- terminate a session from Account Security
- request password reset

## Known limitations

- Provider credentials for Telegram / WhatsApp / SMS / AI are optional integrations and must be configured separately.
- Full CI/CD and automated production tests are not included in this release package.
- Large-scale performance optimization of retention intelligence remains a follow-up item; current implementation is suitable for initial SMB rollout, not unlimited scale.
