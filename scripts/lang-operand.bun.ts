import {Decimal} from './lang-decimal.bun.ts';
import {ExampleIndex} from './lang-example.bun.ts';
import type {Block, Coordinates} from './lang-example.bun.ts';
import {MatrixOperation} from './lang-operation.bun.ts';

// The value of one operand of a primitive, whether the example files write it
// out or only name the call that produces it.
//
// `assign_matrix` is the reason this exists: most of its arguments are nested
// calls — `assign_matrix(filter_by_pair(...), filter_by_value(...))` — whose
// result no example file expands, so a checker that only reads expanded
// variables could say nothing about four fifths of them. The primitives
// evaluated here are exactly the ones the example files nest: they produce no
// leaf of their own, so nothing is being checked against itself.
//
// The element-level semantics (which comparison, which arithmetic) live in
// `MatrixOperation`, shared with the checkers of the primitives themselves.

// One cell of an evaluated matrix: the coordinates it sits on and the value it
// carries, kept as the example file spells it.
type Cell = {coordinates: Coordinates; value: string};

// An evaluated operand. `axes` are its axis letters, sorted, and `cells` is
// keyed by `ExampleIndex.coordinateKey` along those axes. An empty matrix
// carries no axes: nothing fixes its shape, and nothing needs it.
type Matrix = {axes: string[]; cells: Map<string, Cell>; name: string};

// A call this evaluator computes, and the arguments it was given.
const CALL = /^([a-z_]+)\((.+)\)$/;

// The primitives evaluated here. A reference such as
// `normalized_i_j_k_l(2 from R)(1)` looks like a call too, which is why the
// name is matched against this set rather than against the syntax alone.
const PRIMITIVES: ReadonlySet<string> = new Set([
    'filter_by_pair',
    'filter_by_value',
    'filter_by_coordinate',
    'for_each_pair',
    'replace_coord',
    'count_coordinates_by_axis',
]);

class OperandEvaluator {
    // What could not be evaluated, and why. The caller prints these as notes:
    // an operand this evaluator cannot read is not a disagreement.
    readonly notes: string[] = [];

    // The unexpanded variables whose expressions are being evaluated right now.
    private readonly evaluating = new Set<string>();

    constructor(private readonly index: ExampleIndex) {}

    // The value of one operand — an expanded variable, or one of the nested
    // calls the example files build an `assign_matrix` argument from. Undefined
    // marks an operand that cannot be read, with a note saying which.
    evaluate(reference: string, where: string): Matrix | undefined {
        const call = CALL.exec(reference.trim());

        if (!call || !PRIMITIVES.has(call[1])) {
            return this.fromVariable(reference.trim(), where);
        }

        const args = ExampleIndex.splitArguments(call[2]);

        if (call[1] === 'filter_by_pair') {
            return this.filterByPair(args, where);
        }

        if (call[1] === 'filter_by_value') {
            return this.filterByValue(args, where);
        }

        if (call[1] === 'filter_by_coordinate') {
            return this.filterByCoordinate(args, where);
        }

        if (call[1] === 'for_each_pair') {
            return this.forEachPair(args, where);
        }

        if (call[1] === 'replace_coord') {
            return this.replaceCoord(args, where);
        }

        if (call[1] === 'count_coordinates_by_axis') {
            return this.countCoordinatesByAxis(args, where);
        }

        throw new Error(`unreachable: ${call[1]} is listed as a primitive but not evaluated`);
    }

    // The matrix an expanded variable holds. A variable the example states as a
    // call without writing its result out is computed from that call instead —
    // `volumes_l_t_i_k_k0_i0_require_correct` of `step-0.example_*.lang`, whose
    // result is the source matrix itself and would only be duplicated.
    private fromVariable(reference: string, where: string): Matrix | undefined {
        const block = this.index.resolve(reference);

        if (!block) {
            this.notes.push(`${where}: ${reference} is not an expanded variable`);
            return undefined;
        }

        if (!block.leaves.length && this.isCall(block.expression)) {
            return this.fromExpression(block.expression, reference, where);
        }

        if (block.signatures.length > 1) {
            this.notes.push(`${where}: ${reference} mixes leaf shapes; not evaluated`);
            return undefined;
        }

        return this.matrixOf(block);
    }

    // Whether an expression is a call this evaluator can carry out.
    private isCall(expression: string): boolean {
        const call = CALL.exec(expression.trim());

        return Boolean(call && PRIMITIVES.has(call[1]));
    }

    // The value of an unexpanded variable's own expression, refusing a variable
    // that is defined, directly or through others, in terms of itself.
    private fromExpression(expression: string, reference: string, where: string): Matrix | undefined {
        if (this.evaluating.has(reference)) {
            this.notes.push(`${where}: ${reference} is defined in terms of itself; not evaluated`);
            return undefined;
        }

        this.evaluating.add(reference);

        try {
            return this.evaluate(expression, where);
        } finally {
            this.evaluating.delete(reference);
        }
    }

    // A block as a matrix, on the single axis signature its leaves share.
    private matrixOf(block: Block): Matrix {
        const axes = block.signatures[0] ?? [];
        const cells = new Map<string, Cell>();

        for (const leaf of block.leaves) {
            cells.set(this.index.coordinateKey(leaf.coordinates, axes), {coordinates: leaf.coordinates, value: leaf.total});
        }

        return {axes, cells, name: block.name};
    }

    // `filter_by_pair(source, condit, matrix_condition)`: the cells of the
    // source the condition keeps, with their values copied over. A cell the
    // condition matrix does not carry is dropped whatever the condition.
    private filterByPair(args: string[], where: string): Matrix | undefined {
        if (args.length !== 3) {
            this.notes.push(`${where}: filter_by_pair takes three arguments, got ${args.length}`);
            return undefined;
        }

        const source = this.evaluate(args[0], where);
        const against = this.evaluate(args[2], where);

        if (!source || !against || !this.readableAlong(source, against, where)) {
            return undefined;
        }

        const condition = args[1];

        if (condition !== MatrixOperation.CONTAINS && !MatrixOperation.compares(condition)) {
            this.notes.push(`${where}: condition ${condition} is not implemented`);
            return undefined;
        }

        const cells = new Map<string, Cell>();

        for (const [key, cell] of source.cells) {
            const value = against.cells.get(this.index.coordinateKey(cell.coordinates, against.axes))?.value;

            if (value === undefined) {
                continue;
            }

            if (condition === MatrixOperation.CONTAINS) {
                cells.set(key, cell);
                continue;
            }

            const pair = this.pair(cell.value, value, where);

            if (!pair) {
                return undefined;
            }

            if (MatrixOperation.compare(condition, pair[0], pair[1])) {
                cells.set(key, cell);
            }
        }

        return {axes: source.axes, cells, name: `filter_by_pair(${source.name}, ${condition}, ${against.name})`};
    }

    // `filter_by_value(source, condit, value)`: the cells whose own value stands
    // in the given relation to one number — a scalar the example files fix, or a
    // literal.
    private filterByValue(args: string[], where: string): Matrix | undefined {
        if (args.length !== 3) {
            this.notes.push(`${where}: filter_by_value takes three arguments, got ${args.length}`);
            return undefined;
        }

        const source = this.evaluate(args[0], where);
        const threshold = this.number(args[2], where);

        if (!source || !threshold) {
            return undefined;
        }

        if (!MatrixOperation.compares(args[1])) {
            this.notes.push(`${where}: condition ${args[1]} is not implemented`);
            return undefined;
        }

        const cells = new Map<string, Cell>();

        for (const [key, cell] of source.cells) {
            const value = Decimal.parse(cell.value);

            if (!value) {
                this.notes.push(`${where}: ${cell.value} is not a number`);
                return undefined;
            }

            if (MatrixOperation.compare(args[1], value, threshold)) {
                cells.set(key, cell);
            }
        }

        return {axes: source.axes, cells, name: `filter_by_value(${source.name}, ${args[1]}, ${args[2]})`};
    }

    // `filter_by_coordinate(source, Tcoord(1), ..., Tcoord(N))`: on every axis
    // the arguments name, only the listed coordinates of that axis survive —
    // the coordinates of one axis are alternatives, the axes themselves are all
    // required. An axis named by a single coordinate is fixed and leaves the
    // matrix (the submatrix the call names carries it); an axis named by several
    // keeps them and stays.
    private filterByCoordinate(args: string[], where: string): Matrix | undefined {
        const source = this.evaluate(args[0], where);

        if (!source) {
            return undefined;
        }

        const fixed = args.slice(1).map((argument) => this.index.coordinate(argument, source.axes));

        const unresolved = args.slice(1).filter((argument, position) => !fixed[position]);

        if (unresolved.length) {
            this.notes.push(`${where}: ${unresolved.join(', ')} does not name one coordinate of ${source.name}`);
            return undefined;
        }

        const kept = new Map<string, number[]>();

        for (const coordinate of fixed) {
            kept.set(coordinate!.letter, [...(kept.get(coordinate!.letter) ?? []), coordinate!.index]);
        }

        const removed = [...kept].filter(([, indices]) => indices.length === 1).map(([letter]) => letter);
        const axes = source.axes.filter((letter) => !removed.includes(letter));
        const cells = new Map<string, Cell>();

        for (const cell of source.cells.values()) {
            if ([...kept].some(([letter, indices]) => !this.carries(cell, letter, indices))) {
                continue;
            }

            const coordinates: Coordinates = new Map([...cell.coordinates].filter(([letter]) => !removed.includes(letter)));

            cells.set(this.index.coordinateKey(coordinates, axes), {coordinates, value: cell.value});
        }

        return {axes, cells, name: `filter_by_coordinate(${source.name}, ${args.slice(1).join(', ')})`};
    }

    // Whether a cell sits on one of the coordinates an axis was filtered by. A
    // cell the axis does not reach at all carries none of them.
    private carries(cell: Cell, letter: string, indices: number[]): boolean {
        const index = cell.coordinates.get(letter);

        return index !== undefined && indices.includes(index);
    }

    // `for_each_pair(left, operat, right)`: the operation applied cell by cell
    // on the coordinates of the left operand, with a cell the right operand does
    // not carry reading as zero.
    private forEachPair(args: string[], where: string): Matrix | undefined {
        if (args.length !== 3) {
            this.notes.push(`${where}: for_each_pair takes three arguments, got ${args.length}`);
            return undefined;
        }

        const left = this.evaluate(args[0], where);
        const right = this.evaluate(args[2], where);

        if (!left || !right || !this.readableAlong(left, right, where)) {
            return undefined;
        }

        if (!MatrixOperation.spelling(args[1])) {
            this.notes.push(`${where}: operation ${args[1]} is not implemented`);
            return undefined;
        }

        const cells = new Map<string, Cell>();

        for (const [key, cell] of left.cells) {
            const other = right.cells.get(this.index.coordinateKey(cell.coordinates, right.axes))?.value ?? '0';
            const pair = this.pair(cell.value, other, where);

            if (!pair) {
                return undefined;
            }

            const value = MatrixOperation.apply(pair[0], args[1], pair[1]);

            if (!value) {
                this.notes.push(`${where}: ${cell.value} ${args[1]} ${other} divides by zero`);
                return undefined;
            }

            cells.set(key, {coordinates: cell.coordinates, value: value.toString()});
        }

        return {axes: left.axes, cells, name: `for_each_pair(${left.name}, ${args[1]}, ${right.name})`};
    }

    // `replace_coord(source, coord_source, coord_new)`: the same values on the
    // axis of `coord_new`, which the source may not carry at all — a queue whose
    // index the variable name fixes is reintroduced as an axis here.
    private replaceCoord(args: string[], where: string): Matrix | undefined {
        if (args.length !== 3) {
            this.notes.push(`${where}: replace_coord takes three arguments, got ${args.length}`);
            return undefined;
        }

        const source = this.evaluate(args[0], where);
        const replaced = this.index.coordinate(args[2]);

        if (!source || !replaced) {
            this.notes.push(replaced ? `${where}: ${args[0]} is not readable` : `${where}: ${args[2]} does not name a coordinate`);
            return undefined;
        }

        const axes = source.axes.includes(replaced.letter) ? source.axes : [...source.axes, replaced.letter].sort();
        const cells = new Map<string, Cell>();

        for (const cell of source.cells.values()) {
            const coordinates: Coordinates = new Map([...cell.coordinates, [replaced.letter, replaced.index]]);

            cells.set(this.index.coordinateKey(coordinates, axes), {coordinates, value: cell.value});
        }

        return {axes, cells, name: `replace_coord(${source.name}, ${args[1]}, ${args[2]})`};
    }

    // `count_coordinates_by_axis(source, Axis)`: the source with one axis
    // collapsed away, each remaining cell holding the number of coordinates the
    // source carries along that axis. A group the source carries at all holds at
    // least one cell, so a count is never zero.
    private countCoordinatesByAxis(args: string[], where: string): Matrix | undefined {
        if (args.length !== 2) {
            this.notes.push(`${where}: count_coordinates_by_axis takes two arguments, got ${args.length}`);
            return undefined;
        }

        const source = this.evaluate(args[0], where);
        const counted = ExampleIndex.letterOf(args[1].trim());

        if (!source || !counted) {
            if (source) {
                this.notes.push(`${where}: ${args[1]} is not a known axis`);
            }

            return undefined;
        }

        if (source.cells.size && !source.axes.includes(counted)) {
            this.notes.push(`${where}: ${source.name} is laid out on ${source.axes.join(', ')}, which does not carry ${args[1]}`);
            return undefined;
        }

        const axes = source.axes.filter((letter) => letter !== counted);
        const counts = new Map<string, Cell>();

        for (const cell of source.cells.values()) {
            const coordinates: Coordinates = new Map([...cell.coordinates].filter(([letter]) => letter !== counted));
            const key = this.index.coordinateKey(coordinates, axes);
            const seen = Number(counts.get(key)?.value ?? '0');

            counts.set(key, {coordinates, value: String(seen + 1)});
        }

        return {axes, cells: counts, name: `count_coordinates_by_axis(${source.name}, ${args[1]})`};
    }

    // Whether the second operand can be read along the first: a condition or a
    // right-hand matrix is read on its own axes, which must be axes the left
    // operand carries as well. An empty left operand carries no axes and fixes
    // no shape — it produces an empty result whatever the other operand is, so
    // there is nothing to disagree about.
    private readableAlong(source: Matrix, other: Matrix, where: string): boolean {
        if (!source.cells.size) {
            return true;
        }

        const missing = other.axes.filter((letter) => !source.axes.includes(letter));

        if (missing.length) {
            this.notes.push(`${where}: ${other.name} carries ${missing.join(', ')}, which ${source.name} does not`);
            return false;
        }

        return true;
    }

    // The number a reference stands for: a scalar the example files fix, or a
    // literal written in place.
    private number(reference: string, where: string): Decimal | undefined {
        const scalar = this.index.scalar(reference);
        const value = Decimal.parse(scalar?.value ?? reference);

        if (!value) {
            this.notes.push(`${where}: ${reference} is not a number`);
        }

        return value;
    }

    // The two values of one element-level operation, reported and given up on
    // when either of them is not a number.
    private pair(left: string, right: string, where: string): [Decimal, Decimal] | undefined {
        const first = Decimal.parse(left);
        const second = Decimal.parse(right);

        if (!first || !second) {
            this.notes.push(`${where}: ${left} and ${right} are not both numbers`);
            return undefined;
        }

        return [first, second];
    }
}

export {OperandEvaluator};
export type {Cell, Matrix};
