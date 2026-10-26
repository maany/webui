---
name: creating-replication-rules
description: Plan and create Rucio replication rules. Use when the user wants to replicate, copy, keep or pin a DID (file, dataset or container) on RSEs, asks for a number of copies somewhere, or wants the create-rule form filled in.
allowed-tools: find_tools list_dids get_did_meta list_did_rules list_rses get_rse_attributes list_account_rse_quotas get_account_quotas navigate read_current_page page_action create_rule search_docs run_sql
---

# Creating replication rules

A replication rule asks Rucio to keep a number of copies of a DID on RSEs chosen by an RSE expression. The rule belongs to the account that creates it. That account is charged quota for every replica the rule locks, even when the data already sits on the RSE and even when another account also has a rule on it.

## 1. Collect the parameters

Ask only for what is missing. Repeat the final values back before acting.

| Parameter | Notes |
| --- | --- |
| DIDs | `scope:name`, one or more. Confirm each exists with `list_dids` (a name pattern plus a `type`: All, Container, Dataset, File or Collection) or `get_did_meta`. |
| RSE expression | Where copies may go. Translate words like "two Tier 1 disks" into an expression and resolve it with `list_rses` so the user sees the matching RSEs. If the syntax is unclear, use `search_docs` for "RSE expressions". An expression that matches no RSE is rejected. |
| Copies | At least 1, and not more than the number of RSEs the expression matches. |
| Lifetime | Optional, in days. Without one the rule never expires. Suggest a lifetime for scratch or user data. |
| Grouping | `ALL`: every file on the same RSE. `DATASET` (Rucio default): files of one dataset stay together, datasets of a container may differ. `NONE`: files are placed independently. |
| Other options | Comment, notify on completion, asynchronous creation (for very large containers; the rule starts in `Inject` and is processed in the background). |

Check `list_did_rules` for the DID first. If the same account already has a rule with the same RSE expression and copies, Rucio rejects a duplicate; tell the user instead of retrying.

## 2. Check quota before creating

Call `list_account_rse_quotas` with the DIDs and the RSE expression. Each row is one RSE:

- `has_quota`: the requested data fits in the account's quota on that RSE.
- `bytes_remaining`: quota left before the rule. `total_expected_usage`: usage after the rule.
- `bytes_limit` of `-1` means unlimited.

Rucio only places copies on RSEs where the account has local quota left and where no global quota that covers the RSE is used up (see `get_account_quotas` for global quotas). If fewer RSEs qualify than the number of copies, creation fails with an insufficient account limit error. Accounts with the `admin` attribute are not limited by quota.

When quota is short, offer these options:

1. Pick an RSE expression where `has_quota` is true.
2. Ask for approval. The rule then waits in `Waiting_Approval` until an approver accepts it, and is created without the quota check once approved. Some RSEs block manual approval; Rucio then rejects the request.
3. Ask an admin to raise the quota.

## 3. Create the rule

Prefer filling the form so the user reviews and submits it:

1. `navigate` to the `rule_create` page. The result lists the page actions that registered.
2. Call `page_action` with the name `rule_create.prefill` and the collected values. Use the input schema the action reports; do not guess field names.
3. Tell the user what you filled in and that they submit the form themselves.

Use `create_rule` only when the user asks you to create the rule directly and the tool is available. It always goes through the approval card unless the user changed their permissions. Never retry a rejected or failed creation without telling the user why it failed.

## 4. After creation

- A new rule starts in `Replicating`, or in `OK` when every replica is already in place.
- Rules on tape RSEs without a lifetime are locked automatically by Rucio.
- Give the user the rule id and offer to open the rule page with `navigate`.

## Pitfalls

- Container rules can be very large. Mention the total size when `get_did_meta` returns it.
- Quota is accounted per rule, not per physical copy, so two users with rules on the same file are both charged.
- If something is unclear, `search_docs` for "replication rules" or "rse expressions" and cite the link.
