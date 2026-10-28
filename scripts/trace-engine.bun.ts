// Bun has no path helpers of its own; everything else below uses the Bun API.
import path from 'node:path';

import {ExampleIndex} from './lang-example.bun.ts';
import type {Coordinates} from './lang-example.bun.ts';
import type {TemplateNode} from './trace-template.bun.ts';

// Renders the trace-string template of `step-n-plus-1.lang` for one request of
// an example data set. The template IS the program: nothing about the steps is
// hand-coded here, every number is copied from a leaf of an expanded variable.
//
// What the template text means:
// - `$Axis(x)` is the label of the request's coordinate on that axis, `$Axis(3)`
//   the label of coordinate 3;
// - `name(qualifiers)(args)` is the leaf of that variable: an index letter reads
//   the request's coordinate, a number the coordinate of the axis the
//   variable's `of number` legend puts at that position, `3 from R` coordinate 3
//   of R; `(l0)` / `(l0 - 1)` are the request's queue (minus one), `(n)` /
//   `(n + 1)` the last normalisation pass of that queue (plus one);
// - `E(1), ..., E(B)` is a list over ONE index: the index sits where the first
//   element writes 1 and the last one an axis size of matrix_types.lang (B),
//   and an element is kept only when every leaf it reads exists. An element may
//   itself be a list in parentheses — `(X(1)(1), ..., X(1)(D)), ..., (X(S)(1),
//   ..., X(S)(D))` — and the outer index runs slower. A list inside a line is
//   wrapped in parentheses and prints `a, b, c`; a list whose elements end
//   lines with `,` prints one element per line. Its parentheses and commas
//   print nothing;
// - `{if: …}{then: …}{else if: …}{else: …}` chooses a branch; a line holding
//   only markup prints nothing, and a text line loses 4 spaces of indentation
//   per branch it sits in.

// Indentation a text line loses per enclosing branch.
const INDENT = 4;

// The index letter each argument name of the template stands for.
const LETTERS: Readonly<Record<string, string>> = {i: 'I', j: 'J', x: 'X', k: 'K', l: 'P', l0: 'R', s: 'C', q: 'Z'};

// The input matrix: one leaf per request.
const REQUESTS = 'requests_i_j_x_k_l_s_l0_q';

const REFERENCE = /(\$?)([A-Za-z_][A-Za-z0-9_]*)((?:\([^()]*\))*)/g;
const SCALAR_NAME = /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/;
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/;
const TOKEN = /[A-Za-z_][A-Za-z0-9_]*|\d+|\s+|./g;
const ELLIPSIS = '...';

// Page width of the trace text (the comment prefix not counted): the Google Doc
// the template comes from holds 68 characters of Fira Code per line.
const WIDTH = 68;

// Where a list inside a line starts, and the places between its elements where the line may break.
const LIST_START = '\u0001';
const BREAK = '\u0002';

// What a line shows in place of a value the example does not hold.
const ABSENT_VALUE = '—';

class TraceEngine {
    private readonly axisByLetter = new Map<string, {name: string; labels: Map<number, string>}>();
    private readonly axisByName = new Map<string, string>();
    private readonly legendOrders = new Map<string, string[]>();
    readonly requests: Coordinates[];

    private constructor(
        private readonly index: ExampleIndex,
        readonly dataset: string,
        private readonly template: TemplateNode[],
        // The axis each size constant of matrix_types.lang counts (`D of number = length(Request)`):
        // the bounds a list may run to.
        private readonly sizeAxes: ReadonlyMap<string, string>,
        // The step files, not their examples: a variable's argument order is the one its definition states.
        private readonly stepTexts: string[],
    ) {
        for (const axis of index.axesByName.values()) {
            this.axisByLetter.set(axis.letter, axis);
            this.axisByName.set(axis.name, axis.letter);
        }

        const table = index.blocks.get(REQUESTS);

        if (!table) {
            throw new Error(`${dataset}: ${REQUESTS} is not expanded; no traces can be rendered`);
        }

        this.requests = [...table.values.keys()].map((key) => index.coordinatesFromKey(key));
    }

    static async load(root: string, suffix: string, template: TemplateNode[]): Promise<TraceEngine> {
        const types = await Bun.file(path.join(root, 'matrix_types.lang')).text();
        const sizeAxes = new Map(
            [...types.matchAll(/^\s*(\w+)\s+of number = length\((\w+)\)/gm)].map((match) => [match[1]!, match[2]!] as const),
        );
        const stepFiles = [...new Bun.Glob('*.lang').scanSync(root)].filter((file) => !file.includes('.example_'));
        const stepTexts = await Promise.all(stepFiles.map((file) => Bun.file(path.join(root, file)).text()));

        return new TraceEngine(await ExampleIndex.load(root, suffix), suffix, template, sizeAxes, stepTexts);
    }

    // The label of a request, as the section header names it.
    requestLabel(request: Coordinates): string {
        return this.label('Z', request);
    }

    render(request: Coordinates): string {
        const lines = this.select(request);
        const out: string[] = [];

        for (let index = 0; index < lines.length;) {
            const end = TraceEngine.verticalListEnd(lines, index);

            if (end === undefined) {
                out.push(this.renderText(lines[index]!, request, false)!);
                index += 1;
                continue;
            }

            const indent = /^\s*/.exec(lines[index]!)![0];
            out.push(...this.expandList(lines.slice(index, end + 1).join('\n'), request).map((element) => indent + element));
            index = end + 1;
        }

        return out.map((line) => TraceEngine.wrap(line)).join('\n').replace(/\n+$/, '');
    }

    // The axis letters of a variable's arguments, by position, from the `name(...)(i, j, …) of number`
    // legend in the `where` block of its definition. Legends elsewhere reorder the arguments
    // freely (requests_i_j_k_l_queue is written three ways), so only the definition's counts;
    // every definition of a family must agree, or a numbered argument would be ambiguous.
    private legendOrder(name: string): string[] {
        const known = this.legendOrders.get(name);

        if (known) {
            return known;
        }

        const definition = new RegExp(`^${name}(?:\\([^()]*\\))* =`);
        const legend = new RegExp(`^\\s+${name}((?:\\([^()]*\\))*)\\s+of\\s+number\\b`);
        const orders = new Set<string>();

        for (const lines of this.stepTexts.map((text) => text.split('\n'))) {
            lines.forEach((line, at) => {
                if (!definition.test(line)) {
                    return;
                }

                for (let next = at + 1; next < lines.length && /^\s/.test(lines[next]!); next += 1) {
                    const match = legend.exec(lines[next]!);

                    if (!match) {
                        continue;
                    }

                    const args = [...match[1]!.matchAll(/\(([^()]*)\)/g)].at(-1)?.[1]!.split(',').map((arg) => arg.trim()) ?? [];

                    if (args.every((arg) => LETTERS[arg])) {
                        orders.add(args.map((arg) => LETTERS[arg]!).join(','));
                    }

                    break;
                }
            });
        }

        if (orders.size !== 1) {
            const found = orders.size === 0 ? 'no' : 'conflicting';
            throw new Error(`${name}: ${found} "of number" legend(s) under its definition: ${[...orders].join(' | ')}`);
        }

        const order = [...orders][0]!.split(',');
        this.legendOrders.set(name, order);
        return order;
    }

    // A line wider than the page breaks after the commas of its list, and the rest
    // continues under the list's first element.
    private static wrap(line: string): string {
        const start = line.indexOf(LIST_START);

        if (start < 0) {
            return line;
        }

        const indent = ' '.repeat([...line.slice(0, start).replaceAll(BREAK, ' ')].length);
        const [first, ...rest] = line.replaceAll(LIST_START, '').split(BREAK);
        const lines = [first!];

        for (const segment of rest) {
            const joined = `${lines.at(-1)!} ${segment}`;

            if ([...joined].length > WIDTH) {
                lines.push(indent + segment);
            } else {
                lines[lines.length - 1] = joined;
            }
        }

        return lines.join('\n');
    }

    // The last line of a list starting at `start` whose elements end lines with
    // `,`: the run of lines chained by trailing commas, when it holds a `...,` line.
    private static verticalListEnd(lines: string[], start: number): number | undefined {
        let end = start;

        while (end < lines.length - 1 && lines[end]!.trimEnd().endsWith(',')) {
            end += 1;
        }

        const run = lines.slice(start, end + 1);
        return run.some((line) => line.trim() === `${ELLIPSIS},`) ? end : undefined;
    }

    // Text with its parenthesised lists expanded and its references read. With
    // `strict` (a list element) a missing leaf drops the whole text; otherwise it prints «—».
    private renderText(text: string, at: Coordinates, strict: boolean): string | undefined {
        let out = '';
        let plainStart = 0;
        let listCount = 0;
        let nonEmptyLists = 0;
        const flushPlain = (end: number): boolean => {
            const plain = this.substitute(text.slice(plainStart, end), at, strict);

            if (plain === undefined) {
                return false;
            }

            out += plain;
            return true;
        };

        for (let open = 0; open < text.length; open += 1) {
            if (text[open] !== '(' || /[A-Za-z0-9_)]/.test(text[open - 1] ?? '')) {
                continue;
            }

            const close = TraceEngine.matchingParen(text, open);
            const content = text.slice(open + 1, close);

            if (!TraceEngine.isList(content)) {
                continue;
            }

            if (!flushPlain(open)) {
                return undefined;
            }

            const elements = this.expandList(content, at);
            listCount += 1;

            if (elements.length > 0) {
                nonEmptyLists += 1;
            }

            out += LIST_START + elements.join(`,${BREAK}`);
            plainStart = close + 1;
            open = close;
        }

        if (!flushPlain(text.length)) {
            return undefined;
        }

        if (strict && listCount > 0 && nonEmptyLists === 0) {
            return undefined;
        }

        return out;
    }

    // `E(1), ..., E(B)`: the elements that exist, in index order, nested lists flattened.
    private expandList(content: string, at: Coordinates): string[] {
        const items = TraceEngine.splitTopLevel(content);

        if (!TraceEngine.isList(content)) {
            throw new Error(`${this.dataset}: not a list "E(1), ..., E(B)": ${content}`);
        }

        const {template, slots, letter} = this.listIndex(items[0]!.trim(), items[2]!.trim());
        const elements: string[] = [];

        for (const index of [...this.axisByLetter.get(letter)!.labels.keys()].sort((a, b) => a - b)) {
            const tokens = [...template];

            for (const slot of slots) {
                tokens[slot] = String(index);
            }

            const element = tokens.join('');
            const wrapped = /^\(/.test(element) && TraceEngine.matchingParen(element, 0) === element.length - 1;
            const group = wrapped ? element.slice(1, -1) : undefined;

            if (group !== undefined && TraceEngine.isList(group)) {
                elements.push(...this.expandList(group, at));
                continue;
            }

            const rendered = this.renderText(element, at, true);

            if (rendered !== undefined) {
                elements.push(rendered.trim());
            }
        }

        return elements;
    }

    // Where the index of a list sits: the tokens at which its first element
    // writes 1 and its last one an axis size; every other token must agree.
    private listIndex(first: string, last: string): {template: string[]; slots: number[]; letter: string} {
        const a = first.match(TOKEN) ?? [];
        const b = last.match(TOKEN) ?? [];
        const fail = (why: string): Error => new Error(`${this.dataset}: list ${why}:\n  ${first}\n  ${last}`);

        if (a.length !== b.length) {
            throw fail('ends differ in shape');
        }

        const slots: number[] = [];
        const bounds = new Set<string>();

        a.forEach((token, at) => {
            const other = b[at]!;

            if (token === other || (/^\s+$/.test(token) && /^\s+$/.test(other))) {
                return;
            }

            if (token === '1' && this.sizeAxes.has(other)) {
                slots.push(at);
                bounds.add(other);
                return;
            }

            throw fail(`ends differ at "${token}" / "${other}", not at an index`);
        });

        if (bounds.size !== 1) {
            throw fail(bounds.size === 0 ? 'has no index' : `runs over more than one index (${[...bounds].join(', ')})`);
        }

        const axisName = this.sizeAxes.get([...bounds][0]!)!;
        const letter = this.index.axesByName.get(axisName)?.letter;

        if (!letter) {
            throw fail(`bound names the unknown axis ${axisName}`);
        }

        return {template: a, slots, letter};
    }

    private static isList(content: string): boolean {
        const items = TraceEngine.splitTopLevel(content);
        return items.length === 3 && items[1]!.trim() === ELLIPSIS;
    }

    private static splitTopLevel(text: string): string[] {
        const items: string[] = [];
        let depth = 0;
        let start = 0;

        for (let at = 0; at < text.length; at += 1) {
            if (text[at] === '(') {
                depth += 1;
            } else if (text[at] === ')') {
                depth -= 1;
            } else if (text[at] === ',' && depth === 0) {
                items.push(text.slice(start, at));
                start = at + 1;
            }
        }

        items.push(text.slice(start));
        return items;
    }

    private static matchingParen(text: string, open: number): number {
        let depth = 0;

        for (let at = open; at < text.length; at += 1) {
            if (text[at] === '(') {
                depth += 1;
            } else if (text[at] === ')' && --depth === 0) {
                return at;
            }
        }

        throw new Error(`unbalanced "(" in: ${text}`);
    }

    // Phase 1: the template lines the request's branches select, dedented, references untouched.
    private select(request: Coordinates): string[] {
        const lines: string[] = [];
        let buffer = '';
        let markup = false;
        let lineDepth = 0;
        // A line prints when any of its text was selected, not by the branch its newline sits in:
        // `доступно {if: …}{then: …}` ends inside a branch that may not be taken.
        let lineActive = false;
        const endLine = (): void => {
            // The space that separates text from the markup behind it (`доступно {if: …}`) prints nothing.
            if (lineActive && !(markup && buffer.trim() === '')) {
                lines.push(TraceEngine.dedent(markup ? buffer.trimEnd() : buffer, lineDepth));
            }

            buffer = '';
            markup = false;
            lineActive = false;
        };
        const emit = (text: string, active: boolean, depth: number, trimStart: boolean): void => {
            text.split('\n').forEach((piece, at) => {
                if (at > 0) {
                    endLine();
                    lineDepth = depth;
                }

                if (active) {
                    lineActive = true;
                    buffer += at === 0 && trimStart ? piece.replace(/^[ \t]+/, '') : piece;
                }
            });
        };
        const walk = (nodes: TemplateNode[], active: boolean, depth: number): void => {
            nodes.forEach((node, at) => {
                if (node.kind === 'text') {
                    emit(node.text, active, depth, at === 0 && depth > 0);
                    return;
                }

                markup = true;
                let chosen = false;

                for (const part of node.parts) {
                    if (part.kind === 'gap') {
                        emit(part.text, active, depth, false);
                        continue;
                    }

                    markup = true;
                    const take = active && !chosen && (part.condition === undefined || this.condition(part.condition, request));

                    if (take) {
                        chosen = true;
                    }

                    walk(part.body, take, depth + 1);
                    markup = true;
                }
            });
        };

        walk(this.template, true, 0);
        endLine();
        return lines;
    }

    private static dedent(line: string, depth: number): string {
        const strip = INDENT * depth;

        if (line.trim() === '') {
            return '';
        }

        if (!line.startsWith(' '.repeat(strip))) {
            throw new Error(`line inside ${depth} branch(es) is indented less than ${strip}: ${line}`);
        }

        return line.slice(strip);
    }

    // `a op b and c op d ...`; a missing value makes its comparison false.
    private condition(text: string, request: Coordinates): boolean {
        for (const clause of text.split(/\s+and\s+/)) {
            const match = /^(.*?)\s(>=|<=|=|>|<)\s(.*)$/.exec(clause.trim());

            if (!match) {
                throw new Error(`cannot read the condition "${clause}"`);
            }

            const left = this.operand(match[1]!.trim(), request);
            const right = this.operand(match[3]!.trim(), request);

            if (left === undefined || right === undefined) {
                return false;
            }

            if (!TraceEngine.compare(left, match[2]!, right)) {
                return false;
            }
        }

        return true;
    }

    private static compare(left: number, operator: string, right: number): boolean {
        if (operator === '>=') {
            return left >= right;
        } else if (operator === '<=') {
            return left <= right;
        } else if (operator === '=') {
            return left === right;
        } else if (operator === '>') {
            return left > right;
        } else if (operator === '<') {
            return left < right;
        } else {
            throw new Error(`unknown comparison "${operator}"`);
        }
    }

    private operand(text: string, request: Coordinates): number | undefined {
        if (/^-?\d+(\.\d+)?$/.test(text)) {
            return Number(text);
        }

        if (LETTERS[text]) {
            return request.get(LETTERS[text]!);
        }

        const reference = /^\$?([A-Za-z_][A-Za-z0-9_]*)((?:\([^()]*\))*)$/.exec(text);

        if (!reference) {
            throw new Error(`cannot read the operand "${text}"`);
        }

        const groups = [...reference[2]!.matchAll(/\(([^()]*)\)/g)].map((group) => group[1]!.trim());
        const value = this.value(reference[1]!, groups, request);
        return value === undefined ? undefined : Number(value);
    }

    // A variable's block key and the coordinates its arguments fix by number; a
    // scalar has qualifiers only.
    private split(name: string, groups: string[], request: Coordinates): {key: string; fixed: Coordinates} {
        const scalar = SCALAR_NAME.test(name);
        const qualifierGroups = scalar ? groups : groups.slice(0, -1);
        const fixed: Coordinates = new Map();
        const args = scalar ? [] : (groups.at(-1) ?? '').split(',').map((arg) => arg.trim());

        args.forEach((arg, position) => {
            const explicit = /^(\d+) from (\w+)$/.exec(arg);

            if (LETTERS[arg]) {
                return;
            } else if (explicit) {
                fixed.set(explicit[2]!, Number(explicit[1]));
            } else if (/^\d+$/.test(arg)) {
                fixed.set(this.legendOrder(name)[position]!, Number(arg));
            } else {
                throw new Error(`${name}: cannot read the argument "${arg}"`);
            }
        });

        let queue: number | undefined;
        const qualifiers = qualifierGroups.map((group) => {
            const literal = /^(\d+) from (\w+)$/.exec(group);
            const relative = /^(l0|n)(?:\s*([+-])\s*(\d+))?$/.exec(group);

            if (literal) {
                if (literal[2] === 'R') {
                    queue = Number(literal[1]);
                }

                return group;
            }

            if (!relative) {
                throw new Error(`${name}: cannot read the qualifier "(${group})"`);
            }

            const shift = relative[2] ? (relative[2] === '+' ? 1 : -1) * Number(relative[3]) : 0;

            if (relative[1] === 'l0') {
                queue = request.get('R')! + shift;
                return `${queue} from R`;
            }

            if (queue === undefined) {
                throw new Error(`${name}: "(n)" before a queue qualifier`);
            }

            return `${this.passes(queue) + shift} from n`;
        });

        return {key: name + qualifiers.map((qualifier) => `(${qualifier})`).join(''), fixed};
    }

    // The number of normalisation passes a queue ran: the highest `N` of the
    // `normalized_i_j_k_l(queue)(N from n)` blocks Step 6 wrote out.
    private passes(queue: number): number {
        let count = 1;

        while (this.index.blocks.has(this.index.normalizeKey(`normalized_i_j_k_l(${queue} from R)(${count + 1} from n)`))) {
            count += 1;
        }

        return count;
    }

    private value(name: string, groups: string[], request: Coordinates): string | undefined {
        const {key, fixed} = this.split(name, groups, request);
        const at = new Map(request);

        for (const [letter, coordinate] of fixed) {
            at.set(letter, coordinate);
        }

        if (SCALAR_NAME.test(name)) {
            const scalar = this.index.scalar(key);

            if (!scalar) {
                throw new Error(`${this.dataset}: scalar ${key} is not set`);
            }

            return scalar.value;
        }

        const block = this.index.resolve(key);

        if (!block) {
            throw new Error(`${this.dataset}: ${key} is not expanded`);
        }

        for (const signature of block.signatures) {
            if (signature.every((letter) => at.has(letter))) {
                const found = block.values.get(this.index.coordinateKey(at, signature));

                if (found !== undefined) {
                    return found;
                }
            }
        }

        return undefined;
    }

    // Phase 2: labels and values of a text without lists. With `strict` a missing
    // leaf makes the whole text undefined instead of printing «—».
    private substitute(text: string, at: Coordinates, strict: boolean): string | undefined {
        // Leaves first: an element that is dropped never asks for its labels, and
        // an axis may name a request the data does not hold.
        if (strict && this.substituteOnce(text, at, false).missing) {
            return undefined;
        }

        return this.substituteOnce(text, at, true).out;
    }

    private substituteOnce(text: string, at: Coordinates, labels: boolean): {out: string; missing: boolean} {
        let missing = false;
        const out = text.replace(REFERENCE, (match, dollar: string, name: string, groupText: string) => {
            const letter = this.axisByName.get(name);

            if (dollar && letter) {
                return labels ? this.label(letter, at, groupText.replace(/^\(|\)$/g, '').trim()) : match;
            }

            const isVariable = VARIABLE_NAME.test(name) && groupText;

            if (!isVariable && !SCALAR_NAME.test(name)) {
                return match;
            }

            const groups = [...groupText.matchAll(/\(([^()]*)\)/g)].map((group) => group[1]!.trim());
            const value = this.value(name, groups, at);

            if (value === undefined) {
                missing = true;
                return ABSENT_VALUE;
            }

            return SCALAR_NAME.test(name) ? value : TraceEngine.show(Number(value));
        });

        return {out, missing};
    }

    // `$Axis(x)` reads the request's coordinate, `$Axis(3)` names coordinate 3.
    private label(letter: string, at: Coordinates, arg = ''): string {
        const index = /^\d+$/.test(arg) ? Number(arg) : at.get(letter);
        const label = index === undefined ? undefined : this.axisByLetter.get(letter)?.labels.get(index);

        if (label === undefined) {
            throw new Error(`${this.dataset}: no label for ${letter}${index}`);
        }

        return label;
    }

    // A fraction always prints exactly 2 digits (77,60, 0,49); an integer prints none.
    private static show(value: number): string {
        const digits = Number.isInteger(value) ? 0 : 2;
        const text = value.toLocaleString('ru-RU', {minimumFractionDigits: digits, maximumFractionDigits: digits});
        return text.replace(/ /g, ' ');
    }
}

export {TraceEngine};
