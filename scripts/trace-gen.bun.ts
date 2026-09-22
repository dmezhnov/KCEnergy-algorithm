// Bun has no path helpers of its own; everything else below uses the Bun API.
import path from 'node:path';

import {ExampleIndex} from './lang-example.bun.ts';
import type {Coordinates} from './lang-example.bun.ts';

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

// A rendered template line, with whether its variable reference resolved to a
// value. The flag drives the deficit/profit alternation (see `renderRequest`).
type RenderedLine = {
    template: string;
    text: string;
    resolved: boolean;
};

// The two example data sets the algorithm files carry.
const EXAMPLE_SUFFIXES: readonly string[] = ['example_1', 'example_2'];

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
    private index = new ExampleIndex();
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
        this.index = await ExampleIndex.load(root, suffix);
        this.requests = [];
        this.diagnostics.push(...this.index.diagnostics);

        this.collectRequests(suffix);
    }

    // Build the request list from the input matrix, ordered the way the example
    // files print their traces: by queue, then by request number.
    private collectRequests(suffix: string): void {
        const table = this.index.blocks.get('requests_i_j_x_k_l_s_l0_q');

        if (!table) {
            this.diagnostics.push(`${suffix}: requests_i_j_x_k_l_s_l0_q is not expanded; no traces can be rendered`);
            return;
        }

        this.requests = [...table.values.keys()]
            .map((key) => this.index.coordinatesFromKey(key))
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
            const axis = this.index.axesByName.get(name);

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
        const key = this.index.normalizeKey(name + qualifiers.map((qualifier) => `(${qualifier})`).join(''));
        const block = this.index.blocks.get(key);

        if (!block) {
            this.diagnostics.push(`${key} is referenced by a trace template but not expanded in any example file`);
            return undefined;
        }

        if (!this.belongsToQueue(name, qualifiers, request)) {
            return undefined;
        }

        for (const signature of block.signatures) {
            if (signature.every((letter) => request.has(letter))) {
                const value = block.values.get(this.index.coordinateKey(request, signature));

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
        const prefix = this.index.normalizeKey(ITERATION_COUNTER + qualifiers.map((qualifier) => `(${qualifier})`).join(''));
        let count = 1;

        for (let iteration = 1; this.index.blocks.has(`${prefix}(${iteration} from n)`); iteration += 1) {
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
        const axis = this.index.axesByName.get(axisName);
        const index = axis && request.get(axis.letter);

        return index === undefined ? undefined : axis?.labels.get(index);
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
