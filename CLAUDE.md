# Claude Code Instructions — `algorithm/`

Formatting conventions for the `.lang` DSL files in this directory. These extend
the repository-level instructions in `../CLAUDE.md`.

## Request Comment Entries

Each request is documented as a two-line comment: an index line and a
description line. Values in the index line must line up column-for-column above
the matching names in the description line.

```
# 001   1 from I,   1 from C,   1 from J,   4 from K,   1 from P,      1 from R - 130
# 001  (AI_92,      FCA,        PKOP,       Ulytau,     Participant_A,  First)
```

- Index values are left-aligned; each column has a fixed width shared by both
  lines so the value sits directly above its name.
- The opening parenthesis `(` of the description line lives in the prefix
  (`# 001  (`), so the first name aligns with the first value above it.
- The request number in the comment is the original table number; it equals the
  `Z` index (e.g. `001` -> `1 from Z`).

## `requests_i_j_x_k_l_s_l0_q` Structure

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

### Leaf line request number comments

Every leaf line (a `Z`-level assignment) must end with a `# NNN` comment that
gives the request number (the Z index, zero-padded to 3 digits). All `#`
characters across every leaf line in the structure must appear in the same
column. Because tuple widths are uniform (due to P/Z padding) but value widths
vary (2- or 3-digit numbers, with or without a trailing comma), use extra spaces
before `#` to reach the common column:

```
(... 11 from Z) = 65,  # 011
(... 12 from Z) = 65,  # 012
(... 15 from Z) = 65   # 015
(... 1  from Z) = 130  # 001
(... 9  from Z) = 715  # 009
```

- `65,` and `715` occupy the same width (3 chars), so both take 2 spaces before `#`.
- `65` (no comma, 2 chars) takes 3 spaces before `#` to reach the same column.

### Brackets

- The `R`-level wrapper uses curly braces: `... from R) = { ... }`.
- The tuple's own parentheses stay round: `(1 from I, ..., 1 from R)`.

Example:

```
(1 from I, 1 from C, 1 from J, 4 from K, 12 from P) = {
    (1 from I, 1 from C, 1 from J, 4 from K, 12 from P, 1 from R) = {
        (1 from I, 1 from C, 1 from J, 4 from K, 12 from P, 1 from R, 11 from Z) = 65,  # 011
        (1 from I, 1 from C, 1 from J, 4 from K, 12 from P, 1 from R, 12 from Z) = 65   # 012
    }
}
```

## Aggregated Leaf Lines (`sum_by_axes` results)

Leaves produced by summing over an axis (e.g. `requests_i_j_k`,
`requests_i_j`) show the arithmetic inline: the summed values, then the total,
then a `# NNN ...` comment listing every original request number that
contributes:

```
(1 from I, 1 from J, 1 from K) =  70 +  50                                     = 120,   # 110 + 204
(1 from I, 1 from J, 4 from K) = 230 + 325 + 325                               = 880,   # 101 + 102 + 108 + 109
(1 from I, 2 from J, 4 from K) = 100 + 100 +  50 + 130 +  70 +  15 +  35 + 520 = 1020   # 111 + 112 + 113 + 205 + 206 + 208 + 209 + 404
(1 from I, 3 from J, 6 from K)                                                 = 250    # 302
```

### Operand and operator alignment (`+`)

- Each summand is right-aligned to a fixed field width — the maximum summand
  width across the whole block (3 chars above: `715`; 4 chars in `requests_i_j`
  where `1885` appears). This makes every `+` sit in the same column across all
  leaf lines of the block (so a `+` is always directly under another `+`).
- Separators are a single `" + "`; the right-alignment supplies the leading
  space for narrower numbers (` 70` under `715`).

### Result `=` alignment

- The arithmetic expression is left-padded to the widest expression in the
  block, so the result `=` (the `=` before the final total) lines up in one
  column for every summed line — independently of how many summands a line has.
- Single-summand leaves (just one contributing request) have no sum to show, so
  they print only the value after a single `=`. That `=` must sit in the **same
  column** as the result `=` of the summed lines: pad between the tuple's `)` and
  the `=` so the value lands under the totals (see `= 250` above). Every `=` that
  introduces a final number therefore shares one column across the whole block.

### Request-number order

- The request numbers listed in the `# NNN ...` comment are always sorted in
  ascending order (smallest to largest), never in structural or discovery order.
- Where each summand maps one-to-one to a single request (e.g. `requests_i_j_k`,
  where every value is a per-participant subtotal), the value summands are
  reordered together with their request numbers, so the n-th value still sits in
  the same position as the n-th request number (` 65 + 130 + 195 + 260 + 520 +
  715` for `201 + 202 + 301 + 401 + 402 + 403`).
- Where a summand aggregates several requests (e.g. `requests_i_j`, whose values
  are per-region subtotals), the values keep their structural order and only the
  comment's request numbers are sorted ascending.

### `#` alignment

- As elsewhere, all `#` comments line up in one column per block — 2 spaces
  after the longest leaf line. Contributing request numbers are 3 digits, so the
  `+` inside the comments also align automatically.
