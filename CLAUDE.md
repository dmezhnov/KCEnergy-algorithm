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

The nested structure is grouped by `(I, C) -> J -> X -> K -> P -> R -> Z`.
Multiple requests that share the same `(I, C, J, X, K, P, R)` path are listed
together as several `Z` leaves under one node.

### Index number padding

Multi-digit index numbers are padded to width 2, left-aligned (digit followed by
a space), matching the existing `from Y` convention in the `volumes` structure:

```
1  from P    # single digit padded
13 from P    # two digits
```

Only `P` (1–21), `Z` (1–39) and `Y` reach two digits, so only they are padded;
the other indices are always single-digit.

The width belongs to the **axis across the whole file**, not to the block: a
block that happens to hold single-digit participants only still writes
`1  from P`, because `P` itself reaches 21. Definition headers are outside the
rule — `requests_i_j_k_l_queue(1  from R)` in `step-1.example_*.lang` pads its
index to line up with the family head `(l0 for  R)` above it, which is a
different alignment.

### Alignment

- Padding makes every tuple on a given nesting level the same width, so the
  closing `)` of the tuple and the `=` before the final number line up.
- Closing brackets align per nesting level — each closing bracket sits under the
  start of the line that opened it (root `}` at column 0, `(I, C)` at column 4,
  `J` at 8, `X` at 12, `K` at 16, `P` at 20, `R` at 24).

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

- Each summand occupies a fixed field width — the maximum summand width across
  the whole block (3 chars above: `715`; 4 chars in `requests_i_j` where `1885`
  appears; 21 chars in `requests_i_j_corrected(1 from R)` of
  `step-4.example_2.lang`, where a summand is a truncated fraction). This makes
  every `+` sit in the same column across all leaf lines of the block (so a `+`
  is always directly under another `+`).
- Separators are a single `" + "`; the padding inside the field supplies the rest.
  Most blocks pad on the left (` 70` under `715`); `volumes_l_i_k` in
  `step-3.1.0.example_*.lang` pads on the right (`90  + 80  +`). Either is fine —
  what the convention fixes is the column of the `+`, not the side the spaces sit
  on. Do not reformat a block just to flip its padding.
- An operand position written by only one leaf of the block has nothing to line up
  with and is unconstrained: in the example above the 3rd summand exists on a
  single line, so its `+` answers to no other.

### Result `=` alignment

- The arithmetic expression is left-padded to the widest expression in the
  block, so the result `=` (the `=` before the final total) lines up in one
  column for every summed line — independently of how many summands a line has.
- Single-summand leaves (just one contributing request) have no sum to show, so
  they print only the value after a single `=`. That `=` must sit in the **same
  column** as the result `=` of the summed lines: pad between the tuple's `)` and
  the `=` so the value lands under the totals (see `= 250` above). Every `=` that
  introduces a final number therefore shares one column across the whole block.
- This holds for the deep structures too, not only for the flat two- and
  three-axis ones: in `requests_i_j_k_l_l0` and `requests_i_j_k_l_s_l0` of
  `step-minus-1.example_*.lang` most leaves carry a single request, and they pad
  between `)` and `=` to meet the four leaves that do show a sum.

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
- A comment may carry two groups of numbers separated by `=` — the requests of
  the source matrix on the left, the aggregated request numbers on the right
  (`# 001 + 002 + 003 + 004 = 101 + 102` in `step-minus-1.example_1.lang`). Each
  group is sorted on its own; the right-hand group starting lower than the
  left-hand one is normal.

### `#` alignment

- As elsewhere, all `#` comments line up in one column per block — 2 spaces
  after the longest leaf line. Contributing request numbers are 3 digits, so the
  `+` inside the comments also align automatically.

## Import Headers

A file opens with its imports, one per line, and every `from` sits in the same
column — one space behind the longest name list:

```
sum_by_axes                      from ("matrix_operation.lang")
requests_i_j_k_l_corrected       from ("step-3.2.2.example_2.lang")
requests_i_j_k_l_corrected_queue from ("step-10.example_2.lang")
```

The header ends at the first blank line. Not every file has one:
`initial_data.example_*.lang` opens with an enumeration and `lang.lang` with the
language's own axioms — those have nothing to align.

### Order of the sources

The `from core` imports come first, and the imports of one source stay
together. A name is imported on its own line, so one source may take several
lines (`matrix_operation.lang` three times in `step-n-plus-1.lang`); what the
convention forbids is interleaving them with another source's. The order of the
file sources among themselves is free — it follows the step order of the
algorithm, not the alphabet.

### What a header may name

Every name an import line takes from a file must be **defined by that file** —
`unresolved-import` resolves the source next to the importing file and looks for
a top-level line that introduces the name (`name(args) = …`, `name of <type>`,
`name from <category>`, `name = …`).

Every imported name must also be **used in the body** of the importing file. A
mention in a comment does not count: an import states what the definitions below
are built from, and a comment builds nothing.

## An Example Follows Its Step File

A `step-N.example_K.lang` is the worked example of `step-N.lang`, and the
vocabulary of the step is the vocabulary of the example — a name the step file
defines may be referenced by the example even where the example does not expand
it (`requests_i_j_x_k_l_s_l0_q_allocated` in `step-n-plus-1.example_*.lang`).

Where both files define the same variable, the example applies the **same matrix
operation with the same number of arguments**. Three shapes are legitimately
different and are not compared:

- an **expansion of a family** carries no expression at all — the call is
  written once on the family head (`requests_i_j_k_l_queue(l0 for  R) = …`) and
  the expansions below it only hold leaves;
- `= {}` — the empty matrix of a queue that distributed nothing — is a literal,
  not a call;
- a step call with an **ellipsis** argument (`assign_matrix(a(1), ..., a(n))`)
  is expanded by the example into as many arguments as its data set holds, so
  only the primitive is compared, not the arity.

A constant the example replaces by its value
(`MIN_NEXT_AVAIL_TONNAGE(1 from R) = 4` against the step's
`= OIL_TERMINAL_MIN_TONNAGE`) is outside the rule too: only definitions the step
writes as a call to a matrix operation are compared.

### Coordinates are not variables

The index letters of `matrix_types.lang` (`I`, `R`, `Z`, …) and the members of
every top-level enumeration (`Queue = First, Second, …`,
`stepNullAxes from Product = AI_92, …`) form one vocabulary shared by the whole
tree: a file writes `FCA` or `1 from R` without importing anything. Only
variables are resolved per file.

## File-Level Layout

- **Every file ends with a newline.**
- **At most one blank line in a row.** One blank line separates a definition,
  a section comment or the import header from what follows; two in a row are a
  typo, not a wider section break.

## `where` Declarations

Inside a `where` block the declarations line up their keyword. A run is the
consecutive lines of one block, at one indentation, declaring **one** category;
each run is aligned on its own, which is why an `of number` run and the
`of matrix(...)` run below it normally sit in different columns:

```
    where
        ship_terms_count_by_requests_l0(i, j, k, l, l0) of number
        requests_i_j_k_l_s_l0(i, j, k, l, s, l0)        of number
        ship_terms_count_by_requests_l0 of matrix(Product, Refinery, Region, Market_participant, Queue)
        requests_i_j_k_l_s_l0           of matrix(Product, Refinery, Region, Market_participant, Ship_terms, Queue)
        "=" from condition
            where
                Product, Refinery, Region, Market_participant, Queue from axis
                i  for I  from index # Индексы нефпродукта
                l0 for R  from index # Индексы очереди
```

- The keyword is `of` (`<names> of <type>`) or `from` (`<names> from
  <category>`); the `for` of `i  for I  from index` is aligned too, over the
  lines of the run that write one. A run may mix `R from index` with
  `i  for I  from index` — those align by their `from`.
- A `from` written inside a name — the `(1 from R)` of `available_i_j(1 from R)`
  — is not the keyword, and the guards and expansions that also live in `where`
  blocks (`l0 > 2`, `is_empty(...) = true`, `a(1), ..., a(N) => a(i)`) are not
  declarations at all.
- Padding **after** the keyword is free: `n  of          index` pads so that its
  `index` ends where the `from index` of the lines below does, which is what
  lines up their `#` comments. The rule fixes the column of the keyword, not of
  the type behind it.

### Comments inside a `where` block

The inline comments of a `where` block line up their `#` over the same runs the
keyword uses — one block, one indentation, one category. Almost everywhere the
declarations of a run are the same width, so a single space before `#` already
lines them up; where they are not, the shorter lines pad up to the longest one:

```
        volumes_l_t_i_k_positive of matrix(Market_participant, Product, Region, Month_and_year) # Проливы только за активные месяцы
        matrix_of_activity       of matrix(Market_participant, Product, Region)                 # Число активных месяцев
```

- A declaration **without** a comment splits the run: a block is commented in
  stretches, and each stretch lines up on its own.
- A declaration whose type carries an initializer (`m of index = 1, ..., D`) is
  not one of these runs — neither rule of this section sees it, the same way the
  keyword rule does not.
