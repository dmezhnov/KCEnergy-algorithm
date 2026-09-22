import {ExampleIndex} from './lang-example.bun.ts';
import type {Block, Leaf} from './lang-example.bun.ts';
import {OperandEvaluator} from './lang-operand.bun.ts';
import type {Cell, Matrix} from './lang-operand.bun.ts';

// Checker for the `filter_by_coordinate` leaves of the `*.example_*.lang` files.
//
// Where a matrix is the result of `filter_by_coordinate(source, Tcoord(1), ...,
// Tcoord(N))`, it carries the cells of `source` that sit on the given
// coordinates, with those axes collapsed away and every value copied over
// unchanged. The source is written down in the example files, so this script
// re-derives the whole result and compares:
//
//   * the axes the result is laid out on — the source's, less the fixed ones,
//   * the set of leaves — exactly the cells of `source` the coordinates keep,
//     and
//   * the value of each of them, which must be the source value verbatim.
//
// A leaf of such a result comments the requests it stands for (`# 110`), which
// is not a claim about the filtering, so no comment is checked.
//
// Unlike the other primitives, this one is written down in the example files as
// a family: one definition fixes the shape with an index variable
// (`requests_i_j_k_l_queue(l0 for R) = filter_by_coordinate(requests_i_j_k_l_l0,
// l0)`) and the expansions follow as one block per queue. Each expansion is
// checked against the call with its own index substituted for that variable.
//
// As with the other primitives it re-computes only the operation; every input is
// read from the example files, so a disagreement is an error in the worked
// example, never a second implementation of the algorithm.
//
// Usage:
//   bun run scripts/coordinate-check.bun.ts    # exit 1 on any disagreement

// The two example data sets the algorithm files carry.
const EXAMPLE_SUFFIXES: readonly string[] = ['example_1', 'example_2'];

// A `filter_by_coordinate` definition: the source and the coordinates it fixes.
// A call nested inside another primitive is not matched here — its leaves belong
// to the outer result, not to the filter.
const COORDINATE_CALL = /^filter_by_coordinate\((.+)\)$/;

// The head of a family definition: the name, the index variable it is written
// with and the axis that variable runs along, e.g.
// `requests_i_j_k_l_queue(l0 for R)`.
const FAMILY_HEAD = /^([A-Za-z_][A-Za-z0-9_]*)\(([A-Za-z_][A-Za-z0-9_]*) for ([A-Za-z][A-Za-z0-9]*)\)$/;

// One expanded result and the call that produces it, with the index variable of
// a family definition already substituted.
type Target = {block: Block; expression: string};

class CoordinateChecker {
    private index = new ExampleIndex();
    private evaluator = new OperandEvaluator(this.index);
    private findings: string[] = [];
    private notes: string[] = [];
    private checkedBlocks = 0;
    private checkedLeaves = 0;

    // Check every `filter_by_coordinate` result of every data set.
    async run(): Promise<number> {
        const root = process.cwd();

        for (const suffix of EXAMPLE_SUFFIXES) {
            this.index = await ExampleIndex.load(root, suffix);
            this.evaluator = new OperandEvaluator(this.index);
            this.notes.push(...this.index.diagnostics);

            for (const block of this.index.blockList) {
                if (COORDINATE_CALL.test(block.expression)) {
                    this.targets(block).forEach((target) => this.checkTarget(target));
                }
            }

            this.notes.push(...this.evaluator.notes);
        }

        return this.report();
    }

    // The results one definition stands for: the expansions of a family
    // definition, each with its own index put in place of the variable, or the
    // block itself where the definition expands its own leaves.
    private targets(block: Block): Target[] {
        const family = FAMILY_HEAD.exec(this.index.normalizeKey(block.name));

        if (!family) {
            return [{block, expression: block.expression}];
        }

        const expansions = this.expansionsOf(family[1], family[3]);

        if (!expansions.length) {
            this.notes.push(`${block.file}:${block.line}: ${block.name} is expanded for no ${family[3]} index`);
        }

        return expansions.map((expansion) => ({
            block: expansion.block,
            expression: this.substitute(block.expression, family[2], `${expansion.index} from ${family[3]}`),
        }));
    }

    // The expanded members of one family: the blocks named after it with a
    // single index along the family's axis, in file order.
    private expansionsOf(name: string, axis: string): {block: Block; index: number}[] {
        const member = new RegExp(`^${name}\\((\\d+) from ${axis}\\)$`);
        const expansions: {block: Block; index: number}[] = [];

        for (const block of this.index.blockList) {
            const match = member.exec(this.index.normalizeKey(block.name));

            if (match) {
                expansions.push({block, index: Number(match[1])});
            }
        }

        return expansions;
    }

    // One call with an index variable replaced by the index of an expansion. The
    // variable is matched as a whole argument: `l0` is also a substring of the
    // source name `requests_i_j_k_l_l0`, which names a matrix and not an index.
    private substitute(expression: string, variable: string, index: string): string {
        const call = COORDINATE_CALL.exec(expression)!;
        const args = ExampleIndex.splitArguments(call[1]).map((argument) => argument === variable ? index : argument);

        return `filter_by_coordinate(${args.join(', ')})`;
    }

    // Compare one `filter_by_coordinate` result with the cells of its source.
    // The source is read on its own as well as through the call, so that an
    // empty one is reported as such instead of as a shape disagreement.
    private checkTarget(target: Target): void {
        const where = `${target.block.file}:${target.block.line}: ${target.block.name}`;
        const args = ExampleIndex.splitArguments(COORDINATE_CALL.exec(target.expression)![1]);

        if (args.length < 2) {
            this.findings.push(`${where}: expected a source and at least one coordinate, got ${args.length} argument(s)`);
            return;
        }

        // A definition that states the call without writing its result out —
        // `volumes_l_t_i_k_k0_i0_require_correct` of `step-0.example_*.lang`,
        // whose result is the source itself — carries nothing to compare.
        if (!target.block.leaves.length) {
            this.notes.push(`${where}: ${target.block.name} states the call without expanding it`);
            return;
        }

        const source = this.evaluator.evaluate(args[0], where);

        if (!source) {
            return;
        }

        if (!source.cells.size) {
            this.reportEmptySource(target.block, source, where);
            return;
        }

        const computed = this.evaluator.evaluate(target.expression, where);
        const filtered = computed && this.asMember(target.block, computed);

        if (!filtered || !this.sameShape(target.block, filtered, where)) {
            return;
        }

        this.checkedBlocks += 1;
        this.compareLeaves(target.block, source, filtered, where);
    }

    // An empty source produces an empty result: there is nothing to filter, and
    // any leaf the result does carry has no source.
    private reportEmptySource(block: Block, source: Matrix, where: string): void {
        this.notes.push(`${where}: ${source.name} is empty`);

        for (const leaf of block.leaves) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: ${source.name} is empty, so this leaf has no source`);
        }
    }

    // A family member states its own coordinates in its name —
    // `requests_i_j_k_l_queue(1 from R)` — and lays its leaves out without them.
    // `filter_by_coordinate` removes coordinates, not axes, so the computed
    // matrix still carries those axes; take the member out of it.
    private asMember(block: Block, filtered: Matrix): Matrix {
        const fixed = this.index.parseCoordinates(block.name);
        const axes = filtered.axes.filter((letter) => !fixed.has(letter));

        if (axes.length === filtered.axes.length) {
            return filtered;
        }

        const cells = new Map<string, Cell>();

        for (const cell of filtered.cells.values()) {
            if ([...fixed].some(([letter, index]) => cell.coordinates.get(letter) !== index)) {
                continue;
            }

            const coordinates = new Map([...cell.coordinates].filter(([letter]) => !fixed.has(letter)));

            cells.set(this.index.coordinateKey(coordinates, axes), {coordinates, value: cell.value});
        }

        return {axes, cells, name: filtered.name};
    }

    // The result is laid out on the source's axes less the ones its own name
    // fixes, which is the shape the kept cells come back on.
    private sameShape(block: Block, filtered: Matrix, where: string): boolean {
        for (const signature of block.signatures) {
            if (signature.join() !== filtered.axes.join()) {
                this.findings.push(`${where}: leaves are laid out on ${signature.join(', ')}, the kept cells on ${filtered.axes.join(', ')}`);
                return false;
            }
        }

        return true;
    }

    // Compare the kept cells with the leaves the result writes down: every cell
    // the coordinates keep must carry a leaf holding its value, and no leaf may
    // sit where no source cell was kept.
    private compareLeaves(block: Block, source: Matrix, filtered: Matrix, where: string): void {
        const leaves = new Map(block.leaves.map((leaf) => [this.index.coordinateKey(leaf.coordinates, filtered.axes), leaf]));

        for (const [key, cell] of filtered.cells) {
            const leaf = leaves.get(key);
            leaves.delete(key);

            if (!leaf) {
                this.findings.push(`${where}: no leaf for ${key}, where ${source.name} carries ${cell.value}`);
                continue;
            }

            this.checkedLeaves += 1;
            this.compareLeaf(block, leaf, cell, source);
        }

        for (const [key, leaf] of leaves) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: no cell of ${source.name} is kept at ${key}`);
        }
    }

    // Compare one leaf with the cell it stands for. A filter copies its values,
    // so the leaf must state the source value verbatim.
    private compareLeaf(block: Block, leaf: Leaf, cell: Cell, source: Matrix): void {
        if (leaf.total !== cell.value) {
            this.findings.push(`${block.file}:${leaf.line}: ${block.name}: states ${leaf.total}, ${cell.value} is what ${source.name} carries`);
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

        const scope = `${this.checkedLeaves} leaf/leaves of ${this.checkedBlocks} filter_by_coordinate result(s)`;

        if (this.findings.length) {
            process.stdout.write(`\nFound ${this.findings.length} disagreement(s) in ${scope}.\n`);
            return 1;
        }

        process.stdout.write(`Recomputed ${scope}: all match.\n`);

        return 0;
    }
}

if (import.meta.main) {
    process.exitCode = await new CoordinateChecker().run();
}

export {CoordinateChecker};
