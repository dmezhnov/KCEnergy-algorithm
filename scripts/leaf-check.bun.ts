import {ExampleIndex} from './lang-example.bun.ts';
import type {Block, Leaf} from './lang-example.bun.ts';

// Checker for the `sum_by_axes` leaves of the `*.example_*.lang` files.
//
// Every worked example writes its matrices out by hand. Where a matrix is the
// result of `sum_by_axes(source, Axis, ...)`, its leaves are fully determined by
// the leaves of `source`, which the example files also write out. This script
// re-derives each such leaf from the source matrix and compares:
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

// A `sum_by_axes` definition: the source reference and the axes summed over.
const SUM_CALL = /^sum_by_axes\(\s*([A-Za-z_][A-Za-z0-9_]*(?:\([^()]*\))*)\s*,\s*(.+?)\s*\)$/;

class LeafChecker {
    private index = new ExampleIndex();
    private findings: string[] = [];
    private notes: string[] = [];
    private checkedBlocks = 0;
    private checkedLeaves = 0;

    // Check every `sum_by_axes` result of every data set.
    async run(): Promise<number> {
        const root = process.cwd();

        for (const suffix of EXAMPLE_SUFFIXES) {
            this.index = await ExampleIndex.load(root, suffix);
            this.notes.push(...this.index.diagnostics);

            for (const block of this.index.blockList) {
                const call = SUM_CALL.exec(block.expression);

                if (call) {
                    this.checkBlock(block, call[1], call[2].split(/\s*,\s*/));
                }
            }
        }

        return this.report();
    }

    // Compare one `sum_by_axes` result with the summation of its source.
    private checkBlock(block: Block, reference: string, axes: string[]): void {
        const source = this.index.resolve(reference);

        if (!source) {
            this.notes.push(`${block.file}:${block.line}: ${block.name}: ${reference} is not an expanded variable`);
            return;
        }

        const dropped = axes.map((axis) => ExampleIndex.letterOf(axis));

        if (dropped.some((letter) => letter === undefined)) {
            this.findings.push(`${block.file}:${block.line}: ${block.name}: unknown axis in ${axes.join(', ')}`);
            return;
        }

        const kept = this.keptAxes(source, new Set(dropped as string[]));

        if (!kept) {
            this.notes.push(`${block.file}:${block.line}: ${block.name}: ${source.name} mixes leaf shapes; not summed`);
            return;
        }

        this.checkedBlocks += 1;
        this.compareLeaves(block, source, this.groupLeaves(source, kept), kept);
    }

    // The axes the result keeps: those the source leaves carry and the call does
    // not sum over. Undefined when the source leaves disagree on their shape, so
    // that there is no single result shape to group by.
    private keptAxes(source: Block, dropped: Set<string>): string[] | undefined {
        if (source.signatures.length > 1) {
            return undefined;
        }

        return (source.signatures[0] ?? []).filter((letter) => !dropped.has(letter));
    }

    // Bucket the source leaves by the coordinates the result keeps.
    private groupLeaves(source: Block, kept: string[]): Map<string, Leaf[]> {
        const groups = new Map<string, Leaf[]>();

        for (const leaf of source.leaves) {
            const key = this.index.coordinateKey(leaf.coordinates, kept);
            groups.set(key, [...(groups.get(key) ?? []), leaf]);
        }

        return groups;
    }

    // Compare every leaf of the result with its group of source leaves, then
    // report the groups the result left out.
    private compareLeaves(block: Block, source: Block, groups: Map<string, Leaf[]>, kept: string[]): void {
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
                    `${block.file}:${block.line}: ${block.name}: no leaf for ${key}, which sums to ${this.sum(members)} (${source.file}:${members[0].line})`,
                );
            }
        }
    }

    // The total a leaf states against the sum of its source leaves.
    private compareTotal(block: Block, leaf: Leaf, members: Leaf[]): void {
        const expected = this.sum(members);

        if (this.normalize(leaf.total) !== expected) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: total ${leaf.total}, summation gives ${expected}`);
        }
    }

    // The summands an aggregated leaf shows against the source values they stand
    // for. Order is not compared — the request-number convention reorders them —
    // and zero values are not printed, so they are not expected here either.
    private compareSummands(block: Block, leaf: Leaf, members: Leaf[]): void {
        if (!leaf.summands.length) {
            return;
        }

        const written = leaf.summands.map((summand) => this.normalize(summand)).sort();
        const expected = members.map((member) => this.normalize(member.total)).filter((value) => value !== '0').sort();

        if (written.join('|') !== expected.join('|')) {
            this.findings.push(
                `${block.file}:${leaf.line}: ${block.name}: summands ${written.join(' + ')}, source has ${expected.join(' + ')}`,
            );
        }
    }

    // The exact sum of a group of leaves.
    private sum(members: Leaf[]): string {
        return members.map((member) => member.total).reduce((left, right) => this.add(left, right), '0');
    }

    // Exact decimal addition: scale both operands to a common number of fraction
    // digits and add as BigInt, so 20-significant-digit values keep every digit.
    private add(left: string, right: string): string {
        const scale = Math.max(this.fractionDigits(left), this.fractionDigits(right));

        return this.unscale(this.scale(left, scale) + this.scale(right, scale), scale);
    }

    // How many digits a decimal value carries after its point.
    private fractionDigits(value: string): number {
        const point = value.indexOf('.');

        return point < 0 ? 0 : value.length - point - 1;
    }

    // A decimal value as an integer of the given number of fraction digits.
    private scale(value: string, scale: number): bigint {
        const [whole, fraction = ''] = value.split('.');

        return BigInt(whole + fraction.padEnd(scale, '0'));
    }

    // The inverse of `scale`, in the canonical form `normalize` produces.
    private unscale(value: bigint, scale: number): string {
        if (scale === 0) {
            return value.toString();
        }

        const digits = value.toString().padStart(scale + 1, '0');

        return this.normalize(`${digits.slice(0, -scale)}.${digits.slice(-scale)}`);
    }

    // One canonical spelling per value, so that `65`, `65.0` and `65.00` compare
    // equal however the example file writes them.
    private normalize(value: string): string {
        if (!value.includes('.')) {
            return value;
        }

        const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');

        return trimmed === '' || trimmed === '-' ? '0' : trimmed;
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
