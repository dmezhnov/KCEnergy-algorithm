import {Decimal} from './lang-decimal.bun.ts';
import {ExampleIndex} from './lang-example.bun.ts';
import type {Block, Leaf} from './lang-example.bun.ts';
import {MatrixOperation} from './lang-operation.bun.ts';

// Checker for the `for_each_pair` leaves of the `*.example_*.lang` files.
//
// Where a matrix is the result of `for_each_pair(left, operat, right)`, each of
// its leaves is determined by one leaf of `left` and the value `right` carries
// at the same coordinates — all of which the example files write down. This
// script re-derives every such leaf and compares three things:
//
//   * the two operands the leaf displays (`1200 - 1220`, `min(70, 90)`),
//   * the result it states after the `=`, and
//   * the set of leaves itself, which is the set of leaves of `left`.
//
// As with the `sum_by_axes` checker it re-computes only the operation; every
// input is read from the example files, so a disagreement is an arithmetic error
// in the worked example, never a second implementation of the algorithm.
//
// Usage:
//   bun run scripts/pair-check.bun.ts    # exit 1 on any disagreement

// The two example data sets the algorithm files carry.
const EXAMPLE_SUFFIXES: readonly string[] = ['example_1', 'example_2'];

// A `for_each_pair` definition: the two operand references and the operation.
const PAIR_CALL = /^for_each_pair\((.+)\)$/;

// A leaf that displays an infix operation, e.g. `1200 - 1220` or `55 / 1220`.
const INFIX_LEAF = /^(-?\d+(?:\.\d+)?)\s+([-+*/])\s+(-?\d+(?:\.\d+)?)$/;

// A leaf that displays a named operation, e.g. `min(70, 83.333333333333333333)`.
const CALL_LEAF = /^([a-z_]+)\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/;

class PairChecker {
    private index = new ExampleIndex();
    private findings: string[] = [];
    private notes: string[] = [];
    private checkedBlocks = 0;
    private checkedLeaves = 0;

    // Check every `for_each_pair` result of every data set.
    async run(): Promise<number> {
        const root = process.cwd();

        for (const suffix of EXAMPLE_SUFFIXES) {
            this.index = await ExampleIndex.load(root, suffix);
            this.notes.push(...this.index.diagnostics);

            for (const block of this.index.blockList) {
                const call = PAIR_CALL.exec(block.expression);

                if (call) {
                    this.checkBlock(block, ExampleIndex.splitArguments(call[1]));
                }
            }
        }

        return this.report();
    }

    // Compare one `for_each_pair` result with its two operand matrices.
    private checkBlock(block: Block, args: string[]): void {
        if (args.length !== 3) {
            this.findings.push(`${block.file}:${block.line}: ${block.name}: expected three arguments, got ${args.length}`);
            return;
        }

        const [leftReference, operation, rightReference] = args;
        const spelling = MatrixOperation.spelling(operation);

        if (!spelling) {
            this.notes.push(`${block.file}:${block.line}: ${block.name}: operation ${operation} is not implemented`);
            return;
        }

        const left = this.operand(block, leftReference);
        const right = this.operand(block, rightReference);

        if (!left || !right) {
            return;
        }

        const axes = this.operandAxes(block, left, right);

        if (!axes) {
            return;
        }

        this.checkedBlocks += 1;
        this.compareLeaves(block, left, right, axes, operation, spelling);
    }

    // The block an operand reference names. An operand that is a nested call, or
    // a variable no example file expands, leaves nothing to read the values from.
    private operand(block: Block, reference: string): Block | undefined {
        const operand = this.index.resolve(reference);

        if (!operand) {
            this.notes.push(`${block.file}:${block.line}: ${block.name}: ${reference} is not an expanded variable`);
        }

        return operand;
    }

    // The axes of the two operands: the result is laid out on the left operand's
    // axes, and the right operand is read along the axes it carries itself.
    private operandAxes(block: Block, left: Block, right: Block): {left: string[]; right: string[]} | undefined {
        if (left.signatures.length > 1 || right.signatures.length > 1) {
            this.notes.push(`${block.file}:${block.line}: ${block.name}: an operand mixes leaf shapes; not checked`);
            return undefined;
        }

        if (!left.leaves.length) {
            this.reportEmptyLeft(block, left);
            return undefined;
        }

        const axes = {left: left.signatures[0] ?? [], right: right.signatures[0] ?? []};
        const missing = axes.right.filter((letter) => !axes.left.includes(letter));

        if (missing.length) {
            this.findings.push(`${block.file}:${block.line}: ${block.name}: ${right.name} carries ${missing.join(', ')}, which ${left.name} does not`);
            return undefined;
        }

        return axes;
    }

    // An empty left operand produces an empty result: there is nothing to
    // compute, and any leaf the result does carry has no source.
    private reportEmptyLeft(block: Block, left: Block): void {
        this.notes.push(`${block.file}:${block.line}: ${block.name}: ${left.name} is empty`);

        for (const leaf of block.leaves) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: ${left.name} is empty, so this leaf has no source`);
        }
    }

    // Walk the leaves of the left operand, which are the leaves the result is
    // laid out on, then report the result leaves that no left leaf accounts for.
    private compareLeaves(
        block: Block,
        left: Block,
        right: Block,
        axes: {left: string[]; right: string[]},
        operation: string,
        spelling: string,
    ): void {
        const results = new Map(block.leaves.map((leaf) => [this.index.coordinateKey(leaf.coordinates, axes.left), leaf]));

        for (const source of left.leaves) {
            const key = this.index.coordinateKey(source.coordinates, axes.left);
            const leaf = results.get(key);
            results.delete(key);

            this.compareLeaf(block, key, leaf, source, right.values.get(this.index.coordinateKey(source.coordinates, axes.right)), operation, spelling);
        }

        for (const [key, leaf] of results) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: no leaf of ${left.name} produces ${key}`);
        }
    }

    // Compare one result leaf with the operands it is made of: first what the
    // leaf displays, then the value it states. A leaf the result leaves out is
    // only reported when the operation does not produce a zero there — as with
    // `sum_by_axes`, a cell that comes out zero may carry no leaf at all.
    private compareLeaf(
        block: Block,
        key: string,
        leaf: Leaf | undefined,
        source: Leaf,
        rightValue: string | undefined,
        operation: string,
        spelling: string,
    ): void {
        const left = Decimal.parse(source.total);
        const right = Decimal.parse(rightValue ?? '0');
        const total = leaf ? Decimal.parse(leaf.total) : Decimal.ZERO;

        if (!left || !right || !total) {
            this.findings.push(`${block.file}:${leaf?.line ?? block.line}: ${block.name}: ${leaf?.text.trim() ?? key} is not made of numbers`);
            return;
        }

        const expected = MatrixOperation.apply(left, operation, right);

        if (!expected) {
            this.findings.push(`${block.file}:${leaf?.line ?? block.line}: ${block.name}: ${this.render(left, right, spelling)} divides by zero`);
            return;
        }

        if (!leaf) {
            if (!expected.isZero()) {
                this.findings.push(`${block.file}:${block.line}: ${block.name}: no leaf for ${key}, where ${this.render(left, right, spelling)} gives ${expected}`);
            }

            return;
        }

        this.checkedLeaves += 1;
        this.compareOperands(block, leaf, left, right, spelling);

        if (!total.equals(expected)) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: states ${leaf.total}, ${this.render(left, right, spelling)} gives ${expected}`);
        }
    }

    // Compare the two operands a leaf displays with the values its sources hold.
    // A leaf that displays no arithmetic at all is only checked on its result.
    private compareOperands(block: Block, leaf: Leaf, left: Decimal, right: Decimal, spelling: string): void {
        if (!leaf.expression) {
            this.notes.push(`${block.file}:${leaf.line}: ${block.name}: leaf shows no operands`);
            return;
        }

        const shown = this.parseOperands(leaf.expression);

        if (!shown) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: cannot read the operands of ${leaf.expression}`);
            return;
        }

        if (shown.spelling !== spelling) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: leaf shows ${shown.spelling}, the definition applies ${spelling}`);
        }

        if (!shown.left.equals(left) || !shown.right.equals(right)) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: shows ${leaf.expression}, the operands are ${this.render(left, right, spelling)}`);
        }
    }

    // The two operands and the operation a leaf line displays, in either the
    // infix or the call spelling.
    private parseOperands(expression: string): {left: Decimal; right: Decimal; spelling: string} | undefined {
        const infix = INFIX_LEAF.exec(expression);
        const call = CALL_LEAF.exec(expression);
        const shown = infix ?? call;

        if (!shown) {
            return undefined;
        }

        const spelling = infix ? infix[2] : shown[1];
        const left = Decimal.parse(infix ? infix[1] : shown[2]);
        const right = Decimal.parse(shown[3]);

        return left && right ? {left, right, spelling} : undefined;
    }

    // The arithmetic of one leaf, spelled the way the example files spell it.
    private render(left: Decimal, right: Decimal, spelling: string): string {
        return spelling === 'min' ? `min(${left}, ${right})` : `${left} ${spelling} ${right}`;
    }

    // Print what was checked, what could not be, and what disagrees.
    private report(): number {
        for (const note of [...new Set(this.notes)]) {
            process.stdout.write(`note: ${note}\n`);
        }

        for (const finding of this.findings) {
            process.stdout.write(`${finding}\n`);
        }

        const scope = `${this.checkedLeaves} leaf/leaves of ${this.checkedBlocks} for_each_pair result(s)`;

        if (this.findings.length) {
            process.stdout.write(`\nFound ${this.findings.length} disagreement(s) in ${scope}.\n`);
            return 1;
        }

        process.stdout.write(`Recomputed ${scope}: all match.\n`);

        return 0;
    }
}

if (import.meta.main) {
    process.exitCode = await new PairChecker().run();
}

export {PairChecker};
