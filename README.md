# etl-banks-ar

Personal finance management application for parsing and categorizing bank transactions from Argentine banks.

## Environment

Backend runtime configuration lives in `server/.env`.

```bash
cp server/.env.example server/.env
```

Optional deployment defaults for the public deploy script live in `.env` at the repo root.

```bash
cp .env.example .env
```

## Quick Deployment

The public deployment script is generic. Configure it with env vars from `.env` or pass flags directly.

```bash
# Full deployment
./deploy.sh --host user@example-host

# Full deployment with explicit target paths
./deploy.sh \
  --host user@example-host \
  --backend-path /srv/etl-banks-ar/api \
  --frontend-path /srv/etl-banks-ar/ui \
  --service etl-banks-ar-api

# Deploy only
./deploy.sh --host user@example-host --skip-build
```

Run `./deploy.sh --help` for all options.
