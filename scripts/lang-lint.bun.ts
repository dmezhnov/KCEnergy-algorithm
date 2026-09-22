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

// One item of a request comment — a value on the index line or a name on the
// description line — with the 1-based column its first character occupies.
type RequestCommentItem = {
    text: string;
    column: number;
};

// One parsed line of a two-line request comment: the request number it carries
// and the items of its table row.
type RequestCommentLine = {
    number: string;
    items: RequestCommentItem[];
};

// One coordinate written on a member line of a bracketed structure — the
// `12 from P` of `(1 from I, 12 from P) = 65`. `width` is the field the index
// number occupies: its digits plus the padding that follows them, not counting
// the single separating space before `from`.
type CoordinateUse = {
    lineNumber: number;
    column: number;
    axis: string;
    digits: number;
    width: number;
};

// One top-level definition whose body is a brace-delimited structure: the
// header `name = {` and everything down to the `}` in column 0.
type StructureBlock = {
    name: string;
    firstLine: number;
    lines: string[];
};

// One leaf of a block that shows its arithmetic inline
// (`(1 from I, 1 from J) = 195 +  50 = 245`). `resultColumn` is the 1-based
// column of the `=` that introduces the final value — the only `=` on a leaf
// that carries no sum. `plusColumns` holds the 1-based columns of the `+` signs
// of the sum, empty on a leaf that contributes a single request.
type AggregatedLeaf = {
    lineNumber: number;
    contentEnd: number;
    resultColumn: number;
    plusColumns: number[];
};

// One declaration line of a `where` block — `name(i, j) of number`,
// `Product, Refinery from axis`, `i  for I  from index`. `kind` is the grouping
// key: the keyword together with the category it declares, so a run of
// `of number` lines is aligned independently of the `of matrix(…)` run that
// follows it at the same indentation. `forKeyword` exists only on the index
// declarations that name an index variable, `comment` only on a declaration
// that carries an inline comment.
type WhereDeclaration = {
    indent: number;
    kind: string;
    keyword: AlignmentEntry;
    forKeyword?: AlignmentEntry;
    comment?: AlignmentEntry;
};

// One import of a file's header: the names it brings in, with the 1-based
// column of each, and the source they come from (`core` or a file name).
type ImportEntry = {
    lineNumber: number;
    names: Array<{text: string; column: number}>;
    source: string;
    sourceColumn: number;
};

// One top-level definition, reduced to what the cross-file rules compare: the
// name it introduces and the right-hand side of its `=`, without the ` = {`
// that opens an expansion. `expressionColumn` is the 1-based column that
// right-hand side starts at.
type TopLevelDefinition = {
    name: string;
    lineNumber: number;
    expressionColumn: number;
    expression: string;
};

// The call a defining expression makes: the primitive, how many arguments it
// is given, and whether the argument list is an ellipsis
// (`assign_matrix(a(1), ..., a(n))`), which an example expands to as many
// arguments as its data set holds.
type CallShape = {
    primitive: string;
    arity: number;
    ellipsis: boolean;
};

// The set of rule identifiers the linter can emit. Used both for reporting and
// as the keys of the per-rule enable map in the config file.
type RuleName =
    | 'trailing-whitespace'
    | 'space-before-comment'
    | 'space-after-hash'
    | 'comment-alignment'
    | 'unresolved-call'
    | 'request-comment-pairing'
    | 'request-comment-alignment'
    | 'index-padding'
    | 'bracket-alignment'
    | 'leaf-comment-alignment'
    | 'sum-operand-alignment'
    | 'sum-result-alignment'
    | 'request-number-order'
    | 'import-alignment'
    | 'where-declaration-alignment'
    | 'where-comment-alignment'
    | 'final-newline'
    | 'import-source-order'
    | 'blank-line-run'
    | 'unresolved-import'
    | 'unused-import'
    | 'unresolved-reference'
    | 'expression-mismatch';

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

// The keywords a defining expression may contain that are not references to
// anything: the `from` of `1 from R`, the `of` of a declaration, the `for` of
// `i for I`. `unresolved-reference` skips them.
const REFERENCE_KEYWORDS: ReadonlySet<string> = new Set(['from', 'of', 'for', 'where', 'or', 'and']);

// This is the shared entry point for all `.lang` lint rules. The current rules
// cover comment whitespace, comment-column alignment, unresolved calls, the
// two-line request comments, the padding and brackets of the nested request
// structures, the aggregated leaf lines, the import header and the declarations
// of `where` blocks, and the file-level layout (final newline, import source
// order, blank lines); further rule groups are meant to be added as extra
// methods on this class.
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

    // Files read for the cross-file rules, by absolute path. `null` marks a
    // file that could not be read, so a missing import is reported once and
    // never retried.
    private readonly lineCache = new Map<string, string[] | null>();

    // The exported names of the files the cross-file rules look into.
    private readonly exportCache = new Map<string, Set<string> | null>();

    // The coordinate vocabulary of the linted tree, filled by
    // `collectVocabulary()` before the first file is linted.
    private coordinateNames: ReadonlySet<string> = new Set<string>();

    // The matrix operations of the linted tree — the names `matrix_operation.lang`
    // exports, plus the built-in operators. Only a call to one of these is an
    // operation `expression-mismatch` compares; `requests_i_j_k_l_queue(l0)` is
    // an indexed matrix, not a call.
    private primitiveNames: ReadonlySet<string> = new Set<string>();

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

        this.collectVocabulary(files);

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
                'request-comment-pairing': true,
                'request-comment-alignment': true,
                'index-padding': true,
                'bracket-alignment': true,
                'leaf-comment-alignment': true,
                'sum-operand-alignment': true,
                'sum-result-alignment': true,
                'request-number-order': true,
                'import-alignment': true,
                'where-declaration-alignment': true,
                'where-comment-alignment': true,
                'final-newline': true,
                'import-source-order': true,
                'blank-line-run': true,
                'unresolved-import': true,
                'unused-import': true,
                'unresolved-reference': true,
                'expression-mismatch': true,
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

        this.checkRequestComments(file, lines);

        if (this.config.rules['index-padding']) {
            this.checkIndexPadding(file, lines);
        }

        if (this.config.rules['bracket-alignment']) {
            this.checkBracketAlignment(file, lines);
        }

        if (this.config.rules['leaf-comment-alignment']) {
            this.checkLeafCommentAlignment(file, lines);
        }

        if (this.config.rules['sum-operand-alignment'] || this.config.rules['sum-result-alignment']) {
            this.checkSumAlignment(file, lines);
        }

        if (this.config.rules['request-number-order']) {
            this.checkRequestNumberOrder(file, lines);
        }

        if (this.config.rules['import-alignment']) {
            this.checkImportAlignment(file, lines);
        }

        if (this.config.rules['where-declaration-alignment']) {
            this.checkWhereDeclarationAlignment(file, lines);
        }

        if (this.config.rules['where-comment-alignment']) {
            this.checkWhereCommentAlignment(file, lines);
        }

        if (this.config.rules['final-newline']) {
            this.checkFinalNewline(file, text, lines);
        }

        if (this.config.rules['import-source-order']) {
            this.checkImportSourceOrder(file, lines);
        }

        if (this.config.rules['blank-line-run']) {
            this.checkBlankLineRuns(file, text, lines);
        }

        if (this.config.rules['unresolved-import']) {
            this.checkUnresolvedImports(file, lines);
        }

        if (this.config.rules['unused-import']) {
            this.checkUnusedImports(file, lines);
        }

        if (this.config.rules['unresolved-reference']) {
            this.checkUnresolvedReferences(file, lines);
        }

        if (this.config.rules['expression-mismatch']) {
            this.checkExpressionMismatch(file, lines);
        }
    }

    // Rule `final-newline`: a file ends with a newline. An empty file has
    // nothing to terminate and is left alone.
    private checkFinalNewline(file: string, text: string, lines: string[]): void {
        if (text.length === 0 || text.endsWith('\n')) {
            return;
        }

        const last = lines[lines.length - 1];

        this.add(
            file,
            lines.length,
            last.length + 1,
            'final-newline',
            'file does not end with a newline',
        );
    }

    // Rule `blank-line-run`: at most one blank line in a row. The files separate
    // every definition, section comment and header from the next with a single
    // blank line; the run is reported at its second line, the first one that is
    // one too many.
    private checkBlankLineRuns(file: string, text: string, lines: string[]): void {
        // `split('\n')` leaves an empty last element for the newline that
        // terminates the file: that one is the terminator, not a blank line.
        const count = text.endsWith('\n') ? lines.length - 1 : lines.length;
        let run = 0;

        for (let index = 0; index < count; index++) {
            if (lines[index].trim().length > 0) {
                run = 0;
                continue;
            }

            run += 1;

            if (run === 2) {
                this.add(
                    file,
                    index + 1,
                    1,
                    'blank-line-run',
                    'more than one blank line in a row',
                );
            }
        }
    }

    // Rule `import-source-order`: within an import header the `from core` lines
    // come first, and the imports of one source stay together. A file's names
    // are listed one per line, so several lines may share a source
    // (`matrix_operation.lang` three times in `step-n-plus-1.lang`); what the
    // rule forbids is interleaving them with another source's.
    private checkImportSourceOrder(file: string, lines: string[]): void {
        const header = this.importHeaderSources(lines);

        if (!header) {
            return; // Not an import header: this file has no sources to order.
        }

        const seen: string[] = [];

        header.forEach((entry, position) => {
            const previous = position > 0 ? header[position - 1].source : undefined;

            if (entry.source === previous) {
                return; // Still inside the run of one source.
            }

            if (seen.includes(entry.source)) {
                this.add(
                    file,
                    entry.lineNumber,
                    1,
                    'import-source-order',
                    `imports of ${entry.source} are split by imports of another source`,
                );
            } else {
                seen.push(entry.source);
            }

            if (entry.source === 'core' && seen.some((source) => source !== 'core')) {
                this.add(
                    file,
                    entry.lineNumber,
                    1,
                    'import-source-order',
                    'a core import follows an import from a file',
                );
            }
        });
    }

    // The sources of a file's import header, in the order the lines write them,
    // or undefined when the leading block is not a header.
    private importHeaderSources(
        lines: string[],
    ): Array<{lineNumber: number; source: string}> | undefined {
        const header: Array<{lineNumber: number; source: string}> = [];

        for (const [index, line] of lines.entries()) {
            if (line.trim().length === 0) {
                break;
            }

            const match = /^\S.*?\s+from\s+(core|\(".*?"\))\s*$/.exec(this.codeOf(line));

            if (!match) {
                return undefined;
            }

            header.push({lineNumber: index + 1, source: match[1]});
        }

        return header.length ? header : undefined;
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

    // Rules `request-comment-pairing` and `request-comment-alignment`: the
    // two-line comment that documents one request (or one volume row). The pair
    // is an index line followed by a description line carrying the same number:
    //   # 001   1 from I,   1 from C, ...   1 from R - 130
    //   # 001  (AI_92,      FCA,      ...    First)
    // Each value on the index line must start in the same column as the name
    // that documents it on the line below, so the two lines read as one table.
    private checkRequestComments(file: string, lines: string[]): void {
        lines.forEach((line, index) => {
            const indexLine = LangLinter.parseRequestIndexLine(line);

            if (indexLine) {
                this.checkIndexLineFollowedByDescription(file, index, lines, indexLine);
                return;
            }

            const descriptionLine = LangLinter.parseRequestDescriptionLine(line);

            if (descriptionLine) {
                this.checkDescriptionLinePrecededByIndex(file, index, lines, descriptionLine);
            }
        });
    }

    // Half of `request-comment-pairing`: an index line must be followed by the
    // description line of the same request, and the two must then line up.
    private checkIndexLineFollowedByDescription(
        file: string,
        index: number,
        lines: string[],
        indexLine: RequestCommentLine,
    ): void {
        const next = index + 1 < lines.length ? lines[index + 1] : '';
        const descriptionLine = LangLinter.parseRequestDescriptionLine(next);

        if (!descriptionLine) {
            this.add(
                file,
                index + 1,
                1,
                'request-comment-pairing',
                `request ${indexLine.number} has no description line below its index line`,
            );
            return;
        }

        if (descriptionLine.number !== indexLine.number) {
            this.add(
                file,
                index + 2,
                1,
                'request-comment-pairing',
                `description line is numbered ${descriptionLine.number} but documents request ${indexLine.number}`,
            );
            return;
        }

        this.checkRequestColumns(file, index + 2, indexLine, descriptionLine);
    }

    // The other half of `request-comment-pairing`: a description line that no
    // index line introduces. The aligned case is reported from the index line,
    // so here only the orphan is flagged.
    private checkDescriptionLinePrecededByIndex(
        file: string,
        index: number,
        lines: string[],
        descriptionLine: RequestCommentLine,
    ): void {
        const previous = index > 0 ? lines[index - 1] : '';

        if (LangLinter.parseRequestIndexLine(previous)) {
            return;
        }

        this.add(
            file,
            index + 1,
            1,
            'request-comment-pairing',
            `description line for request ${descriptionLine.number} has no index line above it`,
        );
    }

    // Rule `request-comment-alignment`: value `n` of the index line and name `n`
    // of the description line must start in the same column. A differing number
    // of items is reported on its own, because column-by-column comparison would
    // then blame every column past the first missing one.
    private checkRequestColumns(
        file: string,
        lineNumber: number,
        indexLine: RequestCommentLine,
        descriptionLine: RequestCommentLine,
    ): void {
        if (indexLine.items.length !== descriptionLine.items.length) {
            this.add(
                file,
                lineNumber,
                1,
                'request-comment-alignment',
                `request ${indexLine.number} documents ${descriptionLine.items.length} name(s) for ${indexLine.items.length} value(s)`,
            );
            return;
        }

        indexLine.items.forEach((value, position) => {
            const name = descriptionLine.items[position];

            if (name.column === value.column) {
                return;
            }

            this.add(
                file,
                lineNumber,
                name.column,
                'request-comment-alignment',
                `'${name.text}' starts at column ${name.column} but documents '${value.text}' at column ${value.column}`,
            );
        });
    }

    // Parse an index line `# NNN   <value>, <value>, ... - <total>`. The
    // trailing ` - <total>` is the request volume rather than a column of the
    // table, so it is dropped before the items are split out.
    private static parseRequestIndexLine(line: string): RequestCommentLine | undefined {
        const match = /^# (\d+)(\s+)(\d+ from [A-Za-z].*)$/.exec(line);

        if (!match) {
            return undefined;
        }

        const body = match[3].replace(/\s+-\s+\d+\s*$/, '');
        const offset = 2 + match[1].length + match[2].length;

        return {
            number: match[1],
            items: LangLinter.splitAtColumns(body, offset),
        };
    }

    // Parse a description line `# NNN  (<name>, <name>, ...)`. The opening `(`
    // belongs to the line's prefix, so the first name's column is the column
    // just past it.
    private static parseRequestDescriptionLine(line: string): RequestCommentLine | undefined {
        const match = /^# (\d+)(\s+)\((.*)\)\s*$/.exec(line);

        if (!match) {
            return undefined;
        }

        const offset = 2 + match[1].length + match[2].length + 1;

        return {
            number: match[1],
            items: LangLinter.splitAtColumns(match[3], offset),
        };
    }

    // Split a comma-separated body into its items, recording the 1-based column
    // at which each item's first non-space character sits. `offset` is the
    // 0-based position of the body within its line.
    private static splitAtColumns(body: string, offset: number): RequestCommentItem[] {
        const items: RequestCommentItem[] = [];
        let start = 0;

        for (let i = 0; i <= body.length; i += 1) {
            if (i < body.length && body[i] !== ',') {
                continue;
            }

            const segment = body.slice(start, i);
            const text = segment.trim();

            if (text.length) {
                const lead = segment.length - segment.trimStart().length;
                items.push({text, column: offset + start + lead + 1});
            }

            start = i + 1;
        }

        return items;
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

    // Rule `index-padding`: the index number of a coordinate written inside a
    // bracketed structure — the `12` of `12 from P` — is left-aligned in a
    // field as wide as the widest index that axis reaches in the file. The
    // padding is what makes every tuple on a nesting level the same width, so
    // the closing `)` and the `=` behind it line up (`algorithm/CLAUDE.md`,
    // "Index number padding"). The expected width is measured per axis and per
    // file rather than per block: `P` is padded to 2 in blocks that happen to
    // hold single-digit participants only, because the axis itself reaches 21.
    // Only member lines count — a definition header such as
    // `requests_i_j_k_l_queue(1  from R) = {` pads its index to line up with
    // the family head above it, which is a different alignment.
    private checkIndexPadding(file: string, lines: string[]): void {
        const uses = this.collectCoordinateUses(lines);
        const widest = new Map<string, number>();

        for (const use of uses) {
            widest.set(use.axis, Math.max(widest.get(use.axis) ?? 0, use.digits));
        }

        for (const use of uses) {
            const expected = widest.get(use.axis) as number;

            if (use.width === expected) {
                continue;
            }

            this.add(
                file,
                use.lineNumber,
                use.column,
                'index-padding',
                `index of '${use.axis}' padded to width ${use.width}, expected ${expected}`,
            );
        }
    }

    // Every `<index> from <Axis>` coordinate on a member line of a bracketed
    // structure (bracket depth > 0 at the start of the line), with the field
    // width its number occupies. Full-line comments are skipped: the request
    // tables have their own alignment rule, and `where` blocks sit at depth 0.
    private collectCoordinateUses(lines: string[]): CoordinateUse[] {
        const uses: CoordinateUse[] = [];
        const pattern = /(?<![\w])(\d+)( +)from ([A-Za-z_]\w*)/g;
        let depth = 0;

        lines.forEach((line, index) => {
            const depthAtStart = depth;
            depth = Math.max(0, depth + this.bracketDelta(line));

            if (depthAtStart === 0 || /^\s*#/.test(line)) {
                return;
            }

            const code = this.stripCode(line);

            let match: RegExpExecArray | null;
            while ((match = pattern.exec(code)) !== null) {
                uses.push({
                    lineNumber: index + 1,
                    column: match.index + 1,
                    axis: match[3],
                    digits: match[1].length,
                    // The single space that separates the field from `from` is
                    // not padding, so it is not part of the field width.
                    width: match[1].length + match[2].length - 1,
                });
            }
        });

        return uses;
    }

    // Rule `bracket-alignment`: a line that starts with a closing bracket is
    // indented like the line that opened it, so each closing bracket sits under
    // the start of the line it closes and the nesting stays readable at a
    // glance (`algorithm/CLAUDE.md`, "Alignment"). Brackets closed on the same
    // line they were opened on are not constrained by anything and are skipped.
    private checkBracketAlignment(file: string, lines: string[]): void {
        const openers: Array<{indent: number; lineNumber: number}> = [];

        lines.forEach((line, index) => {
            const code = this.stripCode(line);
            const indent = code.length - code.trimStart().length;
            const closesLine = /^\s*[)}\]]/.test(code);

            for (const char of code) {
                if (char === '(' || char === '{' || char === '[') {
                    openers.push({indent, lineNumber: index + 1});
                    continue;
                }

                if (char !== ')' && char !== '}' && char !== ']') {
                    continue;
                }

                const opener = openers.pop();

                if (!opener || opener.lineNumber === index + 1 || !closesLine) {
                    continue;
                }

                if (indent !== opener.indent) {
                    this.add(
                        file,
                        index + 1,
                        indent + 1,
                        'bracket-alignment',
                        `closing bracket at column ${indent + 1}, expected ${opener.indent + 1} (opened on line ${opener.lineNumber})`,
                    );
                }

                // Only the first closing bracket of a line starts that line.
                break;
            }
        });
    }

    // Rule `leaf-comment-alignment`: the `#` of every commented leaf line of
    // one structure shares a single column across the whole block, not just
    // within its own innermost group (`algorithm/CLAUDE.md`, "Leaf line request
    // number comments"). This is the block-scope counterpart of
    // `comment-alignment`, which groups by member list and therefore accepts a
    // block whose K-groups sit in different columns.
    private checkLeafCommentAlignment(file: string, lines: string[]): void {
        for (const block of this.structureBlocks(lines)) {
            const run: AlignmentEntry[] = [];

            block.lines.forEach((line, offset) => {
                const column = this.inlineCommentColumn(line);

                if (column === undefined || !LangLinter.isLeafLine(line)) {
                    return;
                }

                const hashIndex = line.indexOf('#');
                run.push({
                    lineNumber: block.firstLine + offset,
                    column,
                    contentEnd: line.slice(0, hashIndex).replace(/\s+$/, '').length,
                });
            });

            this.reportLeafAlignmentRun(file, block, run);
        }
    }

    // Flag every leaf of a block whose `#` leaves the block's shared column.
    // The column is anchored the same way `comment-alignment` anchors a member
    // run: on the leaf with the most content before its comment.
    private reportLeafAlignmentRun(file: string, block: StructureBlock, run: AlignmentEntry[]): void {
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
                    'leaf-comment-alignment',
                    `comment '#' at column ${entry.column}, expected ${expected} for every leaf of '${block.name}'`,
                );
            }
        }
    }

    // Rules `sum-operand-alignment` and `sum-result-alignment`: the aggregated
    // leaf lines of one top-level block (`algorithm/CLAUDE.md`, "Aggregated Leaf
    // Lines"). A block that shows no arithmetic is out of scope; in a block that
    // shows some, the k-th `+` shares a column across every summed leaf, and the
    // `=` that introduces the final value shares a column across every leaf —
    // including the single-request leaves, which pad between `)` and `=` so
    // their value lands under the totals.
    private checkSumAlignment(file: string, lines: string[]): void {
        for (const block of this.structureBlocks(lines)) {
            const leaves = this.aggregatedLeaves(block);
            const summed = leaves.filter((leaf) => leaf.plusColumns.length > 0);

            if (summed.length === 0) {
                continue;
            }

            if (this.config.rules['sum-operand-alignment']) {
                this.checkOperandColumns(file, block, summed);
            }

            if (this.config.rules['sum-result-alignment']) {
                this.checkResultColumn(file, block, leaves);
            }
        }
    }

    // Flag every summed leaf whose k-th `+` leaves the column the block's widest
    // sum puts it in. Each operand position is checked on its own, so a leaf with
    // fewer operands only has to line up the `+` signs it actually writes.
    private checkOperandColumns(file: string, block: StructureBlock, summed: AggregatedLeaf[]): void {
        const positions = Math.max(...summed.map((leaf) => leaf.plusColumns.length));

        for (let position = 0; position < positions; position += 1) {
            const run = summed
                .filter((leaf) => leaf.plusColumns.length > position)
                .map((leaf) => ({
                    lineNumber: leaf.lineNumber,
                    column: leaf.plusColumns[position],
                    contentEnd: leaf.contentEnd,
                }));

            if (run.length < 2) {
                continue;
            }

            const expected = this.anchorColumn(run);

            for (const entry of run) {
                if (entry.column !== expected) {
                    this.add(
                        file,
                        entry.lineNumber,
                        entry.column,
                        'sum-operand-alignment',
                        `operand ${position + 1} '+' at column ${entry.column}, expected ${expected} for every sum of '${block.name}'`,
                    );
                }
            }
        }
    }

    // Flag every leaf of an aggregated block whose final `=` leaves the shared
    // column.
    private checkResultColumn(file: string, block: StructureBlock, leaves: AggregatedLeaf[]): void {
        const run = leaves.map((leaf) => ({
            lineNumber: leaf.lineNumber,
            column: leaf.resultColumn,
            contentEnd: leaf.contentEnd,
        }));

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
                    'sum-result-alignment',
                    `result '=' at column ${entry.column}, expected ${expected} for every leaf of '${block.name}'`,
                );
            }
        }
    }

    // The leaves of a block, each with the column of the `=` in front of its
    // final value and the columns of the `+` signs of its sum. A leaf whose
    // value is a nested structure or which carries no `=` at all is skipped.
    private aggregatedLeaves(block: StructureBlock): AggregatedLeaf[] {
        const leaves: AggregatedLeaf[] = [];

        block.lines.forEach((line, offset) => {
            if (!LangLinter.isLeafLine(line)) {
                return;
            }

            const hashIndex = line.indexOf('#');
            const code = hashIndex === -1 ? line : line.slice(0, hashIndex);
            const close = this.matchingParen(code, code.indexOf('('));

            if (close === -1) {
                return;
            }

            const equals: number[] = [];
            for (let index = close + 1; index < code.length; index += 1) {
                if (code[index] === '=') {
                    equals.push(index);
                }
            }

            if (equals.length === 0) {
                return;
            }

            const resultColumn = equals[equals.length - 1];
            const plusColumns: number[] = [];

            if (equals.length >= 2) {
                for (let index = equals[0] + 1; index < resultColumn; index += 1) {
                    if (code[index] === '+') {
                        plusColumns.push(index + 1);
                    }
                }
            }

            leaves.push({
                lineNumber: block.firstLine + offset,
                contentEnd: code.replace(/\s+$/, '').length,
                resultColumn: resultColumn + 1,
                plusColumns,
            });
        });

        return leaves;
    }

    // Rule `request-number-order`: the request numbers a leaf comment lists are
    // sorted ascending, never in structural or discovery order
    // (`algorithm/CLAUDE.md`, "Request-number order"). A comment may carry two
    // number groups separated by `=` — the contributing requests on the left of
    // the arithmetic and the aggregated ones on the right — and each group is
    // ordered on its own.
    private checkRequestNumberOrder(file: string, lines: string[]): void {
        lines.forEach((line, index) => {
            const hashIndex = line.indexOf('#');

            if (this.inlineCommentColumn(line) === undefined || !LangLinter.isLeafLine(line)) {
                return;
            }

            const comment = line.slice(hashIndex + 1);

            if (!/^[\s\d+=]+$/.test(comment)) {
                return;
            }

            for (const group of comment.split('=')) {
                const numbers = (group.match(/\d+/g) ?? []).map(Number);
                const stray = numbers.findIndex((number, position) => position > 0 && number < numbers[position - 1]);

                if (stray > 0) {
                    this.add(
                        file,
                        index + 1,
                        hashIndex + 1,
                        'request-number-order',
                        `request numbers out of order in '${group.trim()}': ${numbers[stray]} follows ${numbers[stray - 1]}`,
                    );
                }
            }
        });
    }

    // Rule `import-alignment`: the import header of a file — the run of
    // `name, name from ("file.lang")` lines that precedes the first blank line
    // — writes every `from` in one column, one space behind the longest name
    // list. A file whose first block is not a header has nothing to align
    // (`initial_data.example_*.lang` opens with an enumeration, `lang.lang`
    // with the language's own axioms).
    private checkImportAlignment(file: string, lines: string[]): void {
        const run: AlignmentEntry[] = [];

        for (const [index, line] of lines.entries()) {
            if (line.trim().length === 0) {
                break;
            }

            const entry = this.importEntry(line, index + 1);

            if (!entry) {
                return; // Not an import header: this file has none to check.
            }

            run.push(entry);
        }

        this.reportKeywordRun(file, run, 'import-alignment', "import 'from'");
    }

    // The `from` of one import line, or undefined when the line is not an
    // import. The source is either `core` or a quoted file name — a `from`
    // binding inside a `where` block never uses those — and the whole line must
    // be the import, so a stray line ends the header instead of joining it.
    private importEntry(line: string, lineNumber: number): AlignmentEntry | undefined {
        const match = /^(\S.*?)(\s+)from\s+(?:core|\(".*?"\))\s*$/.exec(this.codeOf(line));

        if (!match) {
            return undefined;
        }

        return {
            lineNumber,
            column: match[1].length + match[2].length + 1,
            contentEnd: match[1].length,
        };
    }

    // Rule `where-declaration-alignment`: the declarations of a `where` block
    // line up their keyword. Within one run — consecutive lines of the same
    // `where` block, at the same indentation, declaring the same category — the
    // `of` of `name(i, j) of number` and the `from` of `Product, Refinery from
    // axis` each share a column, as does the `for` of `i  for I  from index`.
    // The category is part of the grouping because the files align each kind on
    // its own: an `of number` run is immediately followed by an `of matrix(…)`
    // run whose keyword sits in a different column.
    private checkWhereDeclarationAlignment(file: string, lines: string[]): void {
        for (const run of this.whereDeclarationRuns(lines)) {
            this.reportDeclarationRun(file, run);
        }
    }

    // Rule `where-comment-alignment`: the inline comments of a `where` block
    // line up their `#`, over the same runs the keyword rule aligns. This is
    // the alignment `comment-alignment` deliberately leaves out — it only looks
    // at the member lines of a bracketed list, and a `where` block is written
    // outside brackets. A comment-less declaration splits the run: the files
    // comment a block's declarations in stretches, and an uncommented line in
    // the middle carries no column to agree with.
    private checkWhereCommentAlignment(file: string, lines: string[]): void {
        for (const run of this.whereDeclarationRuns(lines)) {
            for (const stretch of LangLinter.commentedStretches(run)) {
                this.reportKeywordRun(file, stretch, 'where-comment-alignment', "comment '#'");
            }
        }
    }

    // The maximal stretches of consecutive commented declarations within one
    // run, as the alignment entries of their comments.
    private static commentedStretches(run: WhereDeclaration[]): AlignmentEntry[][] {
        const stretches: AlignmentEntry[][] = [];
        let current: AlignmentEntry[] = [];

        for (const declaration of run) {
            if (declaration.comment) {
                current.push(declaration.comment);
                continue;
            }

            if (current.length) {
                stretches.push(current);
                current = [];
            }
        }

        if (current.length) {
            stretches.push(current);
        }

        return stretches;
    }

    // The declaration runs of a file: consecutive lines of one `where` block,
    // at one indentation, declaring one category. Anything else — a blank line,
    // a nested `where`, a guard, an expansion, a line outside every `where` —
    // ends the current run. Shared by the two rules that align a `where` block,
    // so both group their lines identically.
    private whereDeclarationRuns(lines: string[]): WhereDeclaration[][] {
        const runs: WhereDeclaration[][] = [];
        const whereIndents: number[] = [];
        let run: WhereDeclaration[] = [];

        const flush = (): void => {
            if (run.length) {
                runs.push(run);
            }

            run = [];
        };

        lines.forEach((line, index) => {
            const code = this.codeOf(line);
            const indent = line.length - line.trimStart().length;

            if (line.trim().length === 0) {
                whereIndents.length = 0; // A blank line ends the definition.
                flush();
                return;
            }

            while (whereIndents.length && indent <= whereIndents[whereIndents.length - 1]) {
                whereIndents.pop();
            }

            if (/^\s*where\s*$/.test(code)) {
                whereIndents.push(indent);
                flush();
                return;
            }

            const declaration = whereIndents.length
                ? this.whereDeclaration(code, index + 1, indent)
                : undefined;

            if (!declaration) {
                flush();
                return;
            }

            declaration.comment = this.commentEntry(line, index + 1);

            if (run.length && (run[0].kind !== declaration.kind || run[0].indent !== declaration.indent)) {
                flush();
            }

            run.push(declaration);
        });

        flush();

        return runs;
    }

    // The alignment entry of a line's inline comment, or undefined when it
    // carries none.
    private commentEntry(line: string, lineNumber: number): AlignmentEntry | undefined {
        const column = this.inlineCommentColumn(line);

        if (column === undefined) {
            return undefined;
        }

        return {
            lineNumber,
            column,
            contentEnd: line.slice(0, column - 1).replace(/\s+$/, '').length,
        };
    }

    // Parse one line of a `where` block into a declaration, or undefined when
    // it is not one. Two shapes declare: `<names> of <type>` and `<names> from
    // <category>`, the category being a single bare word. The guards and
    // expansions that also live in `where` blocks (`l0 > 2`,
    // `is_empty(…) = true`, `a(1), …, a(N) => a(i)`) match neither, and a `from`
    // written inside a name — the `(1 from R)` of `available_i_j(1 from R)` —
    // never ends the line, so it is not mistaken for the keyword.
    private whereDeclaration(code: string, lineNumber: number, indent: number): WhereDeclaration | undefined {
        const ofMatch = /^(\s*\S.*?)(\s+)of\s+([A-Za-z_]\w*)(?:\(.*\))?\s*$/.exec(code);

        if (ofMatch) {
            return {
                indent,
                kind: `of ${ofMatch[3]}`,
                keyword: this.keywordEntry(lineNumber, ofMatch[1], ofMatch[2]),
            };
        }

        const fromMatch = /^(\s*\S.*?)(\s+)from\s+([A-Za-z_]\w*)\s*$/.exec(code);

        if (!fromMatch) {
            return undefined;
        }

        return {
            indent,
            kind: `from ${fromMatch[3]}`,
            keyword: this.keywordEntry(lineNumber, fromMatch[1], fromMatch[2]),
            forKeyword: this.forKeywordEntry(lineNumber, fromMatch[1]),
        };
    }

    // The `for` of an index declaration (`i  for I  from index`), read off the
    // part of the line that precedes its `from`. Absent on every other
    // declaration, including the `R from index` that names no index variable.
    private forKeywordEntry(lineNumber: number, names: string): AlignmentEntry | undefined {
        const match = /^(\s*\S.*?)(\s+)for\s+\S+$/.exec(names);

        return match ? this.keywordEntry(lineNumber, match[1], match[2]) : undefined;
    }

    // An alignment entry for a keyword, given the text in front of it and the
    // gap between the two: the keyword's own 1-based column, and the column the
    // content before it ends at.
    private keywordEntry(lineNumber: number, before: string, gap: string): AlignmentEntry {
        return {
            lineNumber,
            column: before.length + gap.length + 1,
            contentEnd: before.length,
        };
    }

    // Flag the declarations of a run whose keyword leaves the run's shared
    // column. The `for` of the index declarations is checked on its own, over
    // the subset of lines that write one — a run may mix `R from index` with
    // `i  for I  from index`, and the files align those two by their `from`.
    private reportDeclarationRun(file: string, run: WhereDeclaration[]): void {
        if (run.length < 2) {
            return;
        }

        const keyword = run[0].kind.split(' ')[0];

        this.reportKeywordRun(
            file,
            run.map((declaration) => declaration.keyword),
            'where-declaration-alignment',
            `declaration '${keyword}'`,
        );

        const forEntries = run
            .map((declaration) => declaration.forKeyword)
            .filter((entry): entry is AlignmentEntry => entry !== undefined);

        this.reportKeywordRun(file, forEntries, 'where-declaration-alignment', "declaration 'for'");
    }

    // Flag every entry of a run whose keyword deviates from the column the run
    // shares. The expected column is anchored on the longest-content line, the
    // same way `comment-alignment` anchors a comment run.
    private reportKeywordRun(file: string, run: AlignmentEntry[], rule: RuleName, label: string): void {
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
                    rule,
                    `${label} not aligned (column ${entry.column}, expected ${expected})`,
                );
            }
        }
    }

    // The code part of a line: everything before an inline comment. Unlike
    // `stripCode` it keeps string literals intact, so a quoted import source and
    // a `"=" from condition` operand can still be matched; the columns are the
    // same either way.
    private codeOf(line: string): string {
        const hashIndex = line.indexOf('#');

        return hashIndex === -1 ? line : line.slice(0, hashIndex);
    }

    // The top-level structures of a file: a definition whose header ends in
    // `= {` down to the `}` that closes it in column 0. A file's structures do
    // not nest at top level, so a flat scan is enough.
    private structureBlocks(lines: string[]): StructureBlock[] {
        const blocks: StructureBlock[] = [];

        for (let start = 0; start < lines.length; start += 1) {
            if (!/^[A-Za-z_].*=\s*\{\s*$/.test(lines[start])) {
                continue;
            }

            let end = start + 1;
            while (end < lines.length && !/^\}/.test(lines[end])) {
                end += 1;
            }

            blocks.push({
                name: lines[start].slice(0, lines[start].indexOf('=')).trim(),
                firstLine: start + 1,
                lines: lines.slice(start, Math.min(end + 1, lines.length)),
            });

            start = end;
        }

        return blocks;
    }

    // A leaf line of a structure: a coordinate tuple assigned a value rather
    // than a nested group (`(1 from I, 12 from P) = 65,  # 011`).
    private static isLeafLine(line: string): boolean {
        const code = line.includes('#') ? line.slice(0, line.indexOf('#')) : line;
        const trimmed = code.trim();

        return trimmed.startsWith('(') && /\)\s*=/.test(trimmed) && !trimmed.endsWith('{');
    }

    // Rule `unresolved-import`: the source named by an import line exists next
    // to the importing file, and every name the line takes from it is exported
    // by that file. This is the only rule that reads a second file; everything
    // it needs is the other file's top-level lines.
    private checkUnresolvedImports(file: string, lines: string[]): void {
        for (const entry of this.importedNames(lines)) {
            if (entry.source === 'core') {
                continue;
            }

            const sourcePath = path.join(path.dirname(file), entry.source);
            const exported = this.exportedNames(sourcePath);

            if (!exported) {
                this.add(
                    file,
                    entry.lineNumber,
                    entry.sourceColumn,
                    'unresolved-import',
                    `imported file '${entry.source}' does not exist`,
                );
                continue;
            }

            for (const name of entry.names) {
                if (!exported.has(name.text)) {
                    this.add(
                        file,
                        entry.lineNumber,
                        name.column,
                        'unresolved-import',
                        `'${name.text}' is not defined in ${entry.source}`,
                    );
                }
            }
        }
    }

    // Rule `unused-import`: every imported name is mentioned in the body of the
    // importing file. A mention in a comment does not count — an import states
    // what the definitions below are built from, and a comment builds nothing.
    private checkUnusedImports(file: string, lines: string[]): void {
        const header = this.importedNames(lines);

        if (!header.length) {
            return;
        }

        const used = new Set<string>();

        for (const line of lines.slice(header.length)) {
            for (const match of this.stripCode(line).matchAll(/[A-Za-z_]\w*/g)) {
                used.add(match[0]);
            }
        }

        for (const entry of header) {
            for (const name of entry.names) {
                if (!used.has(name.text)) {
                    this.add(
                        file,
                        entry.lineNumber,
                        name.column,
                        'unused-import',
                        `'${name.text}' is imported but never used`,
                    );
                }
            }
        }
    }

    // Rule `unresolved-reference`: every name a top-level defining expression
    // mentions resolves to something. This is `unresolved-call` widened from
    // call position to bare references (`filter_by_pair(requests_i_j, ">=",
    // threshold_i_j)` names two matrices and no function), which is where a
    // renamed variable leaves a stale mention behind.
    private checkUnresolvedReferences(file: string, lines: string[]): void {
        const known = this.referenceScope(file, lines);

        for (const definition of this.topLevelDefinitions(lines)) {
            for (const match of definition.expression.matchAll(/[A-Za-z_]\w*/g)) {
                const name = match[0];

                if (REFERENCE_KEYWORDS.has(name) || known.has(name)) {
                    continue;
                }

                this.add(
                    file,
                    definition.lineNumber,
                    definition.expressionColumn + match.index,
                    'unresolved-reference',
                    `'${name}' is neither imported nor defined`,
                );
            }
        }
    }

    // Rule `expression-mismatch`: a worked example defines each variable by the
    // same expression as its step file — the same primitive with the same
    // number of arguments. Only definitions the step file writes as a call are
    // compared: a constant the example replaces by its value
    // (`MIN_NEXT_AVAIL_TONNAGE(1 from R) = 4`) states the same thing in the
    // example's own terms, and the expansion blocks of a family carry no
    // expression at all. A step call with an ellipsis argument
    // (`f(x, a(1), ..., a(n))`) is expanded by the example into as many
    // arguments as the data set has, so only its primitive is compared.
    private checkExpressionMismatch(file: string, lines: string[]): void {
        const stepPath = this.stepFileOf(file);

        if (!stepPath) {
            return;
        }

        const stepLines = this.linesOf(stepPath);

        if (!stepLines) {
            return;
        }

        const stepShapes = new Map<string, CallShape[]>();

        for (const definition of this.topLevelDefinitions(stepLines)) {
            const shape = this.callShape(definition.expression);

            if (!shape) {
                continue;
            }

            stepShapes.set(definition.name, [...(stepShapes.get(definition.name) ?? []), shape]);
        }

        const stepName = path.basename(stepPath);

        for (const definition of this.topLevelDefinitions(lines)) {
            const expected = stepShapes.get(definition.name);

            if (!expected || this.isEmptyExpression(definition.expression)) {
                continue;
            }

            const actual = this.callShape(definition.expression);

            if (!actual) {
                this.add(
                    file,
                    definition.lineNumber,
                    definition.expressionColumn,
                    'expression-mismatch',
                    `'${definition.name}' does not call ${this.shapeList(expected)} as ${stepName} does`,
                );
                continue;
            }

            if (expected.some((shape) => this.shapesAgree(shape, actual))) {
                continue;
            }

            this.add(
                file,
                definition.lineNumber,
                definition.expressionColumn,
                'expression-mismatch',
                `'${definition.name}' calls ${this.describeShape(actual)}, ${stepName} calls ${this.shapeList(expected)}`,
            );
        }
    }

    // Whether a right-hand side says nothing an operation could be read out of:
    // the expansion blocks of a family write none at all, and `= {}` — the
    // empty matrix of a queue that distributed nothing — is a literal, not a
    // call. Both are legitimate alternatives to the step's own expression.
    private isEmptyExpression(expression: string): boolean {
        const trimmed = expression.trim();

        return trimmed.length === 0 || trimmed === '{}';
    }

    // Whether an example's call may stand for the step's. The primitive must be
    // the same; the argument count is compared only when the step writes a
    // fixed list, because an ellipsis stands for as many arguments as the
    // example's data set holds.
    private shapesAgree(expected: CallShape, actual: CallShape): boolean {
        if (expected.primitive !== actual.primitive) {
            return false;
        }

        return expected.ellipsis || expected.arity === actual.arity;
    }

    // `filter_by_coordinate/4`, for a diagnostic message.
    private describeShape(shape: CallShape): string {
        return `${shape.primitive}/${shape.ellipsis ? '…' : shape.arity}`;
    }

    // The shapes a step file offers for one name, as a diagnostic message. A
    // name may carry several definitions — `MIN_NEXT_AVAIL_TONNAGE` has one per
    // shipment term — and any of them may be the one the example expands.
    private shapeList(shapes: CallShape[]): string {
        return [...new Set(shapes.map((shape) => this.describeShape(shape)))].join(' or ');
    }

    // The operation a defining expression calls, its argument count, and
    // whether the argument list contains an ellipsis. Undefined when the
    // expression is not an operation call — a copy, a literal, an enumeration,
    // or an indexed matrix such as `requests_i_j_k_l_queue(l0)`, which looks
    // like a call and is not one.
    private callShape(expression: string): CallShape | undefined {
        const match = /^\s*([A-Za-z_]\w*)\s*\(/.exec(expression);

        if (!match || !this.primitiveNames.has(match[1])) {
            return undefined;
        }

        const open = expression.indexOf('(', match.index);
        const close = this.matchingParen(expression, open);

        if (close === -1) {
            return undefined;
        }

        const args = this.splitTopLevel(expression.slice(open + 1, close));

        return {
            primitive: match[1],
            arity: args.length,
            ellipsis: args.some((argument) => argument.trim() === '...'),
        };
    }

    // The step file a worked example belongs to: `step-2.example_1.lang` is the
    // example of `step-2.lang`. Undefined for a file that is not an example.
    private stepFileOf(file: string): string | undefined {
        const base = path.basename(file);
        const match = /^(.*)\.example_\d+\.lang$/.exec(base);

        return match ? path.join(path.dirname(file), `${match[1]}.lang`) : undefined;
    }

    // The names a defining expression may mention: everything `unresolved-call`
    // accepts, the built-in primitives, the coordinate vocabulary of the linted
    // tree, and — for a worked example — the definitions of its step file, which
    // is the vocabulary the example works in even where it does not expand a
    // variable itself.
    private referenceScope(file: string, lines: string[]): Set<string> {
        const known = new Set<string>([...this.collectKnownNames(lines), ...BUILTIN_NAMES, ...this.coordinateNames]);
        const stepPath = this.stepFileOf(file);
        const stepExports = stepPath ? this.exportedNames(stepPath) : undefined;

        if (stepExports) {
            for (const name of stepExports) {
                known.add(name);
            }
        }

        return known;
    }

    // Every top-level definition of a file: the name it introduces and the
    // right-hand side of its `=`, without the ` = {` that opens an expansion
    // and without any inline comment.
    private topLevelDefinitions(lines: string[]): TopLevelDefinition[] {
        const definitions: TopLevelDefinition[] = [];

        lines.forEach((line, index) => {
            if (!/^[A-Za-z_]/.test(line)) {
                return;
            }

            const code = this.stripCode(line).trimEnd();
            const name = this.leadingIdentifier(code);
            const equals = this.definingEquals(code);

            if (!name || equals === -1) {
                return;
            }

            let expression = code.slice(equals + 1);
            const opener = expression.lastIndexOf('= {');

            if (opener !== -1) {
                expression = expression.slice(0, opener);
            } else if (expression.trimEnd().endsWith('{')) {
                expression = expression.slice(0, expression.lastIndexOf('{'));
            }

            definitions.push({
                name,
                lineNumber: index + 1,
                expressionColumn: equals + 2,
                expression,
            });
        });

        return definitions;
    }

    // The index of the `=` that introduces a definition's body — the first one
    // outside the brackets of the definition head, so the `=` of a default
    // value inside a parameter list is not mistaken for it.
    private definingEquals(code: string): number {
        let depth = 0;

        for (let index = 0; index < code.length; index += 1) {
            const char = code[index];

            if (char === '(' || char === '{' || char === '[') {
                depth += 1;
            } else if (char === ')' || char === '}' || char === ']') {
                depth -= 1;
            } else if (char === '=' && depth === 0) {
                return index;
            }
        }

        return -1;
    }

    // The names a file exports: the leading identifier of every line that starts
    // in column 0 and introduces something — `name(args) = …`, `name of type`,
    // `name from category`, `name = …`. Undefined when the file cannot be read.
    private exportedNames(file: string): Set<string> | undefined {
        const cached = this.exportCache.get(file);

        if (cached !== undefined) {
            return cached ?? undefined;
        }

        const lines = this.linesOf(file);

        if (!lines) {
            this.exportCache.set(file, null);
            return undefined;
        }

        const names = new Set<string>();

        for (const line of lines) {
            const match = /^([A-Za-z_]\w*)\s*(\(|of\s|from\s|=)/.exec(this.stripCode(line));

            if (match) {
                names.add(match[1]);
            }
        }

        this.exportCache.set(file, names);

        return names;
    }

    // The lines of a file, read once and kept. Undefined when the file is
    // missing — an unresolved import reports that itself.
    private linesOf(file: string): string[] | undefined {
        const cached = this.lineCache.get(file);

        if (cached !== undefined) {
            return cached ?? undefined;
        }

        let text: string;

        try {
            text = readFileSync(file, 'utf8');
        } catch {
            this.lineCache.set(file, null);
            return undefined;
        }

        const lines = text.split('\n');
        this.lineCache.set(file, lines);

        return lines;
    }

    // The import header of a file: the leading block of `A, B from …` lines,
    // with the column of every name and of the source. Empty when the leading
    // block is not a header (`initial_data.example_*.lang` opens with an
    // enumeration, `lang.lang` with the language's own axioms).
    private importedNames(lines: string[]): ImportEntry[] {
        const header: ImportEntry[] = [];

        for (const [index, line] of lines.entries()) {
            if (line.trim().length === 0) {
                break;
            }

            const match = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+from\s+(core|\("(.*?)"\))\s*$/.exec(line);

            if (!match) {
                return [];
            }

            const names: Array<{text: string; column: number}> = [];
            let search = 0;

            for (const part of match[1].split(',')) {
                const text = part.trim();
                const column = line.indexOf(text, search) + 1;
                search = column + text.length - 1;
                names.push({text, column});
            }

            header.push({
                lineNumber: index + 1,
                names,
                source: match[3] ?? 'core',
                sourceColumn: line.indexOf(match[2]) + 1,
            });
        }

        return header;
    }

    // The vocabulary the cross-file rules need, collected once over every file
    // being linted rather than per file.
    //
    // Coordinates: the index letters the language declares in
    // `matrix_types.lang` (`I of number = 1, …, N`) and the members of every
    // top-level enumeration (`Queue = First, Second, …`,
    // `stepNullAxes from Product = AI_92, …`). A coordinate is not a variable —
    // a file names `FCA` or `R` without importing anything.
    //
    // Primitives: what `matrix_operation.lang` exports, plus the built-in
    // operators.
    private collectVocabulary(files: string[]): void {
        const coordinates = new Set<string>();
        const primitives = new Set<string>(BUILTIN_NAMES);

        for (const file of files) {
            if (path.basename(file) !== 'matrix_operation.lang') {
                continue;
            }

            for (const name of this.exportedNames(file) ?? []) {
                primitives.add(name);
            }
        }

        this.primitiveNames = primitives;

        for (const file of files) {
            const lines = this.linesOf(file);

            if (!lines) {
                continue;
            }

            for (const line of lines) {
                const code = this.stripCode(line);
                const declaration = /^\s{4}([A-Za-z]\w*)\s+of\s+number\s*=/.exec(code);

                if (declaration) {
                    coordinates.add(declaration[1]);
                    continue;
                }

                const enumeration = /^([A-Za-z_]\w*)\s*(?:(?:of|from)\s+\w+\s*)?=\s*([^={]+)$/.exec(code);

                if (!enumeration || !enumeration[2].includes(',') || /[()]/.test(enumeration[2])) {
                    continue;
                }

                const members = this.splitTopLevel(enumeration[2]).map((member) => member.trim());

                if (!members.every((member) => /^[A-Za-z_]\w*$/.test(member))) {
                    continue;
                }

                coordinates.add(enumeration[1]);

                for (const member of members) {
                    coordinates.add(member);
                }
            }
        }

        this.coordinateNames = coordinates;
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
