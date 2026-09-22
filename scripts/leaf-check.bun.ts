import {Decimal} from './lang-decimal.bun.ts';
import {ExampleIndex} from './lang-example.bun.ts';
import type {Block, Leaf} from './lang-example.bun.ts';
import {OperandEvaluator} from './lang-operand.bun.ts';
import type {Cell, Matrix} from './lang-operand.bun.ts';

// Checker for the `sum_by_axes` leaves of the `*.example_*.lang` files.
//
// Every worked example writes its matrices out by hand. Where a matrix is the
// result of `sum_by_axes(source, Axis, ...)`, its leaves are fully determined by
// the cells of `source` — a matrix the example files write out as well, or one
// `OperandEvaluator` computes where the summation is applied to a nested call.
// This script re-derives each such leaf from the source matrix and compares:
//
//   * the total the leaf states, and
//   * the summands an aggregated leaf shows before its total.
//
// It re-computes only the summation itself; every input is read from the example
// files, so a disagreement is an arithmetic error in the worked example (or a
// leaf that the summation cannot produce), never a second implementation of the
// algorithm drifting from the spec.
//
// Two display conventions of the example files are part of the expected result,
// both verified across the whole repository: a zero summand is never printed,
// and a group whose total is zero may carry no leaf at all.
//
// Usage:
//   bun run scripts/leaf-check.bun.ts    # exit 1 on any disagreement

// The two example data sets the algorithm files carry.
const EXAMPLE_SUFFIXES: readonly string[] = ['example_1', 'example_2'];

// A `sum_by_axes` definition: the source and the axes summed over.
const SUM_CALL = /^sum_by_axes\((.+)\)$/;

class LeafChecker {
    private index = new ExampleIndex();
    private evaluator = new OperandEvaluator(this.index);
    private findings: string[] = [];
    private notes: string[] = [];
    private checkedBlocks = 0;
    private checkedLeaves = 0;

    // Check every `sum_by_axes` result of every data set.
    async run(): Promise<number> {
        const root = process.cwd();

        for (const suffix of EXAMPLE_SUFFIXES) {
            this.index = await ExampleIndex.load(root, suffix);
            this.evaluator = new OperandEvaluator(this.index);
            this.notes.push(...this.index.diagnostics);

            for (const block of this.index.blockList) {
                const call = SUM_CALL.exec(block.expression);

                if (call) {
                    const args = ExampleIndex.splitArguments(call[1]);
                    this.checkBlock(block, args[0], args.slice(1));
                }
            }

            this.notes.push(...this.evaluator.notes);
        }

        return this.report();
    }

    // Compare one `sum_by_axes` result with the summation of its source. The
    // source is read through `OperandEvaluator`, so that a summation over a
    // nested call — `sum_by_axes(count_coordinates_by_axis(...), ...)` — is
    // checked like any other.
    private checkBlock(block: Block, reference: string, axes: string[]): void {
        const where = `${block.file}:${block.line}: ${block.name}`;
        const source = this.evaluator.evaluate(reference, where);

        if (!source) {
            return;
        }

        const dropped = axes.map((axis) => ExampleIndex.letterOf(axis));

        if (dropped.some((letter) => letter === undefined)) {
            this.findings.push(`${block.file}:${block.line}: ${block.name}: unknown axis in ${axes.join(', ')}`);
            return;
        }

        const kept = source.axes.filter((letter) => !dropped.includes(letter));

        this.checkedBlocks += 1;
        this.compareLeaves(block, source, this.groupCells(source, kept), kept);
    }

    // Bucket the source cells by the coordinates the result keeps.
    private groupCells(source: Matrix, kept: string[]): Map<string, Cell[]> {
        const groups = new Map<string, Cell[]>();

        for (const cell of source.cells.values()) {
            const key = this.index.coordinateKey(cell.coordinates, kept);
            groups.set(key, [...(groups.get(key) ?? []), cell]);
        }

        return groups;
    }

    // Compare every leaf of the result with its group of source cells, then
    // report the groups the result left out.
    private compareLeaves(block: Block, source: Matrix, groups: Map<string, Cell[]>, kept: string[]): void {
        const pending = new Map(groups);

        for (const leaf of block.leaves) {
            const key = this.index.coordinateKey(leaf.coordinates, kept);
            const members = pending.get(key) ?? [];
            pending.delete(key);

            if (!groups.has(key)) {
                this.findings.push(`${block.file}:${leaf.line}: ${block.name}: no leaf of ${source.name} sums into ${leaf.text.trim()}`);
                continue;
            }

            this.checkedLeaves += 1;
            this.compareTotal(block, leaf, members);
            this.compareSummands(block, leaf, members);
        }

        for (const [key, members] of pending) {
            if (this.sum(members) !== '0') {
                this.findings.push(
                    `${block.file}:${block.line}: ${block.name}: no leaf for ${key}, which sums to ${this.sum(members)} in ${source.name}`,
                );
            }
        }
    }

    // The total a leaf states against the sum of its source cells.
    private compareTotal(block: Block, leaf: Leaf, members: Cell[]): void {
        const expected = this.sum(members);

        if (this.normalize(leaf.total) !== expected) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: total ${leaf.total}, summation gives ${expected}`);
        }
    }

    // The summands an aggregated leaf shows against the source values they stand
    // for. Order is not compared — the request-number convention reorders them —
    // and zero values are not printed, so they are not expected here either.
    private compareSummands(block: Block, leaf: Leaf, members: Cell[]): void {
        if (!leaf.summands.length) {
            return;
        }

        const written = leaf.summands.map((summand) => this.normalize(summand)).sort();
        const expected = members.map((member) => this.normalize(member.value)).filter((value) => value !== '0').sort();

        if (written.join('|') !== expected.join('|')) {
            this.findings.push(
                `${block.file}:${leaf.line}: ${block.name}: summands ${written.join(' + ')}, source has ${expected.join(' + ')}`,
            );
        }
    }

    // The exact sum of a group of source cells.
    private sum(members: Cell[]): string {
        return members
            .map((member) => Decimal.parse(member.value) ?? Decimal.ZERO)
            .reduce((left, right) => left.plus(right), Decimal.ZERO)
            .toString();
    }

    // One canonical spelling per value, so that `65`, `65.0` and `65.00` compare
    // equal however the example file writes them. A value that is not a number
    // is left as written, so that it can still be reported.
    private normalize(value: string): string {
        return Decimal.parse(value)?.toString() ?? value;
    }

    // Print what was checked, what could not be, and what disagrees.
    private report(): number {
        for (const note of [...new Set(this.notes)]) {
            process.stdout.write(`note: ${note}\n`);
        }

        for (const finding of this.findings) {
            process.stdout.write(`${finding}\n`);
        }

        const scope = `${this.checkedLeaves} leaf/leaves of ${this.checkedBlocks} sum_by_axes result(s)`;

        if (this.findings.length) {
            process.stdout.write(`\nFound ${this.findings.length} disagreement(s) in ${scope}.\n`);
            return 1;
        }

        process.stdout.write(`Recomputed ${scope}: all match.\n`);

        return 0;
    }
}

if (import.meta.main) {
    process.exitCode = await new LeafChecker().run();
}

export {LeafChecker};
