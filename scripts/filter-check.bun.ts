import {Decimal} from './lang-decimal.bun.ts';
import {ExampleIndex} from './lang-example.bun.ts';
import type {Block, Leaf} from './lang-example.bun.ts';
import {MatrixOperation} from './lang-operation.bun.ts';

// Checker for the `filter_by_pair` leaves of the `*.example_*.lang` files.
//
// Where a matrix is the result of `filter_by_pair(source, condit, condition)`,
// every leaf it carries is a leaf of `source` that the condition keeps, with its
// value copied over unchanged. Both operands are written down in the example
// files, so this script re-derives the whole result and compares:
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

// The comparison a leaf may state in its comment, e.g. `# 2260 >= 1440`. A leaf
// whose comment says anything else — a request number, most often — is not
// making a claim this checker can read.
const COMMENT_COMPARISON = /#\s*(-?\d+(?:\.\d+)?)\s*(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)/;

// The condition that keeps a cell when the condition matrix carries one at the
// same coordinates at all, whatever value it holds.
const CONTAINS = MatrixOperation.CONTAINS;

class FilterChecker {
    private index = new ExampleIndex();
    private findings: string[] = [];
    private notes: string[] = [];
    private checkedBlocks = 0;
    private checkedLeaves = 0;

    // Check every `filter_by_pair` result of every data set.
    async run(): Promise<number> {
        const root = process.cwd();

        for (const suffix of EXAMPLE_SUFFIXES) {
            this.index = await ExampleIndex.load(root, suffix);
            this.notes.push(...this.index.diagnostics);

            for (const block of this.index.blockList) {
                const call = FILTER_CALL.exec(block.expression);

                if (call) {
                    this.checkBlock(block, ExampleIndex.splitArguments(call[1]));
                }
            }
        }

        return this.report();
    }

    // Compare one `filter_by_pair` result with the two matrices it is made of.
    private checkBlock(block: Block, args: string[]): void {
        if (args.length !== 3) {
            this.findings.push(`${block.file}:${block.line}: ${block.name}: expected three arguments, got ${args.length}`);
            return;
        }

        const [sourceReference, condition, conditionReference] = args;

        if (condition !== CONTAINS && !MatrixOperation.compares(condition)) {
            this.notes.push(`${block.file}:${block.line}: ${block.name}: condition ${condition} is not implemented`);
            return;
        }

        const source = this.operand(block, sourceReference);
        const against = this.operand(block, conditionReference);

        if (!source || !against) {
            return;
        }

        const axes = this.operandAxes(block, source, against);

        if (!axes) {
            return;
        }

        this.checkedBlocks += 1;
        this.compareLeaves(block, source, against, axes, condition);
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

    // The axes of the two operands: the result is laid out on the source's axes,
    // and the condition matrix is read along the axes it carries itself — an
    // `I, J` condition selects whole `I, J, K, P` groups of the source.
    private operandAxes(block: Block, source: Block, against: Block): {source: string[]; condition: string[]} | undefined {
        if (source.signatures.length > 1 || against.signatures.length > 1) {
            this.notes.push(`${block.file}:${block.line}: ${block.name}: an operand mixes leaf shapes; not checked`);
            return undefined;
        }

        if (!source.leaves.length) {
            this.reportEmptySource(block, source);
            return undefined;
        }

        const axes = {source: source.signatures[0] ?? [], condition: against.signatures[0] ?? []};
        const missing = axes.condition.filter((letter) => !axes.source.includes(letter));

        if (missing.length) {
            this.findings.push(`${block.file}:${block.line}: ${block.name}: ${against.name} carries ${missing.join(', ')}, which ${source.name} does not`);
            return undefined;
        }

        return axes;
    }

    // An empty source produces an empty result: there is nothing to filter, and
    // any leaf the result does carry has no source.
    private reportEmptySource(block: Block, source: Block): void {
        this.notes.push(`${block.file}:${block.line}: ${block.name}: ${source.name} is empty`);

        for (const leaf of block.leaves) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: ${source.name} is empty, so this leaf has no source`);
        }
    }

    // Walk the leaves of the source, which are the only cells the result may
    // carry, then report the result leaves that no source leaf accounts for.
    private compareLeaves(
        block: Block,
        source: Block,
        against: Block,
        axes: {source: string[]; condition: string[]},
        condition: string,
    ): void {
        const results = new Map(block.leaves.map((leaf) => [this.index.coordinateKey(leaf.coordinates, axes.source), leaf]));

        for (const candidate of source.leaves) {
            const key = this.index.coordinateKey(candidate.coordinates, axes.source);
            const leaf = results.get(key);
            results.delete(key);

            this.compareLeaf(block, key, leaf, candidate, against.values.get(this.index.coordinateKey(candidate.coordinates, axes.condition)), condition);
        }

        for (const [key, leaf] of results) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: no leaf of ${source.name} produces ${key}`);
        }
    }

    // Compare one candidate cell with the result: a cell the condition keeps must
    // carry a leaf whose value is the source value verbatim, and a cell it drops
    // must carry none.
    private compareLeaf(
        block: Block,
        key: string,
        leaf: Leaf | undefined,
        candidate: Leaf,
        conditionValue: string | undefined,
        condition: string,
    ): void {
        const kept = this.keeps(block, candidate, conditionValue, condition);

        if (kept === undefined) {
            return;
        }

        if (!kept) {
            if (leaf) {
                this.findings.push(`${block.file}:${leaf.line}: ${block.name}: ${this.render(candidate, conditionValue, condition)} is false, so ${key} should be filtered out`);
            }

            return;
        }

        if (!leaf) {
            this.findings.push(`${block.file}:${block.line}: ${block.name}: no leaf for ${key}, where ${this.render(candidate, conditionValue, condition)} holds`);
            return;
        }

        this.checkedLeaves += 1;
        this.compareComment(block, leaf, candidate, conditionValue, condition);

        if (leaf.total !== candidate.total) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: states ${leaf.total}, ${candidate.total} is what ${candidate.text.trim()} carries`);
        }
    }

    // Compare the comparison a leaf states in its comment with the pair it was
    // kept by. The pair may be stated either way round — `245 > 10` and
    // `1200 < 1391.82926829268292674` are both in `step-5.example_2.lang` — and a
    // comment that states no comparison at all makes no claim to check.
    private compareComment(block: Block, leaf: Leaf, candidate: Leaf, conditionValue: string | undefined, condition: string): void {
        const shown = COMMENT_COMPARISON.exec(leaf.text);

        if (!shown || condition === CONTAINS || conditionValue === undefined) {
            return;
        }

        const straight = shown[1] === candidate.total && shown[3] === conditionValue && shown[2] === condition.replaceAll('"', '');
        const mirrored = shown[1] === conditionValue && shown[3] === candidate.total && shown[2] === MatrixOperation.mirrored(condition);

        if (!straight && !mirrored) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: comment states ${shown[1]} ${shown[2]} ${shown[3]}, the pair is ${this.render(candidate, conditionValue, condition)}`);
        }
    }

    // Whether the condition keeps one cell. A cell the condition matrix does not
    // carry is dropped whatever the condition: there is no pair to compare, which
    // is what `requests_i_j_corrected_exceed(2 from R)` of `step-5.example_1.lang`
    // spells out — «ПКОП без ячейки». Undefined marks a cell that cannot be
    // decided — a value that is not a number — which is reported here and then
    // left out of the comparison.
    private keeps(block: Block, candidate: Leaf, conditionValue: string | undefined, condition: string): boolean | undefined {
        if (condition === CONTAINS || conditionValue === undefined) {
            return conditionValue !== undefined;
        }

        const left = Decimal.parse(candidate.total);
        const right = Decimal.parse(conditionValue);

        if (!left || !right) {
            this.findings.push(`${block.file}:${block.line}: ${block.name}: ${this.render(candidate, conditionValue, condition)} is not a comparison of numbers`);
            return undefined;
        }

        return MatrixOperation.compare(condition, left, right);
    }

    // The comparison one cell stands or falls by, spelled the way the example
    // files spell a condition. A cell the condition matrix does not carry reads
    // as absent rather than as a number.
    private render(candidate: Leaf, conditionValue: string | undefined, condition: string): string {
        if (condition === CONTAINS) {
            return `${CONTAINS} ${conditionValue === undefined ? 'nothing' : conditionValue}`;
        }

        return `${candidate.total} ${condition.replaceAll('"', '')} ${conditionValue ?? 'nothing'}`;
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
