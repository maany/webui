---
name: sql-recipes-over-handles
description: Count, group, filter and join Rucio data with SQL over data handles (rules, RSEs, locks, usage, quotas, transfer requests). Use when the user asks how many, how much data, which ones, per RSE, per state, top N, percentages, or anything that needs aggregating rows a list tool returned.
allowed-tools: find_tools list_rules list_did_rules list_rses list_all_rses list_rule_replica_lock_states list_account_rse_usage list_account_rse_quotas list_dataset_replicas list_file_replicas list_requests run_sql refresh_handle search_docs
---

# SQL recipes over Rucio handles

List tools do not put rows in the conversation. They load rows into an in-browser DuckDB table and return a handle: the table name (for example `rules_1`), the row count, the column names, whether the result was truncated, and three sample rows. Query handles with `run_sql`.

## Rules for run_sql

- One `SELECT` or `WITH` statement per call. No writes, no `CREATE`, no `DESCRIBE`.
- Use the handle names and column names the list tool returned. The examples below use `rules_1`, `rses_1` and so on; replace them with the real handle names.
- You receive at most 200 rows plus the total count. Aggregate or add `LIMIT` instead of selecting everything. The user sees the full result table in the panel.
- Pass `save_as` to keep a result as a new handle for later joins.
- If a handle is reported as expired (for example after the conversation was reopened), call `refresh_handle` with it to fetch the rows again.
- If the list tool said `truncated: true`, say that counts are lower bounds.

## Common columns

| Tool | Columns |
| --- | --- |
| `list_rules`, `list_did_rules` | `id`, `scope`, `name`, `account`, `rse_expression`, `created_at`, `remaining_lifetime` (seconds), `state` (`Replicating`, `OK`, `Stuck`, `Suspended`, `Waiting_Approval`, `Inject`), `locks_ok_cnt`, `locks_replicating_cnt`, `locks_stuck_cnt` |
| `list_rses` | `id`, `name`, `rse_type` (`DISK` or `TAPE`), `volatile`, `deterministic`, `staging_area` |
| `list_rule_replica_lock_states` | `scope`, `name`, `rse`, `state` (`O` ok, `R` replicating, `S` stuck), `ddm_link`, `fts_link` |
| `list_account_rse_usage` | `rse`, `rse_id`, `account`, `files`, `used_bytes`, `bytes_limit` (`-1` unlimited) |
| `list_account_rse_quotas` | `rse`, `bytes_limit`, `used_bytes`, `bytes_remaining`, `has_quota`, `total_expected_usage` |
| `list_requests` | `id`, `scope`, `name`, `state` (by default the active states `QUEUED`, `SUBMITTING`, `SUBMITTED`, `WAITING`, `PREPARING`; finished requests move to the request history and are not listed), `activity`, `bytes`, `sourceRse`, `destRse`, `account`, `ruleId`, `retryCount`, `errMsg`, and ISO times `createdAt`, `requestedAt`, `submittedAt`, `startedAt`, `transferredAt` |

Rows may also carry a `status` column from the WebUI; ignore it. Always check the returned column list before writing SQL.

## Recipes

Rules by state:

```sql
SELECT state, count(*) AS rules FROM rules_1 GROUP BY state ORDER BY rules DESC
```

Stuck rules by RSE expression, worst first:

```sql
SELECT rse_expression, count(*) AS rules, sum(locks_stuck_cnt) AS stuck_locks
FROM rules_1 WHERE state = 'Stuck'
GROUP BY rse_expression ORDER BY stuck_locks DESC LIMIT 20
```

Progress of one rule per RSE (lock states handle):

```sql
SELECT rse,
       count(*) FILTER (WHERE state = 'O') AS ok,
       count(*) FILTER (WHERE state = 'R') AS replicating,
       count(*) FILTER (WHERE state = 'S') AS stuck
FROM locks_1 GROUP BY rse ORDER BY stuck DESC
```

Rules expiring within 7 days:

```sql
SELECT id, scope, name, rse_expression, round(remaining_lifetime / 86400.0, 1) AS days_left
FROM rules_1 WHERE remaining_lifetime > 0 AND remaining_lifetime < 7 * 86400
ORDER BY remaining_lifetime
```

Rules created per day (cast first if `created_at` is text):

```sql
SELECT date_trunc('day', CAST(created_at AS TIMESTAMP)) AS day, count(*) AS rules
FROM rules_1 GROUP BY day ORDER BY day
```

Quota use per RSE, in readable units:

```sql
SELECT rse, format_bytes(used_bytes) AS used, format_bytes(bytes_limit) AS limit_, round(100.0 * used_bytes / bytes_limit, 1) AS pct
FROM usage_1 WHERE bytes_limit > 0 ORDER BY pct DESC
```

## Transfers between two RSEs

`list_requests` takes `src_rse` and `dst_rse` (or `src_site` and `dst_site`) and returns one row per file transfer still in progress. By default Rucio lets only admin accounts list requests; if the tool returns a permission error, tell the user instead of retrying.

How much data is in transfer from A to B, by state:

```sql
SELECT state, count(*) AS files, sum(bytes) AS total_bytes, format_bytes(sum(bytes)) AS total
FROM requests_1 GROUP BY state ORDER BY total_bytes DESC
```

Oldest waiting transfers and their errors:

```sql
SELECT scope, name, state, retryCount, errMsg, createdAt
FROM requests_1 WHERE state IN ('QUEUED', 'WAITING') ORDER BY createdAt LIMIT 20
```

Transfers per activity:

```sql
SELECT activity, count(*) AS files, format_bytes(sum(bytes)) AS total FROM requests_1 GROUP BY activity ORDER BY files DESC
```

`bytes` can be empty for some rows; `sum` skips them, so mention when `count(bytes)` is lower than `count(*)`.

## Joining rules to RSEs

A rule's `rse_expression` is an expression, not an RSE name, so it does not join to RSE rows directly.

- When the expressions are plain RSE names, join on the name:
  `SELECT x.rse_type, count(*) FROM rules_1 r JOIN rses_1 x ON r.rse_expression = x.name GROUP BY x.rse_type`
- Otherwise resolve each distinct expression with `list_rses` (one call per expression, ask before running more than about 10), then combine:
  `SELECT 'tier=1' AS rse_expression, name AS rse FROM rses_2 UNION ALL SELECT 'tier=2', name FROM rses_3`
  saved with `save_as` as a mapping handle, and join rules to it on `rse_expression`.
- For where data actually sits, use lock states or replica handles, which carry real `rse` names.

Explain results in words, give the totals, and mention the handle so the user can find the table in the panel.
