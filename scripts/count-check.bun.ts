import {Decimal} from './lang-decimal.bun.ts';
import {ExampleIndex} from './lang-example.bun.ts';
import type {Block, Leaf} from './lang-example.bun.ts';
import {OperandEvaluator} from './lang-operand.bun.ts';
import type {Cell, Matrix} from './lang-operand.bun.ts';

// Checker for the `count_coordinates_by_axis` leaves of the `*.example_*.lang`
// files.
//
// Where a matrix is the result of `count_coordinates_by_axis(source, Axis)`, it
// is the source with that axis collapsed away, and each of its cells holds the
// number of coordinates the source carries along it. The source is written down
// in the example files, so this script re-derives the whole result and compares:
//
//   * the axes the result is laid out on — the source's, less the counted one,
//   * the set of leaves — one per group of source cells, and
//   * the count each of them states.
//
// A leaf of such a result comments the requests it stands for (`# 101, 102`),
// which is not the count it states — one refinery can carry two requests — so
// the comments make no claim a checker can read and none is checked.
//
// As with the other primitives it re-computes only the operation; every input is
// read from the example files, so a disagreement is an error in the worked
// example, never a second implementation of the algorithm.
//
// Usage:
//   bun run scripts/count-check.bun.ts    # exit 1 on any disagreement

// The two example data sets the algorithm files carry.
const EXAMPLE_SUFFIXES: readonly string[] = ['example_1', 'example_2'];

// A `count_coordinates_by_axis` definition: the source and the axis counted. A
// call nested inside another primitive is not matched here — its leaves belong
// to the outer result, not to the count.
const COUNT_CALL = /^count_coordinates_by_axis\((.+)\)$/;

class CountChecker {
    private index = new ExampleIndex();
    private evaluator = new OperandEvaluator(this.index);
    private findings: string[] = [];
    private notes: string[] = [];
    private checkedBlocks = 0;
    private checkedLeaves = 0;

    // Check every `count_coordinates_by_axis` result of every data set.
    async run(): Promise<number> {
        const root = process.cwd();

        for (const suffix of EXAMPLE_SUFFIXES) {
            this.index = await ExampleIndex.load(root, suffix);
            this.evaluator = new OperandEvaluator(this.index);
            this.notes.push(...this.index.diagnostics);

            for (const block of this.index.blockList) {
                const call = COUNT_CALL.exec(block.expression);

                if (call) {
                    this.checkBlock(block, ExampleIndex.splitArguments(call[1]));
                }
            }

            this.notes.push(...this.evaluator.notes);
        }

        return this.report();
    }

    // Compare one `count_coordinates_by_axis` result with the counts of its
    // source. The source is read on its own as well as through the call, so that
    // an empty one can be reported as such instead of as a shape disagreement.
    private checkBlock(block: Block, args: string[]): void {
        const where = `${block.file}:${block.line}: ${block.name}`;

        if (args.length !== 2) {
            this.findings.push(`${where}: expected two arguments, got ${args.length}`);
            return;
        }

        const source = this.evaluator.evaluate(args[0], where);

        if (!source) {
            return;
        }

        if (!source.cells.size) {
            this.reportEmptySource(block, source, where);
            return;
        }

        const counted = this.evaluator.evaluate(block.expression, where);

        if (!counted || !this.sameShape(block, counted, where)) {
            return;
        }

        this.checkedBlocks += 1;
        this.compareLeaves(block, counted, where);
    }

    // An empty source produces an empty result: there is no group to count, and
    // any leaf the result does carry has no source.
    private reportEmptySource(block: Block, source: Matrix, where: string): void {
        this.notes.push(`${where}: ${source.name} is empty`);

        for (const leaf of block.leaves) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: ${source.name} is empty, so this leaf has no source`);
        }
    }

    // The result is laid out on the source's axes less the counted one, which is
    // the shape the counts come back on.
    private sameShape(block: Block, counted: Matrix, where: string): boolean {
        for (const signature of block.signatures) {
            if (signature.join() !== counted.axes.join()) {
                this.findings.push(`${where}: leaves are laid out on ${signature.join(', ')}, the counts on ${counted.axes.join(', ')}`);
                return false;
            }
        }

        return true;
    }

    // Compare the counts with the leaves the result writes down: every group of
    // source cells must carry a leaf, and no leaf may sit where the source
    // carries no cell at all.
    private compareLeaves(block: Block, counted: Matrix, where: string): void {
        const leaves = new Map(block.leaves.map((leaf) => [this.index.coordinateKey(leaf.coordinates, counted.axes), leaf]));

        for (const [key, cell] of counted.cells) {
            const leaf = leaves.get(key);
            leaves.delete(key);

            if (!leaf) {
                this.findings.push(`${where}: no leaf for ${key}, where the source carries ${cell.value} coordinate(s)`);
                continue;
            }

            this.checkedLeaves += 1;
            this.compareLeaf(block, leaf, cell);
        }

        for (const [key, leaf] of leaves) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: the source carries no coordinate at ${key}`);
        }
    }

    // Compare one leaf with the count its group comes to. Counts are compared as
    // numbers, so that a leaf spelling one differently still agrees.
    private compareLeaf(block: Block, leaf: Leaf, cell: Cell): void {
        const stated = Decimal.parse(leaf.total);
        const expected = Decimal.parse(cell.value);

        if (!stated || !expected) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: states ${leaf.total}, which is not a number`);
            return;
        }

        if (!stated.equals(expected)) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: states ${leaf.total}, the source carries ${cell.value} coordinate(s)`);
        }
    }

    // Print what was checked, what could not be, and what disagrees.
    private report(): number {
        for (const note of [...new Set(this.notes)]) {
            process.stdout.write(`note: ${note}\n`);
        }

        for (const finding of this.findings) {
            process.stdout.write(`${finding}\n`);
        }

        const scope = `${this.checkedLeaves} leaf/leaves of ${this.checkedBlocks} count_coordinates_by_axis result(s)`;

        if (this.findings.length) {
            process.stdout.write(`\nFound ${this.findings.length} disagreement(s) in ${scope}.\n`);
            return 1;
        }

        process.stdout.write(`Recomputed ${scope}: all match.\n`);

        return 0;
    }
}

if (import.meta.main) {
    process.exitCode = await new CountChecker().run();
}

export {CountChecker};
