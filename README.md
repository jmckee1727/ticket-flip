# ticket-flip

A ticket flipping calendar. Surfaces concerts and festivals going on sale today,
annotates each one with a projected resale profit, and keeps a searchable
history of past events plus their resale price curves. Built for personal use
first; designed so it could grow into a public site.

This is a calendar that helps *humans* find flippable tickets. It is not a bot,
it does not buy tickets, and it does not interact with any primary checkout.

## What's in the box

- Homepage that lists today's on-sales with resellability flags and a projected
  profit column.
- Event detail page with the projected price, a historical resale chart, and
  comparable events used to derive the projection.
- Searchable history browser for every event the ingester has seen, with
  filtering by date range, category, artist, and venue.
- Pluggable projection algorithm: ship a placeholder, swap in your own
  comparables-based logic without touching the UI or the pipeline.
- Ingestion scripts for the Ticketmaster Discovery API (primary on-sale
  source), a TickPick scraper (historical resale prices), and a multi-source
  "current price" snapshotter with adapters for Ticketmaster Marketplace,
  StubHub, and SeatGeek.

## Quick start

```bash
# 1. Install dependencies (postinstall runs `prisma generate`)
npm install

# 2. Copy the env template and fill in a Ticketmaster key
cp .env.example .env
# Edit .env — you need TICKETMASTER_API_KEY at minimum.
# Register free at https://developer.ticketmaster.com/

# 3. Create the local SQLite DB
npm run db:migrate

# 4. Seed with the bundled fixture (30 real US events, offline)
npm run seed:fixtures

# 5. Run the dev server
npm run dev
# Visit http://localhost:3000
```

The fixture lets you click around the UI without touching a network. To pull
real on-sales, run `npm run ingest:ticketmaster -- --days 30` after step 2.

## Stack

Next.js 16 (App Router, Turbopack), TypeScript strict, Tailwind v4, Prisma 7
with the better-sqlite3 adapter for local dev. Recharts for the price chart,
Zod for validation, date-fns for time formatting, tsx for running scripts.

Prisma 7 changed its config model. The datasource block does not contain a
`url`; the connection string is resolved at runtime by `src/lib/db.ts` via
`PrismaBetterSqlite3`, which reads `DATABASE_URL`. Swap to
`@prisma/adapter-pg` when you move to Postgres.

## Repository layout

```
prisma/schema.prisma        Data model (see schema notes below)
prisma.config.ts            Prisma 7 config file
src/app/                    Next.js routes (homepage, /events/[id], /history)
src/app/_components/        Client components (filters, charts, badges)
src/app/api/history/        JSON endpoint for the history browser
src/lib/db.ts               Prisma client singleton (SQLite adapter)
src/lib/ticketmaster.ts     Discovery API client + parsing
src/lib/tickpick.ts         TickPick scraper scaffold
src/lib/projection.ts       Projection algorithm interface + placeholder
src/lib/comparables.ts      Three-tier similarity matcher
src/lib/resale-sources.ts   ResaleSource interface
src/lib/resale/             Per-source adapters (tm_marketplace, stubhub, seatgeek)
src/lib/format.ts           Money / date / relative-time helpers
scripts/ingest-ticketmaster.ts    Primary on-sale ingestion
scripts/ingest-tickpick.ts        Historical resale scraper
scripts/snapshot-resale.ts        Current-price snapshotter (multi-source)
scripts/run-projections.ts        Re-runs the projection algorithm
scripts/seed-fixtures.ts          Loads fixtures/ticketmaster-sample.json
scripts/inspect-db.ts             Quick DB stats printout
docs/projection.md                Deep dive on the projection contract
fixtures/ticketmaster-sample.json 30 real US events for offline dev
```

## Scripts

Every script reads `.env` via `dotenv/config`. Pass `--help` for the full
flag list on any of them.

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server on :3000 |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run db:migrate` | `prisma migrate dev` — creates `dev.db` |
| `npm run db:generate` | Regenerate the Prisma client (also runs postinstall) |
| `npm run db:studio` | Prisma Studio for poking at the DB |
| `npm run seed:fixtures` | Load `fixtures/ticketmaster-sample.json` |
| `npm run ingest:ticketmaster` | Fetch US concerts from the Discovery API |
| `npm run ingest:tickpick` | Scrape TickPick historical pricing (see caveats) |
| `npm run snapshot` | Capture current resale pricing from configured sources |
| `npm run projections:run` | Recompute `Projection` rows for events |

### Common flag patterns

```bash
# Ticketmaster: next 14 days, limit to 50 events, dry-run (no DB writes)
npm run ingest:ticketmaster -- --days 14 --limit 50 --dry-run

# Ticketmaster: use the bundled fixture instead of the live API
npm run ingest:ticketmaster -- --use-fixture

# Projections: just one event, no writes
npm run projections:run -- --event-id=<cuid> --dry-run

# Projections: only future events, specific algorithm
npm run projections:run -- --upcoming-only --algorithm=placeholder

# Snapshot: one source only, future events, no writes
npm run snapshot -- --source=tm_marketplace --upcoming-only --dry-run
```

## The projection algorithm (the part you will replace)

Ticket-flip ships with a placeholder that multiplies face value by 1.3 and
reports `confidence: 0`. It exists so the UI has something to render. You are
expected to swap in real logic. The contract is designed so you never touch
anything else in the app.

In short: implement a function with the signature

```ts
(input: ProjectionInput) => ProjectionOutput
```

register it in the `algorithms` map inside `src/lib/projection.ts`, and run
`npm run projections:run -- --algorithm=<your-name>`. `ProjectionInput` gives
you the event, its comparables (pre-matched by artist → venue+capacity →
category+price), any current resale snapshots, and tunable fee assumptions.
`ProjectionOutput` is a projected price, a profit number (after fees), a
`confidence` score in [0, 1], and a free-form `reasoning` JSON blob that shows
up on the event detail page.

See `docs/projection.md` for the full walkthrough with worked examples and
comparables-weighting recipes. `src/lib/comparables.ts` is where the three-tier
matcher lives if you want to tune or replace the similarity logic.

## Data model (at a glance)

- `Artist` — name, Ticketmaster / Spotify IDs, optional genres and monthly listeners
- `Venue` — name, city/state, capacity, Ticketmaster ID
- `Event` — the canonical row; references Artist and Venue, carries on-sale
  window, face-value range, and the flippability flags (`isSafeTix`,
  `isNonTransferable`, `resalePlatformRestriction`, `resalePriceCap`,
  `hiddenFromHomepage` + `hiddenReason`)
- `EventIngestSource` — raw payloads per source per event, for debugging and
  for the tm_marketplace resale parser which reads these back
- `ResaleSnapshot` — a point-in-time observation of resale pricing
  (min/median/max/avg, listing count, days-until-event, optional per-section
  JSON)
- `Projection` — one row per algorithm run per event, with confidence and
  reasoning
- `IngestionRun` — bookkeeping: which source ran when, OK/error counts, notes

`schema.prisma` is the source of truth. Keep it Postgres-compatible — the
adapter switch is a one-liner in `src/lib/db.ts`.

## Data sources and their quirks

**Ticketmaster Discovery API** — the primary source. Free tier is 5000 calls
per day, 5 req/sec. The client (`src/lib/ticketmaster.ts`) rate-limits to 200ms
between requests and retries with 2-second backoff on 429 / 5xx. Events that
are TBA come back with `onsale` set to `1900-01-01T06:00:00Z`; the homepage
filters those out.

**Ticketmaster Marketplace (tm_marketplace resale source)** — the most
reliable secondary data source in this repo. It does not make a network call:
it parses the raw JSON stored on `EventIngestSource.raw` looking for
resale-type price ranges. As soon as you run a real ingest, this lights up.

**TickPick scraper** — currently blocked by DataDome bot protection. The
scraper scaffold is committed (`src/lib/tickpick.ts`), detects blocks, and
logs cleanly. To actually pull data you need Puppeteer or Playwright with a
real browser fingerprint, or a different source.

**StubHub adapter** — scaffold only; expect bot blocks.

**SeatGeek adapter** — requires `SEATGEEK_CLIENT_ID` in `.env`. Free
registration at https://developer.seatgeek.com. Without it the adapter returns
`no-data` rows and the snapshotter skips them.

## Known limitations

- The fixture is real event metadata but comes from the Discovery API's
  preview payload, so many events have `null` face values and `1900-01-01`
  onsale dates. The placeholder algorithm correctly reports `confidence: 0`
  for those. Do a live ingest to see meaningful numbers.
- No authentication. Personal use tool.
- SQLite for now. The schema is Postgres-compatible; move by swapping the
  adapter in `db.ts` and running `prisma migrate deploy` against a Postgres
  URL.
- The projection algorithm is intentionally dumb out of the box. That's the
  plug-in point.

## Environment variables

See `.env.example`. The short version:

- `DATABASE_URL` — defaults to `file:./dev.db`. Required.
- `TICKETMASTER_API_KEY` — required for live ingestion.
- `TICKETMASTER_CONSUMER_SECRET` — optional, kept for future OAuth flows.
- `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` — optional, for artist
  enrichment. Not wired into the pipeline yet.
- `SEATGEEK_CLIENT_ID` — optional, enables the SeatGeek resale adapter.
- `SCRAPE_USER_AGENT` — UA string for the TickPick scraper.
- `SCRAPE_REQUEST_DELAY_MS` — throttle for the TickPick scraper.
