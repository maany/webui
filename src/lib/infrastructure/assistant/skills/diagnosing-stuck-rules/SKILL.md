---
name: diagnosing-stuck-rules
description: Find out why a Rucio replication rule is stuck, suspended or slow, and what the user can do about it. Use when the user asks why a rule is stuck, not progressing, still replicating, suspended, or wants stuck rules summarised by RSE.
allowed-tools: find_tools get_rule list_rules list_did_rules list_rule_replica_lock_states list_file_replicas get_rse get_rse_attributes get_rse_usage get_fts_link list_requests navigate read_current_page run_sql refresh_handle search_docs
---

# Diagnosing stuck rules

## Rule and lock states

A rule holds one lock per file and per RSE copy. The rule state follows its locks.

| Rule state | Meaning |
| --- | --- |
| `Replicating` | Some locks are still waiting for transfers. |
| `OK` | Every lock is satisfied. |
| `Stuck` | At least one lock failed and needs repair. |
| `Suspended` | Rucio gave up: a rule that stays stuck for more than 14 days is suspended by the judge-repairer. |
| `Waiting_Approval` | Created with "ask approval"; nothing moves until an approver accepts it. |
| `Inject` | Created asynchronously; the judge-injector has not processed it yet. |

Lock rows from `list_rule_replica_lock_states` have `state` codes: `O` = OK, `R` = replicating, `S` = stuck.

## Why rules get stuck

The judge-repairer daemon retries stuck rules and resubmits transfers. Typical causes:

1. Transfers keep failing (destination storage errors, bad source file, network or FTS problems).
2. No usable source replica: the file is not available on any RSE, or only on tape that cannot be staged.
3. The RSE expression no longer matches enough RSEs, an RSE is blocked for writes, or the account ran out of quota when Rucio re-evaluated the rule.
4. Replicas declared bad and not recoverable.

The WebUI API does not return Rucio's rule error text, so reason from lock states, RSEs and transfer links.

## Steps for one rule

1. `get_rule` with the rule id: note state, `locks_ok_cnt` / `locks_replicating_cnt` / `locks_stuck_cnt`, RSE expression, account and `updated_at`.
2. If the state is `Waiting_Approval` or `Inject`, explain that state and stop: it is not a transfer problem.
3. `list_rule_replica_lock_states` for the rule. It returns a handle. Group stuck locks by RSE with `run_sql`:
   `SELECT rse, state, count(*) AS locks FROM <handle> GROUP BY rse, state ORDER BY locks DESC`
4. For the RSE with most stuck locks: `get_rse` (availability for read, write and delete) and `get_rse_usage` (is it full?). An RSE that is not available for writes or has no free space explains stuck locks on it.
5. Take two or three stuck files and check their sources with `list_file_replicas`. No available replica elsewhere means Rucio cannot copy the file.
6. Lock rows carry `fts_link`. Offer one or two links so the user can read the transfer error in FTS.
7. If `list_requests` is available (load it with `find_tools`; Rucio lets only admin accounts list requests by default), list the requests from a source RSE to the stuck RSE and look at `state`, `retryCount` and `errMsg` with `run_sql`. Without a known source, skip this step.
8. Summarise: what is stuck, where, the most likely cause, and who can fix it.

## Steps for "how many rules are stuck"

1. `list_rules` with the state filter `Stuck` (add an account filter if the user asked about one account).
2. `run_sql` on the handle, for example
   `SELECT rse_expression, count(*) AS rules, sum(locks_stuck_cnt) AS stuck_locks FROM <handle> GROUP BY rse_expression ORDER BY stuck_locks DESC`
3. A rule's RSE expression is not an RSE name. To break down by RSE, list lock states for the few worst rules, or resolve expressions with `list_rses` (see the `sql-recipes-over-handles` skill).

## What the user can do

- Wait: the repairer retries for up to 14 days before suspending.
- Storage or transfer problems on a site: report the rule id, the RSE and an FTS link to the site or Rucio operators.
- Wrong destination: create a new rule with a better RSE expression; the stuck rule can be removed once the new one is OK. Never delete or change a rule without the user's explicit request.
- Quota problems: see the `quota-and-usage-analysis` skill.

Use `search_docs` for "stuck rule" or "judge repairer" to cite the documentation.
