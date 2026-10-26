---
name: rse-expression-basics
description: Write, explain and test Rucio RSE expressions such as tier=1&type=DATADISK. Use when the user asks which RSEs an expression matches, how to target a set of storage sites, or why an expression is invalid or matches nothing.
allowed-tools: find_tools list_rses list_all_rses get_rse get_rse_attributes search_docs run_sql navigate read_current_page
---

# RSE expression basics

An RSE expression selects a set of RSEs, for example the destinations of a replication rule. It is made of terms joined by set operators. Rucio resolves it on the server.

## Terms

| Term | Matches | Example |
| --- | --- | --- |
| RSE name | That RSE | `CERN-PROD_DATADISK` |
| `*` | Every RSE | `*` |
| `key=value` | RSEs whose attribute `key` equals `value` | `tier=1`, `type=SCRATCHDISK`, `site=EELA-UNLP` |
| `key` alone | RSEs where the attribute is true | `SPAINSITES` |
| `key<number`, `key>number` | Numeric comparison on an attribute | `freespace>3000` |

Attribute names and values depend on the deployment and the experiment. Never assume one exists: read real attributes with `get_rse_attributes` for a known RSE first. Values are compared exactly, so `country=us` and `country=US` can give different results.

## Operators

- Union, the pipe: `tier=1|tier=2` is every Tier 1 and every Tier 2 RSE.
- Intersection, the ampersand: `tier=1&country=us` is Tier 1 RSEs in the US.
- Complement, the backslash: `cloud=ES\type=SCRATCHDISK` is RSEs in cloud ES that are not scratch disks.

Operators are evaluated left to right; use parentheses to group. `(cloud=IT|cloud=FR)&type=SCRATCHDISK` keeps only scratch disks, while `type=SCRATCHDISK&cloud=IT|cloud=FR` also returns every RSE in cloud FR.

In JSON tool arguments the backslash must be escaped: send `"tier=1\\country=us"` to mean `tier=1\country=us`. In the user's shell, expressions need single quotes so `&`, `|` and `\` are not interpreted.

## Testing an expression

1. Call `list_rses` with the expression. It returns a handle with the matching RSEs.
2. If it fails or returns nothing: an expression must resolve to at least one RSE, so an empty result is an error even when the syntax is right. Check attribute names and values on a sample RSE with `get_rse_attributes`, and check spelling and case.
3. Count or filter the result with `run_sql`, for example
   `SELECT rse_type, count(*) FROM <handle> GROUP BY rse_type`.
4. Show the user the matching RSE names (or the count and a sample when there are many).

## Building an expression from a request

- "Two copies on Tier 1": expression `tier=1`, copies 2.
- "Any UK Tier 2 except Glasgow": `tier=2&country=uk\site=GLASGOW`, after checking those attribute names exist.
- "This one disk": just the RSE name.

Always resolve the final expression with `list_rses` before using it in a rule, and make sure it matches at least as many RSEs as the requested copies. Use `search_docs` for "RSE expressions" to link the documentation.
