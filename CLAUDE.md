# Claude Code Instructions — `algorithm/`

Formatting conventions for the `.lang` DSL files in this directory. These extend
the repository-level instructions in `../CLAUDE.md`.

## Request Comment Entries

Each request is documented as a two-line comment: an index line and a
description line. Values in the index line must line up column-for-column above
the matching names in the description line.

```
# 001   1 from I,   1 from C,   1 from J,   4 from K,   1 from P,      1 from R - 130
# 001  (AI_92,      FCA,        PKOP,       Ulytau,     Paricipant_A,  First)
```

- Index values are left-aligned; each column has a fixed width shared by both
  lines so the value sits directly above its name.
- The opening parenthesis `(` of the description line lives in the prefix
  (`# 001  (`), so the first name aligns with the first value above it.
- The request number in the comment is the original table number; it equals the
  `Z` index (e.g. `001` -> `1 from Z`).

## `requests_i_j_k_l_s_l0_q` Structure

The nested structure is grouped by `(I, C) -> J -> K -> P -> R -> Z`. Multiple
requests that share the same `(I, C, J, K, P, R)` path are listed together as
several `Z` leaves under one node.

### Index number padding

Multi-digit index numbers are padded to width 2, left-aligned (digit followed by
a space), matching the existing `from Y` convention in the `volumes` structure:

```
1  from P    # single digit padded
13 from P    # two digits
```

Only `P` (1–21) and `Z` (1–39) reach two digits, so only they are padded; the
other indices are always single-digit.

### Alignment

- Padding makes every tuple on a given nesting level the same width, so the
  closing `)` of the tuple and the `=` before the final number line up.
- Closing brackets align per nesting level — each closing bracket sits under the
  start of the line that opened it (root `}` at column 0, `(I, C)` at column 4,
  `J` at 8, `K` at 12, `P` at 16, `R` at 20).

### Brackets

- The `R`-level wrapper uses curly braces: `... from R) = { ... }`.
- The tuple's own parentheses stay round: `(1 from I, ..., 1 from R)`.

Example:

```
(1 from I, 1 from C, 1 from J, 4 from K, 12 from P) = {
    (1 from I, 1 from C, 1 from J, 4 from K, 12 from P, 1 from R) = {
        (1 from I, 1 from C, 1 from J, 4 from K, 12 from P, 1 from R, 11 from Z) = 65,
        (1 from I, 1 from C, 1 from J, 4 from K, 12 from P, 1 from R, 12 from Z) = 65
    }
}
```
