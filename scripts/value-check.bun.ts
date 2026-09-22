import {Decimal} from './lang-decimal.bun.ts';
import {ExampleIndex} from './lang-example.bun.ts';
import type {Block, Leaf} from './lang-example.bun.ts';
import {MatrixOperation} from './lang-operation.bun.ts';
import {OperandEvaluator} from './lang-operand.bun.ts';
import type {Cell, Matrix} from './lang-operand.bun.ts';

// Checker for the `filter_by_value` leaves of the `*.example_*.lang` files.
//
// Where a matrix is the result of `filter_by_value(source, condit, value)`,
// every leaf it carries is a leaf of `source` whose own value stands in the
// given relation to one number, with that value copied over unchanged. Both the
// source and the threshold are written down in the example files, so this script
// re-derives the whole result and compares:
//
//   * the set of leaves — exactly the cells of `source` that pass the condition,
//   * the value of each of them, which must be the source value verbatim, and
//   * the comparison a leaf shows in its comment, where it shows one.
//
// As with the other primitives it re-computes only the operation; every input is
// read from the example files, so a disagreement is an error in the worked
// example, never a second implementation of the algorithm.
//
// Usage:
//   bun run scripts/value-check.bun.ts    # exit 1 on any disagreement

// The two example data sets the algorithm files carry.
const EXAMPLE_SUFFIXES: readonly string[] = ['example_1', 'example_2'];

// A `filter_by_value` definition: the source, the condition and the threshold.
// A call nested inside another primitive is not matched here — its leaves belong
// to the outer result, not to the filter.
const VALUE_CALL = /^filter_by_value\((.+)\)$/;

// The threshold one result filters by: the number itself, and the way the
// example files spell it — a leaf comment states the spelling, not the value.
type Threshold = {text: string; value: Decimal};

class ValueChecker {
    private index = new ExampleIndex();
    private evaluator = new OperandEvaluator(this.index);
    private findings: string[] = [];
    private notes: string[] = [];
    private checkedBlocks = 0;
    private checkedLeaves = 0;

    // Check every `filter_by_value` result of every data set.
    async run(): Promise<number> {
        const root = process.cwd();

        for (const suffix of EXAMPLE_SUFFIXES) {
            this.index = await ExampleIndex.load(root, suffix);
            this.evaluator = new OperandEvaluator(this.index);
            this.notes.push(...this.index.diagnostics);

            for (const block of this.index.blockList) {
                const call = VALUE_CALL.exec(block.expression);

                if (call) {
                    this.checkBlock(block, ExampleIndex.splitArguments(call[1]));
                }
            }

            this.notes.push(...this.evaluator.notes);
        }

        return this.report();
    }

    // Compare one `filter_by_value` result with the matrix and the threshold it
    // is made of.
    private checkBlock(block: Block, args: string[]): void {
        const where = `${block.file}:${block.line}: ${block.name}`;

        if (args.length !== 3) {
            this.findings.push(`${where}: expected three arguments, got ${args.length}`);
            return;
        }

        const [sourceReference, condition, thresholdReference] = args;

        if (!MatrixOperation.compares(condition)) {
            this.notes.push(`${where}: condition ${condition} is not implemented`);
            return;
        }

        const source = this.evaluator.evaluate(sourceReference, where);
        const threshold = this.threshold(thresholdReference, where);

        if (!source || !threshold) {
            return;
        }

        if (!source.cells.size) {
            this.reportEmptySource(block, source, where);
            return;
        }

        if (!this.sameShape(block, source, where)) {
            return;
        }

        this.checkedBlocks += 1;
        this.compareLeaves(block, source, condition, threshold, where);
    }

    // The number a result filters by: a scalar the example files fix, or a
    // literal written in place.
    private threshold(reference: string, where: string): Threshold | undefined {
        const text = this.index.scalar(reference)?.value ?? reference;
        const value = Decimal.parse(text);

        if (!value) {
            this.notes.push(`${where}: ${reference} is not a number`);
            return undefined;
        }

        return {text, value};
    }

    // An empty source produces an empty result: there is nothing to filter, and
    // any leaf the result does carry has no source.
    private reportEmptySource(block: Block, source: Matrix, where: string): void {
        this.notes.push(`${where}: ${source.name} is empty`);

        for (const leaf of block.leaves) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: ${source.name} is empty, so this leaf has no source`);
        }
    }

    // The result is laid out on the axes of its source: the operation drops
    // whole cells, never a coordinate.
    private sameShape(block: Block, source: Matrix, where: string): boolean {
        for (const signature of block.signatures) {
            if (signature.join() !== source.axes.join()) {
                this.findings.push(`${where}: leaves are laid out on ${signature.join(', ')}, ${source.name} on ${source.axes.join(', ')}`);
                return false;
            }
        }

        return true;
    }

    // Walk the cells of the source, which are the only ones the result may
    // carry, then report the result leaves that no source cell accounts for.
    private compareLeaves(block: Block, source: Matrix, condition: string, threshold: Threshold, where: string): void {
        const results = new Map(block.leaves.map((leaf) => [this.index.coordinateKey(leaf.coordinates, source.axes), leaf]));

        for (const [key, cell] of source.cells) {
            const leaf = results.get(key);
            results.delete(key);

            this.compareLeaf(block, key, leaf, cell, condition, threshold, where);
        }

        for (const [key, leaf] of results) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: no cell of ${source.name} produces ${key}`);
        }
    }

    // Compare one candidate cell with the result: a cell the condition keeps
    // must carry a leaf whose value is the source value verbatim, and a cell it
    // drops must carry none.
    private compareLeaf(
        block: Block,
        key: string,
        leaf: Leaf | undefined,
        cell: Cell,
        condition: string,
        threshold: Threshold,
        where: string,
    ): void {
        const value = Decimal.parse(cell.value);

        if (!value) {
            this.findings.push(`${where}: ${cell.value} at ${key} is not a number`);
            return;
        }

        if (!MatrixOperation.compare(condition, value, threshold.value)) {
            if (leaf) {
                this.findings.push(`${block.file}:${leaf.line}: ${block.name}: ${this.render(cell, condition, threshold)} is false, so ${key} should be filtered out`);
            }

            return;
        }

        if (!leaf) {
            this.findings.push(`${where}: no leaf for ${key}, where ${this.render(cell, condition, threshold)} holds`);
            return;
        }

        this.checkedLeaves += 1;
        this.compareComment(block, leaf, cell, condition, threshold);

        if (leaf.total !== cell.value) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: states ${leaf.total}, ${cell.value} is what the source carries`);
        }
    }

    // Compare the comparison a leaf states in its comment with the one it was
    // kept by. As in `filter_by_pair` the pair may be stated either way round,
    // and a comment that states no comparison at all — a request number, which
    // is what most of these leaves carry — makes no claim to check.
    private compareComment(block: Block, leaf: Leaf, cell: Cell, condition: string, threshold: Threshold): void {
        const shown = MatrixOperation.comparisonShown(leaf.text);

        if (!shown) {
            return;
        }

        const straight = shown.left === cell.value && shown.right === threshold.text && shown.operator === condition.replaceAll('"', '');
        const mirrored = shown.left === threshold.text && shown.right === cell.value && shown.operator === MatrixOperation.mirrored(condition);

        if (!straight && !mirrored) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: comment states ${shown.left} ${shown.operator} ${shown.right}, the comparison is ${this.render(cell, condition, threshold)}`);
        }
    }

    // The comparison one cell stands or falls by, spelled the way the example
    // files spell a condition.
    private render(cell: Cell, condition: string, threshold: Threshold): string {
        return `${cell.value} ${condition.replaceAll('"', '')} ${threshold.text}`;
    }

    // Print what was checked, what could not be, and what disagrees.
    private report(): number {
        for (const note of [...new Set(this.notes)]) {
            process.stdout.write(`note: ${note}\n`);
        }

        for (const finding of this.findings) {
            process.stdout.write(`${finding}\n`);
        }

        const scope = `${this.checkedLeaves} leaf/leaves of ${this.checkedBlocks} filter_by_value result(s)`;

        if (this.findings.length) {
            process.stdout.write(`\nFound ${this.findings.length} disagreement(s) in ${scope}.\n`);
            return 1;
        }

        process.stdout.write(`Recomputed ${scope}: all match.\n`);

        return 0;
    }
}

if (import.meta.main) {
    process.exitCode = await new ValueChecker().run();
}

export {ValueChecker};
