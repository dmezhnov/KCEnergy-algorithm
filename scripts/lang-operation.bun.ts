import {Decimal} from './lang-decimal.bun.ts';

// The element-level semantics of the matrix primitives, in one place: the
// arithmetic `for_each_pair` applies, the comparisons a condition spells, and
// the way the example files write each of them down.
//
// Every checker of a primitive needs the same table — `pair-check` to re-derive
// a leaf, `filter-check` to decide whether a cell is kept, and the operand
// evaluator of `assign-check` to compute a nested call whose result no example
// file writes out. Keeping one copy is what stops the three from drifting.

// How many fraction digits the example files keep. A quotient or a product that
// does not terminate sooner is cut to this many digits, towards zero.
const DISPLAY_DIGITS = 18;

// The condition that keeps a cell when the condition matrix carries one at the
// same coordinates at all, whatever value it holds.
const CONTAINS = 'contains';

// How each operation is spelled in a leaf line: an infix operator, or the name
// of the call the leaf shows. `safe_divide` prints as a plain division.
const LEAF_SPELLING: ReadonlyMap<string, string> = new Map([
    ['"+"', '+'],
    ['"-"', '-'],
    ['"*"', '*'],
    ['"/"', '/'],
    ['safe_divide', '/'],
    ['min', 'min'],
]);

// The comparisons a condition can spell, each as the example files write it.
const COMPARISONS: ReadonlyMap<string, (left: Decimal, right: Decimal) => boolean> = new Map([
    ['">"', (left, right) => left.compare(right) > 0],
    ['">="', (left, right) => left.compare(right) >= 0],
    ['"<"', (left, right) => left.compare(right) < 0],
    ['"<="', (left, right) => left.compare(right) <= 0],
    ['"="', (left, right) => left.compare(right) === 0],
    ['"!="', (left, right) => left.compare(right) !== 0],
]);

// The condition each comparison mirrors into, for the leaves that state the pair
// the other way round: `filter_by_pair(x, ">", y)` keeps a cell either as
// `x > y` or as `y < x`, and the example files use both spellings.
const MIRRORED: ReadonlyMap<string, string> = new Map([
    ['">"', '<'],
    ['">="', '<='],
    ['"<"', '>'],
    ['"<="', '>='],
    ['"="', '='],
    ['"!="', '!='],
]);

// The comparison a leaf may state in its comment, e.g. `# 2260 >= 1440`. A leaf
// whose comment says anything else — a request number, most often — makes no
// claim a checker can read. The longer operators come first, so that `>=` is
// never read as a `>` with a stray character after it.
const COMMENT_COMPARISON = /#\s*(-?\d+(?:\.\d+)?)\s*(!=|>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)/;

class MatrixOperation {
    static readonly DISPLAY_DIGITS = DISPLAY_DIGITS;
    static readonly CONTAINS = CONTAINS;

    // How a leaf line spells an operation, or `undefined` for one no checker
    // implements yet.
    static spelling(operation: string): string | undefined {
        return LEAF_SPELLING.get(operation);
    }

    // Whether a condition is a comparison of two numbers — `contains`, which
    // compares nothing, is deliberately not one of them.
    static compares(condition: string): boolean {
        return COMPARISONS.has(condition);
    }

    // The operator a comparison turns into when its operands are swapped.
    static mirrored(condition: string): string | undefined {
        return MIRRORED.get(condition);
    }

    // The comparison a leaf states in its comment, or `undefined` for a comment
    // that states none.
    static comparisonShown(text: string): {left: string; operator: string; right: string} | undefined {
        const shown = COMMENT_COMPARISON.exec(text);

        return shown ? {left: shown[1], operator: shown[2], right: shown[3]} : undefined;
    }

    // Whether the pair satisfies the condition.
    static compare(condition: string, left: Decimal, right: Decimal): boolean {
        const comparison = COMPARISONS.get(condition);

        if (!comparison) {
            throw new Error(`unreachable: ${condition} is accepted but not compared`);
        }

        return comparison(left, right);
    }

    // One element-level operation. Undefined marks a division by zero that the
    // operation does not define away, which the caller reports.
    static apply(left: Decimal, operation: string, right: Decimal): Decimal | undefined {
        if (operation === '"+"') {
            return left.plus(right);
        }

        if (operation === '"-"') {
            return left.minus(right);
        }

        if (operation === '"*"') {
            return left.times(right).truncated(DISPLAY_DIGITS);
        }

        if (operation === 'min') {
            return left.min(right);
        }

        if (operation === 'safe_divide' && right.isZero()) {
            return Decimal.ZERO;
        }

        if (operation === 'safe_divide' || operation === '"/"') {
            return left.dividedBy(right, DISPLAY_DIGITS);
        }

        throw new Error(`unreachable: ${operation} is spelled but not applied`);
    }
}

export {MatrixOperation};
