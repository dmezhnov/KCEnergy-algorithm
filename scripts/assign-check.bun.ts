import {Decimal} from './lang-decimal.bun.ts';
import {ExampleIndex} from './lang-example.bun.ts';
import type {Block, Leaf} from './lang-example.bun.ts';
import {OperandEvaluator} from './lang-operand.bun.ts';
import type {Matrix} from './lang-operand.bun.ts';

// Checker for the `assign_matrix` leaves of the `*.example_*.lang` files.
//
// Where a matrix is the result of `assign_matrix(source(1), ..., source(n))`, it
// carries exactly the cells of its sources, each with the value the source gives
// it — and where two sources carry the same cell, the value of the later one:
// that is what `step-10.lang` relies on, «суммы перекрывают исходные ẗ». This
// script re-derives the whole union and compares:
//
//   * the set of leaves — exactly the cells the sources carry between them,
//   * the value of each of them, and
//   * the axes the result is laid out on.
//
// Most arguments are nested calls rather than expanded variables, so the sources
// are read through `OperandEvaluator`. As with the other checkers it re-computes
// only the operation; every input is read from the example files, so a
// disagreement is an error in the worked example, never a second implementation
// of the algorithm.
//
// Usage:
//   bun run scripts/assign-check.bun.ts    # exit 1 on any disagreement

// The two example data sets the algorithm files carry.
const EXAMPLE_SUFFIXES: readonly string[] = ['example_1', 'example_2'];

// An `assign_matrix` definition and the sources it merges.
const ASSIGN_CALL = /^assign_matrix\((.+)\)$/;

class AssignChecker {
    private index = new ExampleIndex();
    private evaluator = new OperandEvaluator(this.index);
    private findings: string[] = [];
    private notes: string[] = [];
    private checkedBlocks = 0;
    private checkedLeaves = 0;

    // Check every `assign_matrix` result of every data set.
    async run(): Promise<number> {
        const root = process.cwd();

        for (const suffix of EXAMPLE_SUFFIXES) {
            this.index = await ExampleIndex.load(root, suffix);
            this.evaluator = new OperandEvaluator(this.index);
            this.notes.push(...this.index.diagnostics);

            for (const block of this.index.blockList) {
                const call = ASSIGN_CALL.exec(block.expression);

                if (call) {
                    this.checkBlock(block, ExampleIndex.splitArguments(call[1]));
                }
            }

            this.notes.push(...this.evaluator.notes);
        }

        return this.report();
    }

    // Compare one `assign_matrix` result with the sources it merges.
    private checkBlock(block: Block, args: string[]): void {
        const where = `${block.file}:${block.line}: ${block.name}`;
        const sources = args.map((argument) => this.evaluator.evaluate(argument, where));

        if (sources.some((source) => !source)) {
            return;
        }

        const axes = this.resultAxes(block, sources as Matrix[], where);

        if (!axes) {
            return;
        }

        this.checkedBlocks += 1;
        this.compareLeaves(block, this.merge(sources as Matrix[], axes), axes, where);
    }

    // The axes the union is laid out on: those its sources agree on. An empty
    // source fixes no shape and is passed over; a source that disagrees leaves
    // the union undefined, so nothing is compared.
    private resultAxes(block: Block, sources: Matrix[], where: string): string[] | undefined {
        const shapes = sources.filter((source) => source.cells.size);
        const axes = shapes[0]?.axes ?? [];
        const other = shapes.find((source) => source.axes.join() !== axes.join());

        if (other) {
            this.findings.push(`${where}: ${other.name} is laid out on ${other.axes.join(', ')}, ${shapes[0].name} on ${axes.join(', ')}`);
            return undefined;
        }

        for (const signature of block.signatures) {
            if (signature.join() !== axes.join()) {
                this.findings.push(`${where}: leaves are laid out on ${signature.join(', ')}, the sources on ${axes.join(', ')}`);
                return undefined;
            }
        }

        return axes;
    }

    // The union of the sources: every cell they carry between them, and for a
    // cell more than one of them carries, the value of the last.
    private merge(sources: Matrix[], axes: string[]): Map<string, {value: string; from: string}> {
        const merged = new Map<string, {value: string; from: string}>();

        for (const source of sources) {
            for (const [key, cell] of source.cells) {
                merged.set(this.index.coordinateKey(cell.coordinates, axes), {value: cell.value, from: source.name});
            }
        }

        return merged;
    }

    // Compare the union with the leaves the result writes down: every cell must
    // carry a leaf of the same value, and no leaf may sit on a cell no source
    // carries.
    private compareLeaves(block: Block, merged: Map<string, {value: string; from: string}>, axes: string[], where: string): void {
        const leaves = new Map(block.leaves.map((leaf) => [this.index.coordinateKey(leaf.coordinates, axes), leaf]));

        for (const [key, cell] of merged) {
            const leaf = leaves.get(key);
            leaves.delete(key);

            if (!leaf) {
                this.findings.push(`${where}: no leaf for ${key}, which ${cell.from} carries as ${cell.value}`);
                continue;
            }

            this.checkedLeaves += 1;
            this.compareLeaf(block, leaf, cell);
        }

        for (const [key, leaf] of leaves) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: no source carries ${key}`);
        }
    }

    // Compare one leaf with the value the union gives it. Values are compared as
    // numbers, so that a source and a result which spell the same number
    // differently still agree.
    private compareLeaf(block: Block, leaf: Leaf, cell: {value: string; from: string}): void {
        const stated = Decimal.parse(leaf.total);
        const expected = Decimal.parse(cell.value);

        if (!stated || !expected) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: ${leaf.total} and ${cell.value} are not both numbers`);
            return;
        }

        if (!stated.equals(expected)) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: states ${leaf.total}, ${cell.from} carries ${cell.value}`);
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

        const scope = `${this.checkedLeaves} leaf/leaves of ${this.checkedBlocks} assign_matrix result(s)`;

        if (this.findings.length) {
            process.stdout.write(`\nFound ${this.findings.length} disagreement(s) in ${scope}.\n`);
            return 1;
        }

        process.stdout.write(`Recomputed ${scope}: all match.\n`);

        return 0;
    }
}

if (import.meta.main) {
    process.exitCode = await new AssignChecker().run();
}

export {AssignChecker};
