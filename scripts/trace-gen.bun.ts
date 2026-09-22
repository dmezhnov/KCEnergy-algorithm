// Bun has no path helpers of its own; everything else below uses the Bun API.
import path from 'node:path';

// Generator for the trace-string sections of the `*.example_*.lang` files.
//
// Every `step-*.lang` ends with one (or, in `step-2.lang`, two) trace-string
// templates: a `## Трассировочная строка ...` header followed by `# ...` lines
// that name the values a request carries through the algorithm so far. The
// matching `step-*.example_N.lang` ends with the same template rendered once per
// request, with axis coordinates replaced by their names and variable references
// replaced by the values already written out in the example files.
//
// This script performs exactly that expansion. It never computes a value: every
// number it emits is copied verbatim from a leaf line of an expanded variable in
// some `*.example_N.lang` file, so it cannot disagree with the worked example —
// it can only disagree with the hand-written trace, which is the point.
//
// Usage:
//   bun run scripts/trace-gen.bun.ts            # check, exit 1 on any difference
//   bun run scripts/trace-gen.bun.ts --write    # rewrite the trace sections

// One coordinate of a request: axis letter (`I`, `J`, `K`, `P`, `R`, `Z`, ...)
// to the 1-based index along that axis.
type Coordinates = Map<string, number>;

// An axis enumeration from `initial_data.example_N.lang`: its letter and the
// display name of each coordinate, as the trace strings print it.
type Axis = {
    name: string;
    letter: string;
    labels: Map<number, string>;
};

// One expanded variable of an example file. `signatures` lists the distinct
// axis-letter sets its leaves use — normally one, but an `assign_matrix` result
// can mix shapes — and `leaves` maps a coordinate key to the value text exactly
// as the example file spells it.
type Block = {
    key: string;
    signatures: string[][];
    leaves: Map<string, string>;
    source: string;
};

// A rendered template line, with whether its variable reference resolved to a
// value. The flag drives the deficit/profit alternation (see `renderRequest`).
type RenderedLine = {
    template: string;
    text: string;
    resolved: boolean;
};

// The two example data sets the algorithm files carry.
const EXAMPLE_SUFFIXES: readonly string[] = ['example_1', 'example_2'];

// Header of an axis enumeration, e.g. `Refinery = ( # J`.
const AXIS_HEADER = /^([A-Za-z_][A-Za-z0-9_]*) = \(\s*#\s*([A-Za-z][A-Za-z0-9]*)\s*$/;

// One coordinate of an axis enumeration, e.g. `PKOP, # ПКОП - 1 from J`.
const AXIS_ITEM = /^\s+([^\s,#]+)\s*,?\s*#.*?(\d+)\s+from\s+([A-Za-z][A-Za-z0-9]*)\s*$/;

// A leaf line of an expanded variable, e.g. `(1 from I, 1 from J) = 1440,`.
const LEAF_LINE = /^\s+\(([^()]*)\)\s*=\s*(.*)$/;

// One `N from Axis` item of a coordinate tuple.
const COORDINATE_ITEM = /(\d+)\s+from\s+([A-Za-z][A-Za-z0-9]*)/g;

// A variable or axis reference inside a template line: an optional `$`, a name,
// and one or more parenthesised groups — `$Product(i)`,
// `estimated_i_j_k_l(1 from R)(1 from n)`, `normalized_i_j(1 from R)(n)`.
const REFERENCE = /(\$?)([A-Za-z_][A-Za-z0-9_]*)((?:\s*\([^()]*\))+)/g;

// A parenthesised group that fixes a coordinate rather than listing indices.
const QUALIFIER_GROUP = /^\s*(\d+)\s+from\s+([A-Za-z][A-Za-z0-9]*)\s*$/;

// A parenthesised group naming the normalisation iteration: `(n)` or `(n + 1)`.
const ITERATION_GROUP = /^\s*n(?:\s*\+\s*(\d+))?\s*$/;

// A template line whose text starts with a variable reference. Such lines come
// in mutually exclusive runs (deficit / profit), and only the ones that resolve
// to a value are printed.
const ALTERNATIVE_LINE = /^[a-z_][a-z0-9_]*\s*\(/;

// Header of a trace-string template in a `step-*.lang` file.
const TEMPLATE_HEADER = '## Трассировочная строка';

// What a rendered trace line shows in place of a value the example files do not
// hold for this request.
const ABSENT_VALUE = '—';

// The queue axis. A trace line qualified by a queue reports what that queue
// did, so it shows a value only for the requests of that queue: a request of
// another queue carries nothing through it, even where the queue's coarser
// (i, j) aggregates do hold a number for its refinery.
const QUEUE_AXIS = 'R';

// The variables a queue qualifier does NOT restrict: a cumulative total is what
// the request itself has been given across every queue up to the named one, so
// it is meaningful for a request of any queue (Steps 10a, 13a and 16a).
const CUMULATIVE_VARIABLES = new Set(['estimated_i_j_k_l_total']);

// The variable whose iteration count defines `n` for a queue: the normalisation
// loop of Step 6 produces one `normalized_i_j_k_l(queue)(N from n)` per pass, so
// the highest `N` present is the `n` the trace templates refer to.
const ITERATION_COUNTER = 'normalized_i_j_k_l';

// This is the shared entry point for generating and checking the trace-string
// sections of the example files.
class TraceGenerator {
    private axesByName = new Map<string, Axis>();
    private blocks = new Map<string, Block>();
    private requests: Coordinates[] = [];
    private diagnostics: string[] = [];

    // Render the trace section of every example file of every data set and
    // either compare it with what is on disk or write it back.
    async run(argv: string[]): Promise<number> {
        const write = argv.includes('--write');
        const root = process.cwd();
        let differing = 0;
        let checked = 0;

        for (const suffix of EXAMPLE_SUFFIXES) {
            await this.loadExample(root, suffix);

            for (const stepFile of await this.stepFilesWithTemplates(root)) {
                const exampleFile = stepFile.replace(/\.lang$/, `.${suffix}.lang`);
                const examplePath = path.join(root, exampleFile);

                if (!(await Bun.file(examplePath).exists())) {
                    continue;
                }

                checked += 1;
                const original = await Bun.file(examplePath).text();
                const templates = this.parseTemplates(await Bun.file(path.join(root, stepFile)).text());
                const updated = this.applySection(original, this.renderSection(templates));

                if (updated === original) {
                    continue;
                }

                differing += 1;

                if (write) {
                    await Bun.write(examplePath, updated);
                    process.stdout.write(`${exampleFile}: rewritten\n`);
                    continue;
                }

                for (const difference of this.collectDifferences(original, updated)) {
                    process.stdout.write(`${exampleFile}:${difference}\n`);
                }
            }
        }

        return this.report(checked, differing, write);
    }

    // Load one data set: its axis enumerations, every expanded variable of every
    // example file, and the request table that drives the trace order.
    private async loadExample(root: string, suffix: string): Promise<void> {
        this.axesByName = new Map();
        this.blocks = new Map();
        this.requests = [];

        const files = [...new Bun.Glob(`*.${suffix}.lang`).scanSync(root)].sort();

        for (const file of files) {
            const text = await Bun.file(path.join(root, file)).text();
            this.parseAxes(text);
            this.parseBlocks(text, file);
        }

        this.collectRequests(suffix);
    }

    // Read the axis enumerations — `Refinery = ( # J` and its coordinate lines.
    private parseAxes(text: string): void {
        const lines = text.split('\n');

        for (let index = 0; index < lines.length; index += 1) {
            const header = AXIS_HEADER.exec(lines[index]);

            if (!header) {
                continue;
            }

            const axis: Axis = {name: header[1], letter: header[2], labels: new Map()};

            for (index += 1; index < lines.length && !lines[index].startsWith(')'); index += 1) {
                const item = AXIS_ITEM.exec(lines[index]);

                if (item && item[3] === axis.letter) {
                    axis.labels.set(Number(item[2]), item[1]);
                }
            }

            this.axesByName.set(axis.name, axis);
        }
    }

    // Read every top-level expanded variable of one example file. A definition
    // starts in column 0 and its body runs to the line that closes its braces.
    private parseBlocks(text: string, file: string): void {
        const lines = text.split('\n');

        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];

            if (!line || line.startsWith('#') || /^\s/.test(line) || !line.includes(' = ')) {
                continue;
            }

            const key = this.normalizeKey(line.slice(0, line.indexOf(' = ')).trim());
            const block: Block = {key, signatures: [], leaves: new Map(), source: file};

            let depth = this.braceBalance(line);

            for (index += 1; depth > 0 && index < lines.length; index += 1) {
                this.collectLeaf(lines[index], block);
                depth += this.braceBalance(lines[index]);
            }

            index -= 1;
            this.addBlock(block);
        }
    }

    // Record one leaf line of an expanded variable, ignoring the group openers
    // (`(1 from I) = {`) that only introduce a nesting level.
    private collectLeaf(line: string, block: Block): void {
        const leaf = LEAF_LINE.exec(line);

        if (!leaf || leaf[2].trimEnd().endsWith('{')) {
            return;
        }

        const coordinates = this.parseCoordinates(leaf[1]);
        const signature = [...coordinates.keys()].sort();

        if (!block.signatures.some((known) => known.join() === signature.join())) {
            block.signatures.push(signature);
        }

        block.leaves.set(this.coordinateKey(coordinates, signature), this.leafValue(leaf[2]));
    }

    // The value a leaf line states: its trailing comment and list comma dropped,
    // and — where the line shows its arithmetic — only the total kept.
    private leafValue(text: string): string {
        const withoutComment = text.split(/\s+#/)[0].trim().replace(/,$/, '').trim();
        const lastEquals = withoutComment.lastIndexOf(' = ');

        return lastEquals < 0 ? withoutComment : withoutComment.slice(lastEquals + 3).trim();
    }

    // Store a block, reporting the ambiguity if two example files expand the
    // same name and qualifiers — a lookup could not then pick between them.
    private addBlock(block: Block): void {
        const existing = this.blocks.get(block.key);

        if (existing) {
            this.diagnostics.push(
                `${block.source}: ${block.key} is also expanded in ${existing.source}; trace values are ambiguous`,
            );
            return;
        }

        this.blocks.set(block.key, block);
    }

    // Build the request list from the input matrix, ordered the way the example
    // files print their traces: by queue, then by request number.
    private collectRequests(suffix: string): void {
        const table = this.blocks.get('requests_i_j_x_k_l_s_l0_q');

        if (!table) {
            this.diagnostics.push(`${suffix}: requests_i_j_x_k_l_s_l0_q is not expanded; no traces can be rendered`);
            return;
        }

        this.requests = [...table.leaves.keys()]
            .map((key) => this.coordinatesFromKey(key))
            .sort((left, right) => (left.get('R') ?? 0) - (right.get('R') ?? 0) || (left.get('Z') ?? 0) - (right.get('Z') ?? 0));
    }

    // The `step-*.lang` files that carry a trace-string template, in the order
    // the algorithm runs them (which is also the order they are checked in).
    private async stepFilesWithTemplates(root: string): Promise<string[]> {
        const files = [...new Bun.Glob('step-*.lang').scanSync(root)].filter((file) => !file.includes('.example_'));
        const withTemplate: string[] = [];

        for (const file of files.sort()) {
            if ((await Bun.file(path.join(root, file)).text()).includes(`\n${TEMPLATE_HEADER}`)) {
                withTemplate.push(file);
            }
        }

        return withTemplate;
    }

    // Split a spec file's trailing trace-string templates into their body lines.
    // `step-2.lang` states two alternative templates; every other file one.
    private parseTemplates(text: string): string[][] {
        const lines = text.split('\n');
        const templates: string[][] = [];

        for (let index = 0; index < lines.length; index += 1) {
            if (!lines[index].startsWith(TEMPLATE_HEADER)) {
                continue;
            }

            const body: string[] = [];

            for (index += 1; index < lines.length && lines[index].startsWith('# '); index += 1) {
                body.push(lines[index]);
            }

            index -= 1;
            templates.push(body);
        }

        return templates;
    }

    // Render the whole trace section: one block per request, blank-line separated.
    private renderSection(templates: string[][]): string {
        return this.requests.map((request) => this.renderRequest(templates, request)).join('\n\n');
    }

    // Render one request's trace. Where a spec file offers several templates the
    // one whose every reference resolves is used; within a template, a run of
    // adjacent lines that each start with a variable reference is an alternation
    // (deficit / profit) of which only the resolving lines are printed.
    private renderRequest(templates: string[][], request: Coordinates): string {
        const rendered = templates.map((template) => template.map((line) => this.renderLine(line, request)));
        const chosen = rendered.find((lines) => lines.every((line) => line.resolved)) ?? rendered[0];
        const body: string[] = [];

        for (let index = 0; index < chosen.length; index += 1) {
            const run = this.alternationRun(chosen, index);

            if (run.length < 2) {
                body.push(chosen[index].text);
                continue;
            }

            const resolved = run.filter((line) => line.resolved);
            body.push(...(resolved.length ? resolved : [run[0]]).map((line) => line.text));
            index += run.length - 1;
        }

        const number = this.coordinateLabel('Request', request);

        return [`${TEMPLATE_HEADER} для запроса № ${number}:`, ...body].join('\n');
    }

    // The maximal run of adjacent alternative lines starting at `start`, i.e.
    // template lines whose text begins with a variable reference.
    private alternationRun(lines: RenderedLine[], start: number): RenderedLine[] {
        const isAlternative = (line: RenderedLine): boolean => ALTERNATIVE_LINE.test(line.template.slice(2));
        const run: RenderedLine[] = [];

        for (let index = start; index < lines.length && isAlternative(lines[index]); index += 1) {
            run.push(lines[index]);
        }

        return run;
    }

    // Substitute every axis and variable reference of one template line.
    private renderLine(line: string, request: Coordinates): RenderedLine {
        let resolved = true;

        const text = line.replace(REFERENCE, (match, _dollar: string, name: string, groups: string) => {
            const axis = this.axesByName.get(name);

            if (axis) {
                return this.coordinateLabel(name, request) ?? match;
            }

            const value = this.lookupValue(name, groups, request);

            if (value === undefined) {
                resolved = false;
                return ABSENT_VALUE;
            }

            return value;
        });

        return {template: line, text, resolved};
    }

    // The value a variable reference carries for one request: the leaf of the
    // referenced block whose coordinates are the request's own.
    private lookupValue(name: string, groups: string, request: Coordinates): string | undefined {
        const qualifiers = this.resolveQualifiers(name, groups);
        const key = this.normalizeKey(name + qualifiers.map((qualifier) => `(${qualifier})`).join(''));
        const block = this.blocks.get(key);

        if (!block) {
            this.diagnostics.push(`${key} is referenced by a trace template but not expanded in any example file`);
            return undefined;
        }

        if (!this.belongsToQueue(name, qualifiers, request)) {
            return undefined;
        }

        for (const signature of block.signatures) {
            if (signature.every((letter) => request.has(letter))) {
                const value = block.leaves.get(this.coordinateKey(request, signature));

                if (value !== undefined) {
                    return value;
                }
            }
        }

        return undefined;
    }

    // Whether a request takes part in the queue a reference is qualified by.
    // A reference without a queue qualifier — Steps 1 to 3, which run before the
    // queues are split — applies to every request, and so does a cumulative one.
    private belongsToQueue(name: string, qualifiers: string[], request: Coordinates): boolean {
        if (CUMULATIVE_VARIABLES.has(name)) {
            return true;
        }

        for (const qualifier of qualifiers) {
            const fixed = QUALIFIER_GROUP.exec(qualifier);

            if (fixed && fixed[2] === QUEUE_AXIS) {
                return request.get(QUEUE_AXIS) === Number(fixed[1]);
            }
        }

        return true;
    }

    // Turn a reference's parenthesised groups into the qualifiers that identify
    // an expanded block: index lists are dropped, and `(n)` / `(n + 1)` are
    // resolved against the number of normalisation passes the queue ran.
    private resolveQualifiers(name: string, groups: string): string[] {
        const qualifiers: string[] = [];

        for (const group of groups.match(/\(([^()]*)\)/g) ?? []) {
            const body = group.slice(1, -1);
            const fixed = QUALIFIER_GROUP.exec(body);

            if (fixed) {
                qualifiers.push(`${fixed[1]} from ${fixed[2]}`);
                continue;
            }

            const iteration = ITERATION_GROUP.exec(body);

            if (iteration) {
                qualifiers.push(`${this.iterationCount(qualifiers) + Number(iteration[1] ?? 0)} from n`);
            }
        }

        return qualifiers;
    }

    // The `n` of the trace templates for one queue: how many normalisation
    // passes Step 6 ran, i.e. the highest iteration the loop's result carries.
    private iterationCount(qualifiers: string[]): number {
        const prefix = this.normalizeKey(ITERATION_COUNTER + qualifiers.map((qualifier) => `(${qualifier})`).join(''));
        let count = 1;

        for (let iteration = 1; this.blocks.has(`${prefix}(${iteration} from n)`); iteration += 1) {
            count = iteration;
        }

        return count;
    }

    // Replace the trace section of an example file, preserving whether the file
    // ends with a newline.
    private applySection(original: string, section: string): string {
        const start = original.indexOf(`\n${TEMPLATE_HEADER}`);

        if (start < 0) {
            return original;
        }

        return original.slice(0, start + 1) + section + (original.endsWith('\n') ? '\n' : '');
    }

    // Every line at which the regenerated section departs from the file. The
    // comparison is positional: a line the generator adds or drops shifts the
    // rest of the block, so one real difference can show up as a run of lines.
    private collectDifferences(original: string, updated: string): string[] {
        const before = original.split('\n');
        const after = updated.split('\n');
        const differences: string[] = [];

        for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
            if (before[index] !== after[index]) {
                differences.push(
                    `${index + 1}: have ${JSON.stringify(before[index] ?? null)}, want ${JSON.stringify(after[index] ?? null)}`,
                );
            }
        }

        return differences.length ? differences : ['trailing newline differs'];
    }

    // The display name of a request's coordinate along one axis.
    private coordinateLabel(axisName: string, request: Coordinates): string | undefined {
        const axis = this.axesByName.get(axisName);
        const index = axis && request.get(axis.letter);

        return index === undefined ? undefined : axis?.labels.get(index);
    }

    // Parse a coordinate tuple such as `1 from I, 4 from K, 12 from P`.
    private parseCoordinates(text: string): Coordinates {
        const coordinates: Coordinates = new Map();

        for (const item of text.matchAll(COORDINATE_ITEM)) {
            coordinates.set(item[2], Number(item[1]));
        }

        return coordinates;
    }

    // The lookup key of one leaf: its coordinates along the given axes only.
    private coordinateKey(coordinates: Coordinates, signature: string[]): string {
        return signature.map((letter) => `${letter}=${coordinates.get(letter)}`).join(';');
    }

    // The inverse of `coordinateKey`, used to read the request table back.
    private coordinatesFromKey(key: string): Coordinates {
        return new Map(key.split(';').map((part) => {
            const [letter, index] = part.split('=');
            return [letter, Number(index)] as const;
        }));
    }

    // Collapse the index padding the example files use (`12 from P`, `1  from P`)
    // so that a reference and its definition produce the same key.
    private normalizeKey(text: string): string {
        return text.replace(/\s+/g, ' ').replace(/\(\s*/g, '(').replace(/\s*\)/g, ')');
    }

    // The net number of braces a line opens.
    private braceBalance(line: string): number {
        const code = line.split(/\s+#/)[0];

        return (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;
    }

    // Print the diagnostics collected along the way and return the exit code.
    private report(checked: number, differing: number, write: boolean): number {
        for (const diagnostic of [...new Set(this.diagnostics)]) {
            process.stdout.write(`warning: ${diagnostic}\n`);
        }

        if (!differing) {
            process.stdout.write(`Checked the trace sections of ${checked} example file(s): all match.\n`);
            return this.diagnostics.length ? 1 : 0;
        }

        const verb = write ? 'Rewrote' : 'Found differences in';
        process.stdout.write(`\n${verb} ${differing} of ${checked} trace section(s).\n`);

        return write ? 0 : 1;
    }
}

if (import.meta.main) {
    process.exitCode = await new TraceGenerator().run(Bun.argv.slice(2));
}

export {TraceGenerator};
