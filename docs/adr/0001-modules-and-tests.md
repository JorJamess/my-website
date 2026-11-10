# ADR 0001: modules, tests and safe changes

Date: 2026-11-10. Status: accepted.

## Context
The app grew from a calendar into several features (events, notes, to-dos, messages, backups) with all data access in one `repo.ts` and no automated tests. Planned work (habits, goals, analytics, search) would multiply the risk.

## Decisions
1. **Domain modules.** Data access lives in `src/modules/<domain>/repo.ts` (`events`, `notes`, `tasks`, `summary`) with shared helpers in `src/modules/core.ts`. `src/lib/server/repo.ts` is a thin barrel that re-exports them so existing imports keep working. Route handlers and MCP tools both call the same functions, so the web app and Claude follow one set of rules.
2. **Tests run against the real schema.** Vitest uses a tiny D1 stand-in on Node's built-in SQLite (`tests/helpers/d1.ts`) that applies every file in `migrations/`. A migration that breaks the schema fails the tests. The stand-in makes `batch()` atomic like D1.
3. **CI** (`.github/workflows/ci.yml`) runs typecheck, lint, tests and a Next build on every push and pull request. `npm run check` runs the first three locally.
4. **Migrations are additive** (new tables or nullable columns). Order for a release that includes one: back up, `npm run db:migrate:remote`, then push. Pushing first makes the new code query a table that does not exist yet.
5. **Backups are table-driven.** Add a table to `BACKUP_TABLES` in `src/lib/backup-core.ts` and it is included in snapshots, previews and restores. Restore replaces the tables present in a backup in one atomic batch, validates column names against the live schema, and always saves a "pre-restore" copy first.
6. **Sessions carry a version.** `app_settings.session_version` is part of the signed cookie; "Log out of all devices" bumps it. Old tokens stop working immediately.
7. **CSRF.** Cookie-authenticated writes reject a cross-site `Origin` (`src/lib/server/origin.ts`). The MCP endpoints use a token, not the cookie, and lock an IP out after 5 wrong tokens.

## Not done on purpose
- **General API rate limit.** Every API route except the contact form and MCP needs the owner's cookie, and login and MCP-token guessing are already limited. A global limiter would add a database write to every request for little gain. Revisit if the API ever becomes public.
- **Multi-user tables.** One owner; no `user_id` columns until that changes.
- **Hardcoded greeting name.** "James" in the Today greeting is the owner's own nickname on a personal site; make it a setting only if the site is ever shared.

## Consequences
New features follow the same shape (module repo + schema + route + MCP tool + tests). Existing behaviour is protected by tests before it is changed.
