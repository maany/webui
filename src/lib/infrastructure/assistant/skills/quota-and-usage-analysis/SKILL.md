---
name: quota-and-usage-analysis
description: Explain and analyse Rucio account quotas and storage usage. Use when the user asks how much quota they have, where they can still write, why a rule fails for quota, which RSEs or accounts are close to their limit, or how local and global quotas combine.
allowed-tools: find_tools list_account_rse_usage get_account_quotas list_account_rse_quotas get_account_info list_accounts list_rses get_rse_usage set_account_limit run_sql refresh_handle navigate read_current_page search_docs
---

# Quota and usage analysis

## How Rucio accounts storage

- Usage is charged to the account that owns the replication rule, for every replica the rule locks. It follows requested replicas, not physical copies: if two accounts have rules on the same file on the same RSE, both are charged.
- A local quota (account limit) is set per RSE. No limit on an RSE means no quota there: the account cannot place new rule replicas on it.
- A global quota is set on an RSE expression and caps the combined usage of all RSEs the expression matches.
- When a rule is created or re-evaluated, an RSE is only eligible if the account has local quota left on it and every global quota whose expression covers the RSE still has room. If fewer RSEs are eligible than the requested copies, the rule fails with an insufficient account limit error.
- Accounts with the `admin` attribute are not limited by quotas.
- A rule created with "ask approval" skips the quota check once approved.

## Tools and fields

| Tool | Returns |
| --- | --- |
| `list_account_rse_usage` | Rows for the current account, one per RSE: `rse`, `used_bytes`, `bytes_limit`, `files`. Use `run_sql` on the handle. |
| `get_account_quotas` | One account's `local` list (`rse`, `bytesLimit`, `bytesUsed`, `bytesRemaining`, `files`) and `global` list (`rseExpression`, `resolvedRses`, `bytesLimit`, `bytesUsed`, `bytesRemaining`). `bytesLimit` is `-1` when unlimited and `null` when no limit is set. Users can read their own account; admins can read any account. |
| `list_account_rse_quotas` | For given DIDs and an RSE expression: per RSE `has_quota`, `bytes_remaining`, `total_expected_usage`. Use it to check whether a planned rule fits. |
| `get_rse_usage` | Usage of an RSE as a whole (all accounts), useful to tell a full disk from a full quota. |

`bytes_limit` of `-1` means unlimited. Treat `0` or a missing limit as no quota on that RSE.

## Recipes

Where can I still write?

```sql
SELECT rse, format_bytes(bytes_limit - used_bytes) AS free, round(100.0 * used_bytes / bytes_limit, 1) AS pct_used
FROM <usage handle>
WHERE bytes_limit > 0 AND used_bytes < bytes_limit
ORDER BY bytes_limit - used_bytes DESC
```

RSEs above 90 percent of quota:

```sql
SELECT rse, used_bytes, bytes_limit, round(100.0 * used_bytes / bytes_limit, 1) AS pct_used
FROM <usage handle>
WHERE bytes_limit > 0 AND used_bytes >= 0.9 * bytes_limit
ORDER BY pct_used DESC
```

Global quotas: read `global` from `get_account_quotas` and compare `bytesUsed` with `bytesLimit`. A global quota at its limit blocks every RSE in `resolvedRses`, even when local quota is left there.

Which accounts are over 90 percent (admins): `list_accounts`, then `get_account_quotas` per account. This is one call per account, so confirm the scope first and stop at about 20 accounts unless the user asks for more.

## Answering

- Give sizes in human units (`format_bytes` in SQL, or TB/GB in text) and say which account the numbers are for.
- Separate "the RSE is full" (`get_rse_usage`) from "your quota is used up" (account usage).
- To raise a quota the user needs an admin. If the user is an admin and the write tools are enabled, `find_tools` can load `set_account_limit`; it always asks for approval.
- Cite the documentation with `search_docs` ("accounting and quota") when explaining concepts.
