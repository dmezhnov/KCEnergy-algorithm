import {Decimal} from './lang-decimal.bun.ts';
import {ExampleIndex} from './lang-example.bun.ts';
import type {Block, Leaf} from './lang-example.bun.ts';
import {MatrixOperation} from './lang-operation.bun.ts';
import {OperandEvaluator} from './lang-operand.bun.ts';
import type {Cell, Matrix} from './lang-operand.bun.ts';

// Checker for the `filter_by_pair` leaves of the `*.example_*.lang` files.
//
// Where a matrix is the result of `filter_by_pair(source, condit, condition)`,
// every leaf it carries is a cell of `source` that the condition keeps, with its
// value copied over unchanged. Both operands are written down in the example
// files — or computed from them by `OperandEvaluator`, which is how the
// `filter_by_coordinate(ship_terms_count_by_requests_l0_*, First)` conditions of
// `step-6.example_*.lang` are read — so this script re-derives the whole result
// and compares:
//
//   * the set of leaves — exactly the cells of `source` that pass the condition,
//   * the value of each of them, which must be the source value verbatim, and
//   * the comparison a leaf shows in its comment, where it shows one.
//
// As with the `sum_by_axes` and `for_each_pair` checkers it re-computes only the
// operation; every input is read from the example files, so a disagreement is an
// error in the worked example, never a second implementation of the algorithm.
//
// Usage:
//   bun run scripts/filter-check.bun.ts    # exit 1 on any disagreement

// The two example data sets the algorithm files carry.
const EXAMPLE_SUFFIXES: readonly string[] = ['example_1', 'example_2'];

// A `filter_by_pair` definition: the source, the condition and the matrix it is
// compared against. A call nested inside another primitive is not matched here —
// its leaves belong to the outer result, not to the filter.
const FILTER_CALL = /^filter_by_pair\((.+)\)$/;

// The condition that keeps a cell when the condition matrix carries one at the
// same coordinates at all, whatever value it holds.
const CONTAINS = MatrixOperation.CONTAINS;

class FilterChecker {
    private index = new ExampleIndex();
    private evaluator = new OperandEvaluator(this.index);
    private findings: string[] = [];
    private notes: string[] = [];
    private checkedBlocks = 0;
    private checkedLeaves = 0;

    // Check every `filter_by_pair` result of every data set.
    async run(): Promise<number> {
        const root = process.cwd();

        for (const suffix of EXAMPLE_SUFFIXES) {
            this.index = await ExampleIndex.load(root, suffix);
            this.evaluator = new OperandEvaluator(this.index);
            this.notes.push(...this.index.diagnostics);

            for (const block of this.index.blockList) {
                const call = FILTER_CALL.exec(block.expression);

                if (call) {
                    this.checkBlock(block, ExampleIndex.splitArguments(call[1]));
                }
            }

            this.notes.push(...this.evaluator.notes);
        }

        return this.report();
    }

    // Compare one `filter_by_pair` result with the two matrices it is made of.
    private checkBlock(block: Block, args: string[]): void {
        const where = `${block.file}:${block.line}: ${block.name}`;

        if (args.length !== 3) {
            this.findings.push(`${where}: expected three arguments, got ${args.length}`);
            return;
        }

        const [sourceReference, condition, conditionReference] = args;

        if (condition !== CONTAINS && !MatrixOperation.compares(condition)) {
            this.notes.push(`${where}: condition ${condition} is not implemented`);
            return;
        }

        const source = this.evaluator.evaluate(sourceReference, where);
        const against = this.evaluator.evaluate(conditionReference, where);

        if (!source || !against) {
            return;
        }

        if (!source.cells.size) {
            this.reportEmptySource(block, source, where);
            return;
        }

        const readable = this.readableAlong(source, against, where);

        if (!readable) {
            return;
        }

        this.checkedBlocks += 1;
        this.compareLeaves(block, source, readable, condition, where);
    }

    // The condition matrix as the source can read it: it is read on the axes it
    // carries itself — an `I, J` condition selects whole `I, J, K, P` groups of
    // the source — which must be axes the source carries as well. An axis only
    // the condition carries is readable when it holds a single coordinate:
    // `filter_by_coordinate` removes coordinates, not axes, so filtering down to
    // one coordinate leaves a degenerate axis that says nothing. An axis holding
    // several would fold distinct cells onto one key, and is refused.
    private readableAlong(source: Matrix, against: Matrix, where: string): Matrix | undefined {
        const extra = against.axes.filter((letter) => !source.axes.includes(letter));

        if (!extra.length) {
            return against;
        }

        const axes = against.axes.filter((letter) => source.axes.includes(letter));
        const cells = new Map<string, Cell>();

        for (const cell of against.cells.values()) {
            const key = this.index.coordinateKey(cell.coordinates, axes);

            if (cells.has(key)) {
                this.findings.push(`${where}: ${against.name} carries ${extra.join(', ')}, which ${source.name} does not`);
                return undefined;
            }

            cells.set(key, cell);
        }

        return {axes, cells, name: against.name};
    }

    // An empty source produces an empty result: there is nothing to filter, and
    // any leaf the result does carry has no source.
    private reportEmptySource(block: Block, source: Matrix, where: string): void {
        this.notes.push(`${where}: ${source.name} is empty`);

        for (const leaf of block.leaves) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: ${source.name} is empty, so this leaf has no source`);
        }
    }

    // Walk the cells of the source, which are the only ones the result may
    // carry, then report the result leaves that no source cell accounts for.
    private compareLeaves(block: Block, source: Matrix, against: Matrix, condition: string, where: string): void {
        const results = new Map(block.leaves.map((leaf) => [this.index.coordinateKey(leaf.coordinates, source.axes), leaf]));

        for (const [key, cell] of source.cells) {
            const leaf = results.get(key);
            results.delete(key);

            this.compareLeaf(block, key, leaf, cell, against.cells.get(this.index.coordinateKey(cell.coordinates, against.axes))?.value, condition, where);
        }

        for (const [key, leaf] of results) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: no cell of ${source.name} produces ${key}`);
        }
    }

    // Compare one candidate cell with the result: a cell the condition keeps must
    // carry a leaf whose value is the source value verbatim, and a cell it drops
    // must carry none.
    private compareLeaf(
        block: Block,
        key: string,
        leaf: Leaf | undefined,
        cell: Cell,
        conditionValue: string | undefined,
        condition: string,
        where: string,
    ): void {
        const kept = this.keeps(cell, conditionValue, condition, where);

        if (kept === undefined) {
            return;
        }

        if (!kept) {
            if (leaf) {
                this.findings.push(`${block.file}:${leaf.line}: ${block.name}: ${this.render(cell, conditionValue, condition)} is false, so ${key} should be filtered out`);
            }

            return;
        }

        if (!leaf) {
            this.findings.push(`${where}: no leaf for ${key}, where ${this.render(cell, conditionValue, condition)} holds`);
            return;
        }

        this.checkedLeaves += 1;
        this.compareComment(block, leaf, cell, conditionValue, condition);

        if (leaf.total !== cell.value) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: states ${leaf.total}, ${cell.value} is what the source carries`);
        }
    }

    // Compare the comparison a leaf states in its comment with the pair it was
    // kept by. The pair may be stated either way round — `245 > 10` and
    // `1200 < 1391.82926829268292674` are both in `step-5.example_2.lang` — and a
    // comment that states no comparison at all makes no claim to check.
    private compareComment(block: Block, leaf: Leaf, cell: Cell, conditionValue: string | undefined, condition: string): void {
        const shown = MatrixOperation.comparisonShown(leaf.text);

        if (!shown || condition === CONTAINS || conditionValue === undefined) {
            return;
        }

        const straight = shown.left === cell.value && shown.right === conditionValue && shown.operator === condition.replaceAll('"', '');
        const mirrored = shown.left === conditionValue && shown.right === cell.value && shown.operator === MatrixOperation.mirrored(condition);

        if (!straight && !mirrored) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: comment states ${shown.left} ${shown.operator} ${shown.right}, the pair is ${this.render(cell, conditionValue, condition)}`);
        }
    }

    // Whether the condition keeps one cell. A cell the condition matrix does not
    // carry is dropped whatever the condition: there is no pair to compare, which
    // is what `requests_i_j_corrected_exceed(2 from R)` of `step-5.example_1.lang`
    // spells out — «ПКОП без ячейки». Undefined marks a cell that cannot be
    // decided — a value that is not a number — which is reported here and then
    // left out of the comparison.
    private keeps(cell: Cell, conditionValue: string | undefined, condition: string, where: string): boolean | undefined {
        if (condition === CONTAINS || conditionValue === undefined) {
            return conditionValue !== undefined;
        }

        const left = Decimal.parse(cell.value);
        const right = Decimal.parse(conditionValue);

        if (!left || !right) {
            this.findings.push(`${where}: ${this.render(cell, conditionValue, condition)} is not a comparison of numbers`);
            return undefined;
        }

        return MatrixOperation.compare(condition, left, right);
    }

    // The comparison one cell stands or falls by, spelled the way the example
    // files spell a condition. A cell the condition matrix does not carry reads
    // as absent rather than as a number.
    private render(cell: Cell, conditionValue: string | undefined, condition: string): string {
        if (condition === CONTAINS) {
            return `${CONTAINS} ${conditionValue === undefined ? 'nothing' : conditionValue}`;
        }

        return `${cell.value} ${condition.replaceAll('"', '')} ${conditionValue ?? 'nothing'}`;
    }

    // Print what was checked, what could not be, and what disagrees.
    private report(): number {
        for (const note of [...new Set(this.notes)]) {
            process.stdout.write(`note: ${note}\n`);
        }

        for (const finding of this.findings) {
            process.stdout.write(`${finding}\n`);
        }

        const scope = `${this.checkedLeaves} leaf/leaves of ${this.checkedBlocks} filter_by_pair result(s)`;

        if (this.findings.length) {
            process.stdout.write(`\nFound ${this.findings.length} disagreement(s) in ${scope}.\n`);
            return 1;
        }

        process.stdout.write(`Recomputed ${scope}: all match.\n`);

        return 0;
    }
}

if (import.meta.main) {
    process.exitCode = await new FilterChecker().run();
}

export {FilterChecker};
