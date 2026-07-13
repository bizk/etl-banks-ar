# Repository Guidelines

## Project Structure & Module Organization
This repository is centered on a Go service under `server/`.
- Entry point (production API): `server/cmd/api/main.go` (`go run ./cmd/api` from `server/`)
- Legacy/experimental: `server/cmd/main.go` (not used for the workspace REST API)
- Core modules: `server/internal/` (`controllers`, `db`, `models`, `ocr`, `openai`, `clasifier`, `configs`)
- Infra/runtime files: `server/docker-compose.yml`, `server/dockerfile`, `server/.env`
- Example/local data: `server/resources/`, `server/etl.db`, `server/test.db`

Keep new domain logic in `server/internal/<feature>/` and avoid adding business logic directly in `cmd/`.

## Build, Test, and Development Commands
Run commands from `server/` unless noted otherwise.
- `go run ./cmd/api` runs the workspace API locally (`API_PORT`, default `8080`).
- `go build -o main ./cmd/api` builds the API binary (`make build-pi` emits `server/tostado` for ARM64).
- `go test ./...` runs all Go tests (currently limited; add tests with new features).
- `docker compose up -d --build` starts MySQL + app containers.
- `docker compose down --volumes=false` stops containers and keeps DB volume data.

## Coding Style & Naming Conventions
- Follow standard Go formatting: run `gofmt ./...` before opening a PR.
- Use idiomatic Go naming: exported identifiers in `PascalCase`, internal/local names in `camelCase`.
- Package names should be short, lowercase, and descriptive (for new code, prefer correctly spelled names, e.g. `classifier`).
- Keep files focused by responsibility (`db` access in `internal/db`, API clients in `internal/openai`, etc.).

## Testing Guidelines
- Use Go’s `testing` package with table-driven tests where practical.
- Place tests next to implementation files as `*_test.go` (example: `internal/db/db_test.go`).
- Prioritize tests for transaction classification, DB integration boundaries, and config/env handling.
- Run `go test ./...` locally before each commit.

## Commit & Pull Request Guidelines
Recent history uses short, descriptive messages (example: `added classifier still has some work to do`). Keep commits focused and easy to review.
- Prefer one logical change per commit.
- Use clear, imperative summaries (example: `add transaction classification fallback`).
- PRs should include: purpose, key changes, test evidence (`go test ./...` output), and any env/config changes.
- Link related issues and include logs/screenshots when behavior changes are hard to verify from code alone.
