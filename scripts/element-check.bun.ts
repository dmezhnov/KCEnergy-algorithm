import {Decimal} from './lang-decimal.bun.ts';
import {ExampleIndex} from './lang-example.bun.ts';
import type {Block, Leaf} from './lang-example.bun.ts';

// Checker for the `for_each_element` leaves of the `*.example_*.lang` files.
//
// Where a matrix is the result of `for_each_element(source, operat, value)`,
// every leaf it carries is the leaf of `source` at the same coordinates with one
// operation applied to it and to a scalar the example files fix. Both the source
// matrix and the scalar are written down, so this script re-derives the result
// and compares:
//
//   * the set of leaves, which is the set of leaves of `source`,
//   * the arithmetic each leaf displays, in both of the forms the files use —
//     `1200 * OVERALL_REQUEST_CAPACITY_COEFFICIENT = 1200 * 1.2` — and
//   * the value the leaf states after the last `=`.
//
// As with the `sum_by_axes`, `for_each_pair` and `filter_by_pair` checkers it
// re-computes only the operation; every input is read from the example files, so
// a disagreement is an arithmetic error in the worked example, never a second
// implementation of the algorithm.
//
// Usage:
//   bun run scripts/element-check.bun.ts    # exit 1 on any disagreement

// The two example data sets the algorithm files carry.
const EXAMPLE_SUFFIXES: readonly string[] = ['example_1', 'example_2'];

// How many fraction digits the example files keep. A quotient or a product that
// does not terminate sooner is cut to this many digits, towards zero.
const DISPLAY_DIGITS = 18;

// A `for_each_element` definition: the source matrix, the operation and the
// scalar parameter.
const ELEMENT_CALL = /^for_each_element\((.+)\)$/;

// The scalar an operation is applied with: the number itself, the text the
// example files spell it as, and the names that stand for it — the parameter's
// own name and, where its definition derives it from another constant, that
// constant too, since the leaves print whichever the step file uses.
type Parameter = {
    decimal: Decimal;
    text: string;
    names: string[];
};

// One operation `for_each_element` can apply: how it computes a cell, how a leaf
// spells it, and whether that spelling shows the parameter at all — `round` puts
// only the number it rounds on the line, its digit count is implied.
type Operation = {
    apply: (source: Decimal, value: Decimal) => Decimal | undefined;
    render: (source: string, value: string) => string;
    showsValue: boolean;
};

// The operations the example files apply. `floor`, which the step files offer as
// the alternative to `round`, is not among them and is left unimplemented rather
// than guessed at.
const OPERATIONS: ReadonlyMap<string, Operation> = new Map<string, Operation>([
    ['"*"', {
        apply: (source, value) => source.times(value).truncated(DISPLAY_DIGITS),
        render: (source, value) => `${source} * ${value}`,
        showsValue: true,
    }],
    ['safe_divide', {
        apply: (source, value) => (value.isZero() ? Decimal.ZERO : source.dividedBy(value, DISPLAY_DIGITS)),
        render: (source, value) => `${source} / ${value}`,
        showsValue: true,
    }],
    ['round', {
        apply: (source, value) => source.rounded(Number(value.toString())),
        render: (source) => `round(${source})`,
        showsValue: false,
    }],
    ['max', {
        apply: (source, value) => source.max(value),
        render: (source, value) => `max(${source}, ${value})`,
        showsValue: true,
    }],
]);

class ElementChecker {
    private index = new ExampleIndex();
    private findings: string[] = [];
    private notes: string[] = [];
    private checkedBlocks = 0;
    private checkedLeaves = 0;

    // Check every `for_each_element` result of every data set.
    async run(): Promise<number> {
        const root = process.cwd();

        for (const suffix of EXAMPLE_SUFFIXES) {
            this.index = await ExampleIndex.load(root, suffix);
            this.notes.push(...this.index.diagnostics);

            for (const block of this.index.blockList) {
                const call = ELEMENT_CALL.exec(block.expression);

                if (call) {
                    this.checkBlock(block, ExampleIndex.splitArguments(call[1]));
                }
            }
        }

        return this.report();
    }

    // Compare one `for_each_element` result with the matrix and the scalar it is
    // made of.
    private checkBlock(block: Block, args: string[]): void {
        if (args.length !== 3) {
            this.findings.push(`${block.file}:${block.line}: ${block.name}: expected three arguments, got ${args.length}`);
            return;
        }

        const [sourceReference, operationName, valueReference] = args;
        const operation = OPERATIONS.get(operationName);

        if (!operation) {
            this.notes.push(`${block.file}:${block.line}: ${block.name}: operation ${operationName} is not implemented`);
            return;
        }

        const source = this.source(block, sourceReference);
        const parameter = this.parameter(block, valueReference);

        if (!source || !parameter) {
            return;
        }

        const axes = this.sourceAxes(block, source);

        if (!axes) {
            return;
        }

        this.checkedBlocks += 1;
        this.compareLeaves(block, source, axes, operation, parameter);
    }

    // The block the source reference names. A source that is a nested call, or a
    // variable no example file expands, leaves nothing to read the values from.
    private source(block: Block, reference: string): Block | undefined {
        const source = this.index.resolve(reference);

        if (!source) {
            this.notes.push(`${block.file}:${block.line}: ${block.name}: ${reference} is not an expanded variable`);
        }

        return source;
    }

    // The scalar the operation is applied with: either a literal on the call
    // itself (the digit count of `round`) or a constant the example files fix.
    private parameter(block: Block, reference: string): Parameter | undefined {
        const literal = Decimal.parse(reference);

        if (literal) {
            return {decimal: literal, text: reference, names: []};
        }

        const scalar = this.index.scalar(reference);
        const value = scalar && Decimal.parse(scalar.value);

        if (!scalar || !value) {
            this.notes.push(`${block.file}:${block.line}: ${block.name}: ${reference} is not a scalar the example files fix`);
            return undefined;
        }

        return {decimal: value, text: scalar.value, names: scalar.names};
    }

    // The axes the result is laid out on, which are the source's own: the
    // operation touches the value of a cell, never its coordinates.
    private sourceAxes(block: Block, source: Block): string[] | undefined {
        if (source.signatures.length > 1) {
            this.notes.push(`${block.file}:${block.line}: ${block.name}: ${source.name} mixes leaf shapes; not checked`);
            return undefined;
        }

        if (!source.leaves.length) {
            this.reportEmptySource(block, source);
            return undefined;
        }

        return source.signatures[0] ?? [];
    }

    // An empty source produces an empty result: there is nothing to compute, and
    // any leaf the result does carry has no source.
    private reportEmptySource(block: Block, source: Block): void {
        this.notes.push(`${block.file}:${block.line}: ${block.name}: ${source.name} is empty`);

        for (const leaf of block.leaves) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: ${source.name} is empty, so this leaf has no source`);
        }
    }

    // Walk the leaves of the source, which are the leaves the result is laid out
    // on, then report the result leaves that no source leaf accounts for.
    private compareLeaves(block: Block, source: Block, axes: string[], operation: Operation, parameter: Parameter): void {
        const results = new Map(block.leaves.map((leaf) => [this.index.coordinateKey(leaf.coordinates, axes), leaf]));

        for (const cell of source.leaves) {
            const key = this.index.coordinateKey(cell.coordinates, axes);
            const leaf = results.get(key);
            results.delete(key);

            this.compareLeaf(block, key, leaf, cell, operation, parameter);
        }

        for (const [key, leaf] of results) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: no leaf of ${source.name} produces ${key}`);
        }
    }

    // Compare one result leaf with the cell it is made of: first the arithmetic
    // the leaf displays, then the value it states. A leaf the result leaves out
    // is only reported when the operation does not produce a zero there — as with
    // `sum_by_axes`, a cell that comes out zero may carry no leaf at all.
    private compareLeaf(block: Block, key: string, leaf: Leaf | undefined, cell: Leaf, operation: Operation, parameter: Parameter): void {
        const value = Decimal.parse(cell.total);

        if (!value) {
            this.findings.push(`${block.file}:${leaf?.line ?? block.line}: ${block.name}: ${cell.text.trim()} is not a number`);
            return;
        }

        const expected = operation.apply(value, parameter.decimal);
        const arithmetic = operation.render(cell.total, parameter.text);

        if (!expected) {
            this.findings.push(`${block.file}:${leaf?.line ?? block.line}: ${block.name}: ${arithmetic} divides by zero`);
            return;
        }

        if (!leaf) {
            if (!expected.isZero()) {
                this.findings.push(`${block.file}:${block.line}: ${block.name}: no leaf for ${key}, where ${arithmetic} gives ${expected}`);
            }

            return;
        }

        this.checkedLeaves += 1;
        this.compareStages(block, leaf, cell, operation, parameter);

        const total = Decimal.parse(leaf.total);

        if (!total || !total.equals(expected)) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: states ${leaf.total}, ${arithmetic} gives ${expected}`);
        }
    }

    // Compare the arithmetic a leaf displays with the arithmetic it is made of.
    // A leaf shows the operation twice where the parameter has a name — once
    // naming it, once with its value — and once where the call passes a literal.
    private compareStages(block: Block, leaf: Leaf, cell: Leaf, operation: Operation, parameter: Parameter): void {
        if (!leaf.stages.length) {
            this.notes.push(`${block.file}:${leaf.line}: ${block.name}: leaf shows no arithmetic`);
            return;
        }

        const shown = leaf.stages.map((stage) => this.collapse(stage));
        const numeric = this.collapse(operation.render(cell.total, parameter.text));
        const named = operation.showsValue
            ? parameter.names.map((name) => this.collapse(operation.render(cell.total, name)))
            : [];

        if (named.length ? shown.length === 2 && named.includes(shown[0]) && shown[1] === numeric : shown.length === 1 && shown[0] === numeric) {
            return;
        }

        const expected = [...named.slice(0, 1), numeric].join(' = ');

        this.findings.push(`${block.file}:${leaf.line}: ${block.name}: shows ${shown.join(' = ')}, the arithmetic is ${expected}`);
    }

    // One displayed form with the padding the example files align leaves with
    // collapsed away, so that `500  * 1.2` and `500 * 1.2` compare equal.
    private collapse(text: string): string {
        return text.replace(/\s+/g, ' ').trim();
    }

    // Print what was checked, what could not be, and what disagrees.
    private report(): number {
        for (const note of [...new Set(this.notes)]) {
            process.stdout.write(`note: ${note}\n`);
        }

        for (const finding of this.findings) {
            process.stdout.write(`${finding}\n`);
        }

        const scope = `${this.checkedLeaves} leaf/leaves of ${this.checkedBlocks} for_each_element result(s)`;

        if (this.findings.length) {
            process.stdout.write(`\nFound ${this.findings.length} disagreement(s) in ${scope}.\n`);
            return 1;
        }

        process.stdout.write(`Recomputed ${scope}: all match.\n`);

        return 0;
    }
}

if (import.meta.main) {
    process.exitCode = await new ElementChecker().run();
}

export {ElementChecker};
