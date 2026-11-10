# LifeOS: audit, gap analysis, architecture and roadmap

Status: planning only. No source code, schema or configuration was changed to produce this.
Date: 2026-11-10. Based on reading the repository at commit 928e173 and the production setup as seen so far.
Things I could not verify are marked **(unverified)**.

---

## Phase 1: Existing project audit

### 1.1 What the project is
A single-owner site on Cloudflare Workers with two parts:
- a public bilingual portfolio (static HTML in `public/portfolio`, served at `/` and `/th`)
- a private planner at `/app` (Today, Calendar, To do, Notes, Claude/connect, Settings), plus a read-only money card fed by a separate private "Expenses" app

About 6,400 lines of TypeScript/TSX in `src/`, 25 commits, one developer.

### 1.2 Technology stack
| Layer | Choice |
|---|---|
| Framework | Next.js 16.4.5 (App Router, Turbopack), React 19.3, TypeScript 5 |
| UI | Tailwind CSS 4, shadcn/ui (radix-ui), lucide-react, sonner (toasts), next-themes |
| Validation | zod 4 |
| Runtime | Cloudflare Workers through `@opennextjs/cloudflare`, custom entry `custom-worker.ts` |
| Data | D1 (SQLite) binding `DB`; KV binding `BACKUPS`; service binding `MONEY` to worker `money-tracker` |
| Deploy | Workers Builds on push to `main`; D1 migrations are applied by hand |
| Tests | **None** (no runner, no test files) |

### 1.3 Frontend architecture
- Pages under `src/app/app/*` are thin wrappers around client "view" components in `src/components/app/*`.
- Data loading is one hand-written hook, `useData` (stale-while-revalidate, reloads on a global `mw:data-changed` event and when the tab becomes visible). No query cache, no retry, no optimistic updates.
- `AppShell` checks login in the browser (`/api/auth/me`) and shows a spinner, then either the login screen or the app. The `/app` pages themselves are public static shells; the data is protected at the API.
- Design tokens live in `globals.css` (cream #F3EEE3, ink #111, orange #D9541E, light by default, dark variant exists). Mascot Pupu is a code-drawn component with 8 poses.

### 1.4 Backend architecture
- REST route handlers in `src/app/api/*`, all wrapped by `api()` in `src/lib/server/http.ts`, which checks the session and maps `ZodError` / `InputError` to JSON errors.
- Data access is concentrated in one file, `src/lib/server/repo.ts` (about 450 lines): events, notes, to-dos, summary. `messages.ts`, `money.ts`, `login-limit.ts` are separate.
- Recurrence is expanded at read time in `src/lib/recurrence.ts` (weekly, chosen weekdays, optional end date).
- MCP server: hand-written JSON-RPC over Streamable HTTP in `src/lib/server/mcp/handler.ts`; 18 tools in `tools.ts` that call the same repo functions.
- Weekly cron backup to KV in `custom-worker.ts`.

### 1.5 Database schema (D1, 5 migrations)
| Table | Purpose | Notes |
|---|---|---|
| `events` | calendar events | UTC ISO times; all-day events store an exclusive end; `repeat_days` ("1,3,5") and `repeat_until` added in 0005 |
| `notes` | notes | optional `note_date`, optional `event_id` (set to NULL by code when the event is deleted) |
| `todos` | tasks without a fixed time | title, note, `due_date`, `important`, `done`, `done_at` |
| `messages` | portfolio contact form inbox | read flag, IP for rate limit |
| `page_views` | cookie-free visit counter | day, path, referrer domain, country |
| `login_attempts` | login lockout | per IP |

Indexes exist on `events.start_at`, `notes.updated_at`, `notes.note_date`, `todos(done, due_date)`, messages, page views. There are no categories, tags, goals, habits or links between tasks and anything else.

### 1.6 API endpoints (all need the session except contact and MCP)
`/api/events`, `/api/events/[id]`, `/api/notes`, `/api/notes/[id]`, `/api/todos`, `/api/todos/[id]`, `/api/search`, `/api/summary`, `/api/messages(/[id])`, `/api/money/{summary,calendar,transactions}`, `/api/backups(/download)`, `/api/stats`, `/api/connect`, `/api/auth/{login,logout,me}`, `/api/contact` (public), `/api/mcp` and `/api/mcp/[key]` (token).

### 1.7 Authentication and security
Good:
- One password compared in constant time; HMAC-signed httpOnly cookie, `SameSite=Lax`, `Secure` on HTTPS, 30-day life.
- Login lockout: 5 failures in 15 minutes locks that IP for 15 minutes (stored in D1).
- Secrets only in Cloudflare secrets and `.dev.vars`; contact form has a honeypot and a per-IP limit; input is validated with zod on every write route.

Weaknesses:
1. The session cannot be revoked per device; the only way to log everything out is to rotate `SESSION_SECRET`.
2. The MCP secret sits in the URL path (`/api/mcp/<token>`), so it can end up in logs and history. A Bearer variant exists.
3. No rate limit on the API or MCP, only on login and the contact form.
4. MCP tools can delete or overwrite data with no confirmation step.
5. No `user_id` anywhere. That is fine for one owner, but it means "authorization" is just "logged in or not".
6. No security headers (CSP etc.) configured by the app **(unverified; may be set at the edge)**.
7. No error tracking beyond `console.error` (Workers observability is enabled, so logs exist in the dashboard).

### 1.8 Existing modules: what they really do
- **Today:** timeline of today's events plus overdue events, "Up next" (7 days), To do card, messages card, money card, quick note, recent notes. Real data, real API.
- **Calendar:** month grid with all-day and multi-day events, per-day panel, done checkbox, recurring events. No day or week view. To-dos do not appear.
- **To do:** list with due date, star, done, delete. No priority levels, categories, subtasks, status, sorting or filtering beyond the built-in order.
- **Notes:** Markdown-style text, pin, search, link to a date or event. No tags, folders, rich-text editor or autosave.
- **Claude:** MCP connector info page plus 18 tools (events, notes, to-dos, messages, visit stats).
- **Search:** ⌘K across events, to-dos, notes (substring `LIKE`, 8 results per kind).
- **Money:** read-only card and per-day panel from the Expenses app; no data of its own here.

### 1.9 Deployment and operations
- Push to `main` runs Workers Builds. It failed on every push for hours because the cron `0 20 * * 0` is invalid for Cloudflare (Sunday must be `SUN` or 1). Fixed in af66a74; the next builds passed.
- Migrations are manual (`npm run db:migrate:remote`) and must be run **before** the push. Pushing first caused a production server error once already.
- Backups: weekly snapshot of `events`, `notes`, `todos` to KV (8 weeks), manual "back up now" and download. No restore button. `messages` and `page_views` are not backed up.

### 1.10 Technical debt
1. No automated tests and no CI check (typecheck, lint, build are run by hand).
2. `repo.ts` mixes four domains and will become the bottleneck as modules are added.
3. ~~Duplicate-looking dependency `cn`~~ checked: `cn` is shadcn's own class-merge package, used on purpose. `date-fns` was unused and has been removed.
4. Mixed languages: UI in English, MCP tool descriptions and code comments in Thai (fine for Claude, but inconsistent).
5. The dashboard greeting hardcodes "James".
6. Recurring events can only be edited as a whole series; no per-occurrence done, skip or override.
7. `searchEvents` returns raw series rows, not occurrences; `fetchEvents` caps at 1000 rows.
8. `getSummary` runs 6 queries and expands the whole month on each Today load; fine now, will not scale to more modules without caching.
9. ~~Repo root clutter~~ checked: those files are already git-ignored.
10. `AGENTS.md` and `.claude/launch.json` are in the public repository.

---

## Phase 2: Gap analysis

Legend: **Full** = Fully implemented, **Part** = Partially implemented, **None** = Not implemented, **Refactor** = Needs refactoring, **Maybe** = Potentially unnecessary.

| Requirement | Status | What exists / what is missing |
|---|---|---|
| **Habit Tracker** (all) | None | Nothing exists. |
| **Goal Management** (all) | None | Nothing exists. |
| **Analytics**: task counts | Part | Counts exist for events this week/month and open to-dos; no completion rate, overdue count for to-dos, history or charts. |
| Analytics: habits, goals | None | Depend on the new modules. |
| Analytics: charts | None | No chart library yet. |
| **Finance tracker** | Part (via Expenses) | Income/expense, categories, budgets, history and charts live in the separate Expenses app. LifeOS only reads a summary. Key decision below. |
| **Global search** | Part | ⌘K over events, to-dos, notes. Missing habits, goals, transactions, filters, categorised page, ranking. |
| **AI assistant** | Part | MCP with 18 tools works. Missing analytics/review tools, habits/goals, and confirmation for destructive writes. |
| **Today dashboard** | Part | Has events, overdue events, to-dos, money. Missing today's progress, habits, active goals, weekly overview, overdue to-dos. |
| **Calendar: month view** | Full | |
| Calendar: day and week views | None | |
| Calendar: recurring events | Part | Weekly only; whole-series edit; no skip/override/per-occurrence done. |
| Calendar: categories, filtering, legend | Part | 7 colours exist but no names, filter or legend. |
| Calendar: task/goal integration | None | To-dos with due dates are not shown. |
| Calendar: mobile interactions | Part | Responsive, no gestures. |
| **Tasks: due date, star** | Full | |
| Tasks: priority levels, categories, description | Part | Star only; one free-text note field. |
| Tasks: subtasks, status, kanban, sorting/filtering | None | |
| Scheduled vs unscheduled distinction | Full | Events vs To do are separate. |
| **Notes: pin, search, link to event/date** | Full | |
| Notes: rich text, tags, folders, autosave | None | Plain text with Markdown conventions. |
| Notes: links to tasks/goals | None | Only event link. |
| **Data integration** (goal ties everything) | None | No relationship model beyond note→event. |
| **Auth** | Full for one owner | Session revocation, token rotation, API rate limit missing. |
| **Input validation** | Full | zod on all write routes. |
| **Tests** | None | |
| **Backups** | Part | Weekly + manual + download; no restore, tables hard-coded. |
| **Error/loading/empty states, toasts** | Part | Toasts, empty states, skeletons exist on most pages; error states are basic (text line). |
| **Light/dark theme** | Full | Light is the default (cream), dark exists. The brief says "dark theme": the real default is cream/light; I propose to keep what exists. |
| **Repo layout (`repo.ts`)** | Refactor | Split by domain before adding modules. |
| `date-fns`, duplicate `cn` | Maybe | Check and remove if unused. |

### Prioritised improvement list
1. Test infrastructure and CI (nothing else can be changed safely without it).
2. Split `repo.ts`; additive migrations convention; deploy script that applies the migration first.
3. Task model upgrade (priority, status, category, subtasks), because goals, analytics and Kanban all depend on it.
4. Habits, then Goals plus the link table.
5. Today dashboard using the new data.
6. Analytics, calendar views, notes upgrade.
7. Search extension, finance integration, AI enhancements.

---

## Phase 3: Architecture and database proposal

Principle: keep Next.js + Cloudflare + D1. No rewrite. Add modules next to the existing code.

### 3.1 Module boundaries
```
src/modules/
  tasks/     repo.ts  schema.ts  routes helpers  mcp.ts
  events/    (move from repo.ts; recurrence.ts)
  notes/
  habits/
  goals/
  analytics/ (read-only queries, no tables of its own)
  search/
  finance/   (client for the Expenses integration API)
  ai/        (MCP tool registry, confirmation flow, audit log)
src/lib/server/  auth, http, env (shared)
```
Each module exports: zod schemas, a repository (D1 only), service functions (rules), and its MCP tool definitions. Route handlers and MCP tools call the service layer, never SQL directly, so web and Claude share one set of rules.

### 3.2 Database design (additive migrations only)

Existing tables stay. `todos` is kept and extended instead of renamed.

```
todos (extend)                       categories (new)
  + description TEXT                   id, name, kind ('task'|'event'|'note'|'goal'), color
  + status TEXT  -- todo|doing|done    UNIQUE(kind, name)
  + priority INTEGER -- 0 none,1 low,2 med,3 high
  + category_id -> categories          tags (new)         entity_tags (new)
  + parent_id -> todos (subtask)         id, name UNIQUE      tag_id, entity_type, entity_id
  + sort_order INTEGER
  (keep important as an alias of priority=3 during transition)

habits (new)                          habit_checkins (new)
  id, title, description, color         habit_id, day (YYYY-MM-DD), note
  schedule_type: daily|weekdays|every_n PRIMARY KEY (habit_id, day)
  weekdays "1,3,5" | interval_days
  start_date, archived_at

goals (new)                           milestones (new)
  id, title, description                id, goal_id, title, due_date, done_at, sort_order
  horizon: short|long
  category_id, priority, status         goal_links (new, one table for all links)
  start_date, target_date                 goal_id, entity_type ('task'|'habit'|'event'|'note'),
  completed_at                            entity_id, PRIMARY KEY(all three)

event_exceptions (new)                audit_log (new, AI/MCP writes)
  event_id, day, kind (skip|override)   id, at, actor ('web'|'mcp'), action, entity_type,
  override fields (title/time/done)     entity_id, before_json, after_json

pending_actions (new, AI confirmation)
  id, tool, args_json, summary, created_at, expires_at, confirmed_at
```

Why a single `goal_links` table: the Japanese N4 example needs one goal tied to tasks, habits, events and notes. A polymorphic link table avoids adding a `goal_id` column to four tables and lets one note belong to several goals. Cost: no database-level foreign key on `entity_id`, so the service layer validates and cleans links on delete (same pattern the code already uses for `notes.event_id`).

Derived data is **computed, not stored**: streaks, completion rate, goal progress, analytics. Goal progress = completed milestones and linked tasks over total, shown with the raw counts so it is never a vague "score".

Habit rules:
- Current streak counts consecutive scheduled days with a check-in ending today or yesterday; the longest streak is computed by one pass over check-ins. Non-scheduled days do not break a streak.
- Completion rate = check-ins / scheduled days in the period.

### 3.3 API design
Keep the current REST style (`/api/<module>` and `/api/<module>/[id]`), all behind `api()`. New:
`/api/habits`, `/api/habits/[id]/checkins`, `/api/goals`, `/api/goals/[id]/milestones`, `/api/goals/[id]/links`, `/api/analytics/{tasks,habits,goals,overview}?from&to`, `/api/categories`, `/api/tags`. `/api/search` gets `types=` and `limit=` filters.

### 3.4 Search
D1 supports FTS5. Add one virtual table `search_index(entity_type, entity_id, title, body)` kept in sync by the service layer (triggers are an option), covering tasks, events, notes, habits, goals. Finance transactions are searched on demand through the Expenses integration API (no copy of its data here).

### 3.5 Finance decision
The Expenses app already owns transactions, categories, budgets and charts. Duplicating them would create two sources of truth. Proposal: LifeOS keeps Expenses as the source of truth, and the Finance module is a read-only view (monthly summary, budget alerts, search) over `/api/integration/v1/*`. If the owner wants everything in one app, that is a separate, large migration project (Expenses stores satang and has its own auth).

### 3.6 Authentication and authorization
Still a single owner; do not add multi-user tables now. Improve:
- session version stored in D1 so "log out everywhere" works;
- two MCP tokens (current and next) so rotation does not break Claude; prefer the Bearer header over the URL token;
- `Origin` check on state-changing routes;
- a small rate limit on API and MCP using D1 or KV.

### 3.7 AI integration architecture
MCP stays the single controlled interface to real data.
- **Read tools** (no confirmation): summaries, analytics, search, list habits/goals/tasks.
- **Safe writes** (create, tick a habit, complete a task): allowed directly, recorded in `audit_log`.
- **Significant writes** (delete anything, bulk edits, changing a goal's status, editing recurring series): the tool does not execute. It stores a `pending_action` and returns a plain-language preview and an id. The owner approves it in the app (a banner or a "Pending approvals" list), then the action runs. Pending actions expire after 24 hours.
- Tools return raw measurable data; the assistant does the narrative review (weekly review, habit consistency) from those numbers.

### 3.8 Migration and rollout strategy
- Additive only (new tables, nullable columns). No drops or renames until the old code path is gone ("expand, then contract").
- A manual backup snapshot before every migration (button exists; add it to the checklist).
- `deploy` script order: backup, migrate remote, push/deploy. Never push first.
- Backup list becomes table-driven so new tables are included automatically.
- Existing `todos.important` and the `done` flag keep working while `priority`/`status` are introduced (backfill: important → priority 3; done → status done).

---

## Phase 4: Roadmap

Each phase ships on its own, behind a passing test run, and is verified before the next starts.

### P0 Foundations (about 1 to 2 weeks of evenings)
- **Scope:** safety net and structure; no new user-facing modules.
- **Tasks:** add Vitest with D1 test support; tests for recurrence expansion, time helpers, repo functions, auth cookie, zod schemas; GitHub Actions running typecheck, lint, test, build; split `repo.ts` into modules; remove unused deps; make backups table-driven; add restore-from-backup (preview first); session version; Origin check; API rate limit; fix hardcoded name; tidy repo root; document decisions in `docs/adr/`.
- **Dependencies:** none.
- **Outcome:** every later change is covered by tests; deploys cannot skip a migration silently.
- **Testing:** unit tests for pure logic, integration tests on a local D1; smoke test of login and CRUD.
- **Risks:** refactor regressions (mitigated by writing tests first); D1 test tooling setup time.

### P1 Habits, Goals, Task upgrade, Today dashboard
- **Scope:** migrations for task fields, categories, habits, check-ins, goals, milestones, `goal_links`; UI and API for each; Today shows progress, today's habits, important/overdue tasks, active goals, weekly overview.
- **Tasks:** task priority/status/category/subtasks plus list sorting and filters (Kanban can wait for P2); Habit CRUD, check-in, streak and rate functions; Goal CRUD, milestones, links; dashboard cards; MCP tools for habits and goals.
- **Dependencies:** P0.
- **Outcome:** the Japanese N4 example works end to end.
- **Testing:** streak and rate edge cases (missed days, non-scheduled days, month boundaries, timezone), link cleanup on delete, migration applied to a copy of production data.
- **Risks:** polymorphic links drifting (mitigated by service-layer validation and a periodic integrity check); dashboard overload (cap each card, link to detail pages).

### P2 Analytics, Calendar, Notes
- **Scope:** analytics endpoints and charts; calendar day/week views, category filter and legend, tasks with due dates and goal milestones shown; recurring exceptions; Kanban; notes tags/folders/autosave/rich text and links to tasks and goals.
- **Dependencies:** P1 data.
- **Outcome:** weekly and monthly overviews with raw counts and comparisons to the previous period; no composite "productivity score".
- **Testing:** analytics against hand-computed fixtures; calendar rendering at phone width; autosave conflict handling.
- **Risks:** chart library weight on Workers bundle size (pick a small one, lazy load); rich text editor choice (start with Markdown plus preview, add rich text only if needed).

### P3 Global search and finance view
- **Scope:** FTS5 index across modules with type filters and a results page; finance module as read-only view of Expenses plus budget alerts.
- **Dependencies:** P1 (entities exist), Expenses integration API.
- **Outcome:** one search box for everything including transactions.
- **Testing:** index stays in sync on create/update/delete; Thai text matching **(needs checking, FTS5's default tokenizer is weak for Thai, may need a trigram tokenizer)**; behaviour when Expenses is unreachable.
- **Risks:** Thai search quality; keeping the index consistent.

### P4 AI assistant
- **Scope:** `pending_actions` confirmation flow, audit log, analytics and review tools, planning helpers (suggest priorities from due dates, priority and habit load).
- **Dependencies:** P1 to P3.
- **Outcome:** Claude can summarise the day or week and propose changes, but significant edits wait for approval in the app.
- **Testing:** confirmation required for each destructive tool; expiry; replay protection; tool output size limits.
- **Risks:** prompt-injection from note or message content (treat stored text as data; never auto-execute from it); MCP client support for the approval handoff (mitigate by approving in the web app, not in chat).

### Suggested order of work inside P0
1. Tests for the pure modules (`time`, `recurrence`, schemas).
2. CI.
3. Repo split with tests green.
4. Restore, session version, Origin check, rate limit.

---

## Decisions recorded (2026-11-10)
1. Finance: Expenses stays the source of truth; LifeOS shows a read-only view.
2. Theme: keep the current cream/light default with the dark option.
3. UI language: English.
4. P0 approved and implemented (see `docs/adr/0001-modules-and-tests.md`).

## Original open decisions
1. **Finance:** keep Expenses as the source of truth and add a read-only view (recommended), or merge everything into LifeOS?
2. **Theme:** the brief says dark theme; the app is cream/light by default with a dark option. Keep as is (recommended)?
3. **UI language:** keep English UI, or add Thai UI strings?
4. **Start:** approve P0 as the first implementation phase?
