import {readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// Linter for the `.lang` DSL files in `algorithm/`.
//
// One member line of a bracketed list, tracked for comment-column alignment.
// `column` is the 1-based position of its `#`; `contentEnd` is the 1-based
// column of the last non-space character before that `#`.
type AlignmentEntry = {
    lineNumber: number;
    column: number;
    contentEnd: number;
};

// The set of rule identifiers the linter can emit. Used both for reporting and
// as the keys of the per-rule enable map in the config file.
type RuleName =
    | 'trailing-whitespace'
    | 'space-before-comment'
    | 'space-after-hash'
    | 'comment-alignment'
    | 'unresolved-call';

// Linter configuration, loaded from `.lang-lint.json` at the project root. Each
// rule can be switched off independently; a disabled rule produces no findings.
type LangLintConfig = {
    rules: Record<RuleName, boolean>;
};

// The config file name searched for, relative to the current working directory
// (the directory `mise run lint` runs in — the `algorithm/` project root).
const CONFIG_FILE_NAME = '.lang-lint.json';

// Core primitives that are always in scope without an explicit import — the
// built-in types and the element-wise operators listed in `matrix_types.lang`'s
// `operation`/`condition` enumerations. Names used in call position that resolve
// to one of these are never flagged by `unresolved-call`.
const BUILTIN_NAMES: ReadonlySet<string> = new Set([
    // Built-in types.
    'matrix',
    'number',
    'index',
    'coordinate',
    'axis',
    'condition',
    'operation',
    'length',
    // The language's self-reference keyword (`() = this = this()`).
    'this',
    // Element-wise operators (the `operation` enumeration).
    'min',
    'max',
    'round',
    'floor',
    'safe_divide',
    // Comparison operators (the `condition` enumeration).
    'contains',
    'not_contains',
]);

// This is the shared entry point for all `.lang` lint rules. The current rules
// cover comment whitespace and comment-column alignment; further rule groups
// (request-comment alignment, structure padding, aggregated leaf lines) are
// meant to be added as extra methods on this class.
class LangLinter {
    // A single rule violation, reported as `path:line:col: rule message`.
    private readonly problems: Array<{
        file: string;
        line: number;
        column: number;
        rule: string;
        message: string;
    }> = [];

    // The active configuration. Initialised to the built-in defaults (every rule
    // on) and replaced by `loadConfig()` at the start of `run()`.
    private config: LangLintConfig = LangLinter.defaultConfig();

    // Run the linter over the given paths (files or directories). With no
    // arguments, lints every `.lang` file in the current working directory.
    run(args: string[]): number {
        this.config = this.loadConfig();

        const targets = args.length ? args : ['.'];
        const files = this.collectLangFiles(targets);

        if (!files.length) {
            process.stderr.write('No .lang files found to lint.\n');
            return 1;
        }

        for (const file of files) {
            this.lintFile(file);
        }

        return this.report(files.length);
    }

    // The built-in configuration: every rule enabled. This is the behaviour when
    // no config file is present, and the base that the file's rules merge onto.
    private static defaultConfig(): LangLintConfig {
        return {
            rules: {
                'trailing-whitespace': true,
                'space-before-comment': true,
                'space-after-hash': true,
                'comment-alignment': true,
                'unresolved-call': true,
            },
        };
    }

    // Load `.lang-lint.json` from the current working directory, merging its
    // `rules` map over the defaults. A missing file means "use defaults"; an
    // unreadable or malformed file is reported and the defaults are kept, so a
    // broken config never silently suppresses every rule.
    private loadConfig(): LangLintConfig {
        const defaults = LangLinter.defaultConfig();
        const configPath = path.join(process.cwd(), CONFIG_FILE_NAME);

        let raw: string;
        try {
            raw = readFileSync(configPath, 'utf8');
        } catch {
            return defaults; // No config file: every rule stays on.
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            process.stderr.write(`Ignoring ${CONFIG_FILE_NAME}: invalid JSON (${reason}).\n`);
            return defaults;
        }

        return this.mergeConfig(defaults, parsed);
    }

    // Merge a parsed config object over the defaults. Anything unexpected — a
    // non-object root, a non-object `rules`, an unknown rule name, or a
    // non-boolean value — is reported and skipped, leaving the corresponding
    // default in place.
    private mergeConfig(defaults: LangLintConfig, parsed: unknown): LangLintConfig {
        if (typeof parsed !== 'object' || parsed === null) {
            process.stderr.write(`Ignoring ${CONFIG_FILE_NAME}: expected a JSON object.\n`);
            return defaults;
        }

        const rulesValue = (parsed as {rules?: unknown}).rules;

        if (rulesValue === undefined) {
            return defaults;
        }

        if (typeof rulesValue !== 'object' || rulesValue === null) {
            process.stderr.write(`Ignoring ${CONFIG_FILE_NAME} "rules": expected an object.\n`);
            return defaults;
        }

        const merged: LangLintConfig = {rules: {...defaults.rules}};

        for (const [name, value] of Object.entries(rulesValue)) {
            if (!(name in merged.rules)) {
                process.stderr.write(`Ignoring unknown rule "${name}" in ${CONFIG_FILE_NAME}.\n`);
            } else if (typeof value !== 'boolean') {
                process.stderr.write(`Ignoring rule "${name}" in ${CONFIG_FILE_NAME}: expected a boolean.\n`);
            } else {
                merged.rules[name as RuleName] = value;
            }
        }

        return merged;
    }

    // Expand the requested targets into a sorted, de-duplicated list of
    // `.lang` files. Directories are scanned one level deep; explicit files are
    // taken as-is.
    private collectLangFiles(targets: string[]): string[] {
        const found = new Set<string>();

        for (const target of targets) {
            const resolved = path.resolve(target);
            const stats = this.tryStat(resolved);

            if (!stats) {
                process.stderr.write(`Path not found: ${target}\n`);
                continue;
            }

            if (stats.isDirectory()) {
                for (const entry of readdirSync(resolved)) {
                    if (entry.endsWith('.lang')) {
                        found.add(path.join(resolved, entry));
                    }
                }
            } else if (resolved.endsWith('.lang')) {
                found.add(resolved);
            } else {
                process.stderr.write(`Skipping non-.lang path: ${target}\n`);
            }
        }

        return [...found].sort((a, b) => a.localeCompare(b));
    }

    // Stat a path, returning undefined instead of throwing when it is missing.
    private tryStat(target: string): ReturnType<typeof statSync> | undefined {
        try {
            return statSync(target);
        } catch {
            return undefined;
        }
    }

    // Apply every comment-whitespace rule to a single file.
    private lintFile(file: string): void {
        const text = readFileSync(file, 'utf8');
        const lines = text.split('\n');

        lines.forEach((line, index) => {
            const lineNumber = index + 1;
            this.checkTrailingWhitespace(file, lineNumber, line);
            this.checkCommentSpacing(file, lineNumber, line);
        });

        if (this.config.rules['comment-alignment']) {
            this.checkCommentAlignment(file, lines);
        }

        if (this.config.rules['unresolved-call']) {
            this.checkUnresolvedCalls(file, lines);
        }
    }

    // Rule `trailing-whitespace`: no spaces or tabs at the end of a line.
    private checkTrailingWhitespace(file: string, lineNumber: number, line: string): void {
        const match = /[ \t]+$/.exec(line);

        if (match) {
            this.add(file, lineNumber, match.index + 1, 'trailing-whitespace', 'trailing whitespace');
        }
    }

    // Rules `space-after-hash` and `space-before-comment`: a comment opener
    // (the first `#` on a line) must be followed by a space — after any run of
    // leading `#`, as in `##`/`###` headers — and, when it follows code on the
    // same line, must be separated from that code by whitespace.
    private checkCommentSpacing(file: string, lineNumber: number, line: string): void {
        const hashIndex = line.indexOf('#');

        if (hashIndex === -1) {
            return;
        }

        const beforeChar = hashIndex > 0 ? line[hashIndex - 1] : '';
        const isInline = line.slice(0, hashIndex).trim().length > 0;

        if (isInline && beforeChar !== ' ' && beforeChar !== '\t') {
            this.add(file, lineNumber, hashIndex + 1, 'space-before-comment', 'missing space before inline comment');
        }

        // Skip over the run of consecutive `#` so headers like `###` pass.
        let afterRun = hashIndex;
        while (afterRun < line.length && line[afterRun] === '#') {
            afterRun += 1;
        }

        const followingChar = afterRun < line.length ? line[afterRun] : '';

        if (followingChar !== '' && followingChar !== ' ') {
            this.add(file, lineNumber, afterRun + 1, 'space-after-hash', "missing space after '#'");
        }
    }

    // Rule `comment-alignment`: the comment `#` on the member lines of a
    // bracketed list must all sit in the same column. Scope is deliberately
    // narrow — only lines *inside* a `(`/`{`/`[` group (bracket depth > 0 at the
    // start of the line) are considered. This catches list members such as
    //   Region = (
    //       Almaty,   # ...
    //       Shimkent, # ...   <- must align with its siblings
    //   )
    // and the leaf lines of the requests structure, while excluding group-opener
    // label comments (`X = ( # K`, depth 0 at line start) and the "soft" inline
    // comments inside `where` blocks (also depth 0), which are not required to
    // line up. A blank line, a comment-less line, or any line that opens/closes a
    // bracket breaks the run, so each member list is checked on its own.
    private checkCommentAlignment(file: string, lines: string[]): void {
        let run: AlignmentEntry[] = [];
        let depth = 0;

        const flush = (): void => {
            this.reportAlignmentRun(file, run);
            run = [];
        };

        lines.forEach((line, index) => {
            const depthAtStart = depth;
            depth = Math.max(0, depth + this.bracketDelta(line));

            const hashIndex = line.indexOf('#');
            const column = this.inlineCommentColumn(line);

            // Only consecutive member lines of one bracketed list form a block.
            // Anything else — a line outside brackets, or a comment-less
            // structural line (group opener/closer) — ends the current block, so
            // each list and each nesting level is checked on its own.
            if (depthAtStart > 0 && column !== undefined) {
                run.push({
                    lineNumber: index + 1,
                    column,
                    contentEnd: line.slice(0, hashIndex).replace(/\s+$/, '').length,
                });
            } else {
                flush();
            }
        });

        flush();
    }

    // Rule `unresolved-call`: every identifier used in call position (`name(`)
    // must resolve to something in scope — a built-in primitive, an imported
    // name, a locally defined name, a parameter of a definition header, or a
    // name bound inside a `where` block. A call to anything else is flagged as a
    // missing import or typo. This is the narrowest slice of "no use of
    // unimported identifiers": only call sites are checked here.
    private checkUnresolvedCalls(file: string, lines: string[]): void {
        const known = this.collectKnownNames(lines);
        const callPattern = /([A-Za-z_]\w*)\(/g;

        lines.forEach((line, index) => {
            const code = this.stripCode(line);

            let match: RegExpExecArray | null;
            while ((match = callPattern.exec(code)) !== null) {
                const name = match[1];

                if (BUILTIN_NAMES.has(name) || known.has(name)) {
                    continue;
                }

                this.add(
                    file,
                    index + 1,
                    match.index + 1,
                    'unresolved-call',
                    `call to '${name}' is neither imported nor defined`,
                );
            }
        });
    }

    // Build the set of names a call may legitimately resolve to within one file:
    // imported names, locally defined names, the parameters of definition
    // headers, and names bound inside `where` blocks. The set is deliberately
    // generous — every binding form contributes — so the rule reports only calls
    // that resolve to nothing at all.
    private collectKnownNames(lines: string[]): Set<string> {
        const known = new Set<string>();

        for (const line of lines) {
            const code = this.stripCode(line);

            if (code.trim().length === 0) {
                continue;
            }

            this.addImportedNames(line, known);
            this.addDefinedName(line, code, known);
            this.addEnumerationMembers(code, known);
            this.addHeaderParameters(code, known);
            this.addWhereBoundNames(line, code, known);
        }

        return known;
    }

    // Names brought in by a top-of-file import line: `A, B from core` or
    // `A, B from ("file.lang")`. Matched on the raw line because the source is a
    // string literal that `stripCode` would blank out. `from`-bindings inside
    // `where` blocks never use `core`/`("…")` as their source, so this pattern
    // does not pick them up.
    private addImportedNames(line: string, known: Set<string>): void {
        const match = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+from\s+(?:core|\(".*?"\))\s*$/.exec(line);

        if (!match) {
            return;
        }

        for (const part of match[1].split(',')) {
            const id = this.leadingIdentifier(part);
            if (id) {
                known.add(id);
            }
        }
    }

    // The name introduced by a top-level definition: the leading identifier of
    // any line that starts in column 0 with a letter (`requests_i_j = …`,
    // `sum_by_axes(…) = …`, `is_empty(…)`). Indented lines are handled as
    // `where` bindings instead.
    private addDefinedName(rawLine: string, code: string, known: Set<string>): void {
        if (!/^[A-Za-z_]/.test(code)) {
            return;
        }

        const id = this.leadingIdentifier(code);
        if (id) {
            known.add(id);
        }
    }

    // The members of a top-level enumeration definition. In this DSL a list
    // definition such as `Queue = First, Second, Third` or `operation = "*",
    // min, max` introduces each right-hand member as a name in its own right. A
    // member is captured only from a segment that is a bare comma-separated list
    // of identifiers (string literals are already blanked by `stripCode`); a
    // segment containing brackets is an expression — e.g. `sum_by_axes(…)` — and
    // is skipped, so the function it calls is not mistaken for a definition.
    private addEnumerationMembers(code: string, known: Set<string>): void {
        if (!/^[A-Za-z_]/.test(code)) {
            return;
        }

        for (const segment of code.split('=')) {
            if (!/^[\sA-Za-z0-9_,]+$/.test(segment)) {
                continue;
            }

            for (const part of this.splitTopLevel(segment)) {
                const id = this.leadingIdentifier(part);
                if (id) {
                    known.add(id);
                }
            }
        }
    }

    // The parameter names of a definition header `name(params) = …`. These are
    // in scope throughout the definition body (e.g. `matrix(Tcoords(1), …)` makes
    // `Tcoords` usable below). Only a header whose closing `)` is followed by `=`
    // counts, so plain indexing such as `requests(l0)(i, …) of …` is excluded.
    private addHeaderParameters(code: string, known: Set<string>): void {
        if (!/^\s*[A-Za-z_]\w*\(/.test(code)) {
            return;
        }

        const open = code.indexOf('(');
        const close = this.matchingParen(code, open);

        if (close === -1) {
            return;
        }

        if (!code.slice(close + 1).trimStart().startsWith('=')) {
            return;
        }

        for (const part of this.splitTopLevel(code.slice(open + 1, close))) {
            const id = this.leadingIdentifier(part);
            if (id) {
                known.add(id);
            }
        }
    }

    // Names bound on the left of a `where`-clause line — everything before the
    // first binding keyword (`for`, `from`, `of`) or top-level `=`. Handles the
    // single-name forms (`R from Queue`, `M of index`, `Tcoords = …`) and the
    // comma lists (`Product, Refinery, … from axis`). Only indented lines are
    // considered; column-0 lines are top-level definitions.
    private addWhereBoundNames(rawLine: string, code: string, known: Set<string>): void {
        if (!/^\s/.test(rawLine)) {
            return;
        }

        const keyword = /\sfor\s|\sfrom\s|\sof\s|\s=\s/.exec(code);
        const prefix = keyword ? code.slice(0, keyword.index) : code;

        for (const part of this.splitTopLevel(prefix)) {
            const id = this.leadingIdentifier(part);
            if (id) {
                known.add(id);
            }
        }
    }

    // The index of the `)` that closes the `(` at `open`, or -1 if unbalanced.
    private matchingParen(code: string, open: number): number {
        let depth = 0;

        for (let i = open; i < code.length; i += 1) {
            const char = code[i];

            if (char === '(') {
                depth += 1;
            } else if (char === ')') {
                depth -= 1;
                if (depth === 0) {
                    return i;
                }
            }
        }

        return -1;
    }

    // Split a comma-separated list, ignoring commas nested inside brackets so
    // that `Tcoords(1), ..., Tcoords(C)` yields three top-level items.
    private splitTopLevel(text: string): string[] {
        const parts: string[] = [];
        let depth = 0;
        let start = 0;

        for (let i = 0; i < text.length; i += 1) {
            const char = text[i];

            if (char === '(' || char === '[' || char === '{') {
                depth += 1;
            } else if (char === ')' || char === ']' || char === '}') {
                depth -= 1;
            } else if (char === ',' && depth === 0) {
                parts.push(text.slice(start, i));
                start = i + 1;
            }
        }

        parts.push(text.slice(start));
        return parts;
    }

    // The first identifier in a segment, or undefined when it holds none (e.g.
    // the `...` ellipsis or a bare `(1)`).
    private leadingIdentifier(segment: string): string | undefined {
        const match = /[A-Za-z_]\w*/.exec(segment);
        return match ? match[0] : undefined;
    }

    // Drop a line's inline comment and blank out string literals (replacing each
    // with equal-width spaces so reported columns stay accurate), leaving only
    // the code in which identifiers are matched.
    private stripCode(line: string): string {
        const hashIndex = line.indexOf('#');
        const code = hashIndex === -1 ? line : line.slice(0, hashIndex);
        return code.replace(/"[^"]*"/g, (literal) => ' '.repeat(literal.length));
    }

    // The net change in bracket nesting contributed by a line's code, ignoring
    // any inline comment (which may itself contain brackets, e.g. `(FCA)`).
    private bracketDelta(line: string): number {
        const hashIndex = line.indexOf('#');
        const code = hashIndex === -1 ? line : line.slice(0, hashIndex);

        let delta = 0;
        for (const char of code) {
            if (char === '(' || char === '{' || char === '[') {
                delta += 1;
            } else if (char === ')' || char === '}' || char === ']') {
                delta -= 1;
            }
        }

        return delta;
    }

    // The 1-based column of the comment opener on an inline-comment line, or
    // undefined when the line carries no inline comment (no `#`, or a `#` that
    // starts the line and is therefore a full-line comment).
    private inlineCommentColumn(line: string): number | undefined {
        const hashIndex = line.indexOf('#');

        if (hashIndex <= 0) {
            return undefined;
        }

        const isInline = line.slice(0, hashIndex).trim().length > 0;
        return isInline ? hashIndex + 1 : undefined;
    }

    // Flag every line in a run whose `#` deviates from the block's shared
    // column. The expected column is anchored on the line with the most content
    // before its comment: that longest line fixes the column (it carries the
    // tightest gap), and every shorter line pads up to meet it. Anchoring on the
    // longest line — rather than the most common column — is what makes the
    // reported `expected` correct whether the stray line is under- or
    // over-padded.
    private reportAlignmentRun(file: string, run: AlignmentEntry[]): void {
        if (run.length < 2) {
            return;
        }

        const expected = this.anchorColumn(run);

        for (const entry of run) {
            if (entry.column !== expected) {
                this.add(
                    file,
                    entry.lineNumber,
                    entry.column,
                    'comment-alignment',
                    `comment '#' not aligned (column ${entry.column}, expected ${expected})`,
                );
            }
        }
    }

    // The expected `#` column for a run. When a single longest-content line
    // exists, it fixes the column (every shorter line pads up to it). When the
    // longest lines are equally wide and disagree — so no line is the natural
    // anchor — fall back to the most common column in the run.
    private anchorColumn(run: AlignmentEntry[]): number {
        const maxContentEnd = Math.max(...run.map((entry) => entry.contentEnd));
        const longest = run.filter((entry) => entry.contentEnd === maxContentEnd);
        const longestColumns = new Set(longest.map((entry) => entry.column));

        if (longestColumns.size === 1) {
            return longest[0].column;
        }

        return this.modalColumn(run);
    }

    // The most frequent `#` column in a run; ties resolve to the leftmost.
    private modalColumn(run: AlignmentEntry[]): number {
        const counts = new Map<number, number>();

        for (const entry of run) {
            counts.set(entry.column, (counts.get(entry.column) ?? 0) + 1);
        }

        let best = run[0].column;
        let bestCount = 0;

        for (const [column, count] of counts) {
            if (count > bestCount || (count === bestCount && column < best)) {
                best = column;
                bestCount = count;
            }
        }

        return best;
    }

    // Record a single violation, unless its rule is disabled in the config.
    private add(file: string, line: number, column: number, rule: RuleName, message: string): void {
        if (!this.config.rules[rule]) {
            return;
        }

        this.problems.push({
            file,
            line,
            column,
            rule,
            message,
        });
    }

    // Print all violations grouped by file and return the process exit code.
    private report(fileCount: number): number {
        if (!this.problems.length) {
            process.stdout.write(`Linted ${fileCount} .lang file(s): no problems found.\n`);
            return 0;
        }

        const cwd = process.cwd();

        for (const problem of this.problems) {
            const relative = path.relative(cwd, problem.file) || problem.file;
            process.stdout.write(
                `${relative}:${problem.line}:${problem.column}: ${problem.rule} ${problem.message}\n`,
            );
        }

        process.stdout.write(`\nFound ${this.problems.length} problem(s) in ${fileCount} file(s).\n`);
        return 1;
    }
}

if (import.meta.main) {
    const exitCode = new LangLinter().run(process.argv.slice(2));
    process.exitCode = exitCode;
}

export {LangLinter};
