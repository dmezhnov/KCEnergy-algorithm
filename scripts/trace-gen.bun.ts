// Bun has no path helpers of its own; everything else below uses the Bun API.
import path from 'node:path';

import type {Coordinates} from './lang-example.bun.ts';
import {TraceEngine} from './trace-engine.bun.ts';
import {TEMPLATE_HEADER, TemplateParser} from './trace-template.bun.ts';

// Generator for the trace-string sections of the `*.example_*.lang` files.
//
// `step-n-plus-1.lang` ends with the trace-string template: a
// `## Трассировочная строка ...` header followed by `# ` lines that walk one
// request through the whole algorithm, with branches per queue and period
// (see `TraceEngine` for the notation). The matching
// `step-n-plus-1.example_N.lang` ends with the same template rendered once per
// request, in the same `# ` comment form.
//
// The generator never computes a value: every number it emits is copied from a
// leaf line of an expanded variable in some `*.example_N.lang` file, so it
// cannot disagree with the worked example — it can only disagree with the
// trace written in the file, which is the point.
//
// Usage:
//   bun run scripts/trace-gen.bun.ts            # check, exit 1 on any difference
//   bun run scripts/trace-gen.bun.ts --write    # rewrite the trace sections

// The two example data sets the algorithm files carry.
const EXAMPLE_SUFFIXES: readonly string[] = ['example_1', 'example_2'];

class TraceGenerator {
    // Render the trace section of every example file of every data set and
    // either compare it with what is on disk or write it back.
    async run(argv: string[]): Promise<number> {
        const write = argv.includes('--write');
        const root = process.cwd();
        let differing = 0;
        let checked = 0;

        for (const stepFile of await this.stepFilesWithTemplates(root)) {
            const text = TemplateParser.extract(await Bun.file(path.join(root, stepFile)).text(), stepFile)!;
            const template = new TemplateParser(text).parse();

            for (const suffix of EXAMPLE_SUFFIXES) {
                const exampleFile = stepFile.replace(/\.lang$/, `.${suffix}.lang`);
                const examplePath = path.join(root, exampleFile);

                if (!(await Bun.file(examplePath).exists())) {
                    continue;
                }

                checked += 1;
                const engine = await TraceEngine.load(root, suffix, template);
                const original = await Bun.file(examplePath).text();
                const updated = this.applySection(original, this.renderSection(engine));

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

    // The `step-*.lang` files that carry a trace-string template.
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

    // The whole trace section: one block per request, ordered by queue and then
    // by request number, blank-line separated. A blank line inside a request's
    // trace is written as a bare `#`.
    private renderSection(engine: TraceEngine): string {
        const order = (left: Coordinates, right: Coordinates): number =>
            (left.get('R') ?? 0) - (right.get('R') ?? 0) || (left.get('Z') ?? 0) - (right.get('Z') ?? 0);

        return [...engine.requests]
            .sort(order)
            .map((request) => {
                const body = engine.render(request).split('\n').map((line) => (line === '' ? '#' : `# ${line}`));
                return [`${TEMPLATE_HEADER} для запроса № ${engine.requestLabel(request)}:`, ...body].join('\n');
            })
            .join('\n\n');
    }

    // Replace the trace section of an example file — everything from its header
    // to the end of the file — or append one when the file has none yet.
    private applySection(original: string, section: string): string {
        const start = original.indexOf(`\n${TEMPLATE_HEADER}`);
        const head = (start < 0 ? original : original.slice(0, start)).replace(/\n*$/, '\n');

        return `${head}\n${section}\n`;
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

    // Print the outcome and return the exit code.
    private report(checked: number, differing: number, write: boolean): number {
        if (checked === 0) {
            process.stdout.write('No example file carries a trace-string template.\n');
            return 1;
        }

        if (!differing) {
            process.stdout.write(`Checked the trace sections of ${checked} example file(s): all match.\n`);
            return 0;
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
