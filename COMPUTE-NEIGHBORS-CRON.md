# `compute-neighbors` scheduled rebuild (Supabase)

This documents how **weekly / staggered** neighbor recomputation is wired for Cinematch, and **when to extend it** as the user base grows.

## What it does

- Calls the Edge Function **`compute-neighbors`** with **`mode: "all"`** in **small chunks** (`limit` per call, different `offset`) so each run stays within **`pg_net`** timeouts and Edge duration limits.
- **Does not replace** per-user rebuilds when someone **rates** in the app (those still invoke `compute-neighbors` for that user).

## Prerequisites (checklist)

| Piece | Where |
|--------|--------|
| Extensions **`pg_cron`**, **`pg_net`** | Database → Extensions (schema **`extensions`**) |
| **`compute-neighbors`**: JWT verification **OFF** | Edge Functions → function settings (publishable key is not a JWT; avoids gateway `Invalid JWT`) |
| Edge secret **`COMPUTE_NEIGHBORS_CRON_SECRET`** | Edge Functions → Secrets |
| Vault **`project_url`** | e.g. `https://<project-ref>.supabase.co` |
| Vault **`supabase_anon_key`** | **Publishable** API key (`sb_publishable_…`) — name is legacy; value must be publishable |
| Vault **`compute_neighbors_cron_secret`** | Same string as **`COMPUTE_NEIGHBORS_CRON_SECRET`** |

## HTTP shape (for `net.http_post` / cron command)

- **`apikey`**: publishable key (from Vault `supabase_anon_key`).
- **`x-compute-neighbors-secret`**: cron secret (from Vault `compute_neighbors_cron_secret`).
- **Do not** put the publishable key in **`Authorization: Bearer`**.
- Optional: **`timeout_milliseconds`** on `net.http_post` (e.g. `90000`) if chunks still time out at the default.

Example body:

```json
{"mode":"all","offset":0,"limit":5}
```

## Staggered jobs (“smaller chunks with waits”)

Pattern used:

- **`limit`: 5** users per invocation.
- **`offset`**: `0`, `5`, `10`, … (next chunk starts where the previous left off).
- **Schedule**: e.g. **3 minutes apart** on the same day (e.g. Sunday **05:00**, **05:03**, **05:06** UTC) so runs are spaced.

Each chunk is a **separate** `cron.schedule` row with a **unique** `jobname` (e.g. `compute-neighbors-w00`, `w01`, …).

### Inspect jobs

```sql
select jobid, jobname, schedule, command
from cron.job
where jobname like 'compute-neighbors-w%'
order by jobname;
```

### Remove one job

```sql
select cron.unschedule('compute-neighbors-w03');
```

## **IMPORTANT: Revisit when you have more users**

The sorted user list from `fetchAllRealUserIds` grows over time. Each weekly wave only recomputes:

\[
\text{users covered} = (\text{number of chunk jobs}) \times (\text{limit per job})
\]

Example: **10 jobs** × **5 users** = **50 users** per week on that schedule.

**When total real users (non-seed) exceeds what you cover:**

1. Add more **`cron.schedule`** rows with higher **`offset`** values (continue `50`, `55`, `60`, …) and stagger times (e.g. continue past `05:27` into `05:30`… or spill into hour **06**).
2. Or increase **`limit`** slightly **only if** Edge logs show each chunk finishes comfortably inside **`timeout_milliseconds`** and Edge max duration.
3. Re-check **`cron.job`** after changes.

**Rough formula:**  
`max_offset_needed ≈ ceil(user_count / limit) * limit` — ensure jobs exist for every `offset` from `0` to `user_count - limit` in steps of `limit` (or adjust if you use a different step).

## Operations notes

- **`pg_net`** stores responses in **`net._http_response`**; **`status_code`** may lag or show timeout even if Edge still completed — confirm in **Edge Functions → `compute-neighbors` → Logs**.
- Atomic swap (`commit_user_neighbors_swap` + staging) avoids leaving users with **zero** `user_neighbors` after a failed rebuild (see migration `20260502120000_user_neighbors_staging_atomic_swap.sql`).
- Repo **`supabase/config.toml`** sets **`verify_jwt = false`** for **`compute-neighbors`** so CLI deploys stay aligned with Dashboard; keep Dashboard and repo in sync.

## Related code

- Edge: `supabase/functions/compute-neighbors/index.ts`
- App invoke + logging: `src/App.jsx` (`runComputeNeighborsNow`)

---
*Update offsets/job count as the eligible user population grows.*
