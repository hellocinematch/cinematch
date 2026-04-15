# Cinematch Weekly Seed Ratings Runbook

This runbook documents the weekly process to generate and ingest new ratings from title inputs.

## 0) Prepare the input files (in `SeedDataWeeklyAdd`)

Required files:
- `NewTitlesRatingsToAdd.csv` (you create this each week)
- `ratings-prev-loaded.csv` (already loaded historical ratings)
- `users.csv` (seed users pool; usually same 5k users)
- `user_mapping.csv` (external_id -> auth UUID mapping; reuse if same users)

### `NewTitlesRatingsToAdd.csv` format

Header and sample rows:

```csv
title,media_type
The Accountant 2,movie
The Last of Us,tv
Moana 2,movie
```

Notes:
- `media_type` must be `movie` or `tv`.
- Optional extra column: `tmdb_id` (if provided, script skips TMDB search by title).

## 1) Set TMDB token

```bash
export TMDB_BEARER_TOKEN='YOUR_TMDB_API_READ_ACCESS_TOKEN'
```

## 2) Generate weekly ratings CSV from titles

```bash
npm run seed:generate-ratings-from-titles
```

Outputs:
- `New_ratings_MMDDYYYY.csv` (for this week)
- `New_titles_resolved.csv` (audit: generated/skipped/unresolved titles)

## 3) Ensure mapping exists (quick reuse for same users)

If users are unchanged and `user_mapping.csv` already exists, this is usually fast:

```bash
SEED_DATA_DIR="SeedDataWeeklyAdd" USERS_CSV="SeedDataWeeklyAdd/users.csv" npm run seed:external-users
```

## 4) Transform into ingest-ready file (`user_id,...`)

```bash
SEED_DATA_DIR="SeedDataWeeklyAdd" OUTPUT_CSV="SeedDataWeeklyAdd/ratings_for_ingest.csv" npm run seed:external-ratings-transform
```

## 5) Ingest into Supabase ratings table

```bash
export SUPABASE_SERVICE_ROLE_KEY='YOUR_SUPABASE_SECRET_OR_SERVICE_ROLE_KEY'
INPUT_FILE="SeedDataWeeklyAdd/ratings_for_ingest.csv" npm run ml:ingest-ratings
```

Optional speed tweak:

```bash
INPUT_FILE="SeedDataWeeklyAdd/ratings_for_ingest.csv" SLEEP_MS=0 npm run ml:ingest-ratings
```

## 6) Update historical loaded file for next week dedupe

After successful ingest, merge this week's generated ratings into `ratings-prev-loaded.csv`:

```bash
npm run seed:merge-weekly-into-prev
```

This keeps next week's dedupe baseline current.

## Validation checks

1) Confirm ingest file exists:
- `SeedDataWeeklyAdd/ratings_for_ingest.csv`

2) Confirm duplicate keys are not present in DB:

```sql
select user_id, media_type, tmdb_id, count(*) as n
from public.ratings
group by user_id, media_type, tmdb_id
having count(*) > 1
order by n desc
limit 50;
```

No rows returned = no duplicate rating keys.
