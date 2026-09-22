import path from 'node:path';

// Shared reader of one example data set (`*.example_N.lang`): its axis
// enumerations and every expanded variable it writes down. Both the trace-string
// generator and the leaf checker index the same files, so the DSL is parsed in
// one place rather than once per tool.

// One coordinate tuple: axis letter (`I`, `J`, `K`, `P`, `R`, `Z`, ...) to the
// 1-based index along that axis.
type Coordinates = Map<string, number>;

// An axis enumeration from `initial_data.example_N.lang`: its letter and the
// display name of each coordinate, as the trace strings print it.
type Axis = {
    name: string;
    letter: string;
    labels: Map<number, string>;
};

// One leaf line of an expanded variable. `total` is the number the line states;
// `stages` are the forms it shows the arithmetic in before that total — a leaf
// may show two, first with the name of a constant and then with its value
// (`1200 * OVERALL_REQUEST_CAPACITY_COEFFICIENT = 1200 * 1.2 = 1440`) —
// `expression` is the first of them (empty when the line states a bare value),
// and `summands` splits that arithmetic on `+` for the lines produced by a
// summation.
type Leaf = {
    coordinates: Coordinates;
    total: string;
    stages: string[];
    expression: string;
    summands: string[];
    line: number;
    text: string;
};

// One scalar the example files fix: `RAIL_ROAD_MIN_TONNAGE of number = 65`, or
// one that shows where its value comes from — `MIN_FCA_TONNAGE(1 from n) =
// RAIL_ROAD_MIN_TONNAGE = 65`. The intermediate name is an alias of the same
// number and is the one the leaves using it print, so `names` keeps the declared
// name first and every alias after it.
type Scalar = {
    names: string[];
    value: string;
    file: string;
    line: number;
};

// One expanded variable of an example file. `signatures` lists the distinct axis
// letter sets its leaves use — normally one, but an `assign_matrix` result can
// mix shapes — `values` maps a coordinate key to the leaf total, and `leaves`
// keeps every leaf in file order for the tools that report on lines.
type Block = {
    key: string;
    name: string;
    expression: string;
    signatures: string[][];
    values: Map<string, string>;
    leaves: Leaf[];
    file: string;
    line: number;
};

// The index letter each axis name carries, from the `# i for I from index`
// legend at the end of `matrix_types.lang`.
const AXIS_LETTERS: ReadonlyMap<string, string> = new Map([
    ['Product', 'I'],
    ['Product_category', 'I0'],
    ['Refinery', 'J'],
    ['Terminal', 'X'],
    ['Region', 'K'],
    ['District', 'K0'],
    ['Market_participant', 'P'],
    ['Month_and_year', 'Y'],
    ['Queue', 'R'],
    ['Ship_terms', 'C'],
    ['Request', 'Z'],
]);

// Header of an axis enumeration, e.g. `Refinery = ( # J`.
const AXIS_HEADER = /^([A-Za-z_][A-Za-z0-9_]*) = \(\s*#\s*([A-Za-z][A-Za-z0-9]*)\s*$/;

// One coordinate of an axis enumeration, e.g. `PKOP, # ПКОП - 1 from J`.
const AXIS_ITEM = /^\s+([^\s,#]+)\s*,?\s*#.*?(\d+)\s+from\s+([A-Za-z][A-Za-z0-9]*)\s*$/;

// A leaf line of an expanded variable, e.g. `(1 from I, 4 from K) = 120,`.
const LEAF_LINE = /^\s+\(([^()]*)\)\s*=\s*(.*)$/;

// One coordinate inside a tuple, e.g. `12 from P`.
const COORDINATE_ITEM = /(\d+)\s+from\s+([A-Za-z][A-Za-z0-9]*)/g;

// A bare variable reference, optionally qualified — the right-hand side of an
// alias definition such as `x_require_correct = x`. A qualifier holds one index
// (`(1 from R)`, `(last_n)`), never a list: the comma and the quote are what
// separate a reference from a call such as
// `for_each_pair(share, "*", moving_average)`, which is not an alias of
// anything.
const ALIAS = /^[A-Za-z_][A-Za-z0-9_]*(?:\([^(),"]*\))*$/;

// A decimal literal, the whole of a scalar definition's last stage.
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

// The type a declaration states, e.g. the ` of number` of
// `RAIL_ROAD_MIN_TONNAGE of number = 65`.
const DECLARED_TYPE = /\s+of\s+\S+$/;

// How many alias definitions `resolve` follows before giving up.
const ALIAS_HOPS = 8;

// One parenthesised qualifier group, and the index it fixes: the example files
// spell the same qualifier both as `(1 from n)` and, where the axis is obvious
// from the definition, as the bare `(1)`.
const QUALIFIER_GROUP = /^(\d+)(?:\s+from\s+[A-Za-z][A-Za-z0-9]*)?$/;

class ExampleIndex {
    readonly axesByName = new Map<string, Axis>();
    readonly blocks = new Map<string, Block>();
    readonly blockList: Block[] = [];
    readonly scalars = new Map<string, Scalar>();
    readonly diagnostics: string[] = [];

    // Blocks by name and qualifier indices only, for references that spell a
    // qualifier without its axis. A name whose indices two blocks share maps to
    // `undefined`, so that an ambiguous reference resolves to nothing.
    private readonly blocksByIndices = new Map<string, Block | undefined>();

    // Read one data set: every `*.example_N.lang` file of the project root.
    static async load(root: string, suffix: string): Promise<ExampleIndex> {
        const index = new ExampleIndex();

        for (const file of [...new Bun.Glob(`*.${suffix}.lang`).scanSync(root)].sort()) {
            const text = await Bun.file(path.join(root, file)).text();
            index.parseAxes(text);
            index.parseBlocks(text, file);
        }

        return index;
    }

    // The index letter of an axis name, or `undefined` for an unknown axis.
    static letterOf(axisName: string): string | undefined {
        return AXIS_LETTERS.get(axisName);
    }

    // Split the arguments of a call, keeping a nested call in one piece.
    static splitArguments(text: string): string[] {
        const args: string[] = [];
        let depth = 0;
        let current = '';

        for (const character of text) {
            if (character === ',' && depth === 0) {
                args.push(current.trim());
                current = '';
                continue;
            }

            depth += character === '(' ? 1 : character === ')' ? -1 : 0;
            current += character;
        }

        return [...args, current.trim()];
    }

    // The block a reference names, following alias definitions (`a = b`) until
    // one of them is actually expanded.
    resolve(reference: string): Block | undefined {
        let block = this.lookup(reference);

        for (let hops = 0; block && !block.leaves.length && ALIAS.test(block.expression) && hops < ALIAS_HOPS; hops += 1) {
            block = this.lookup(block.expression);
        }

        return block;
    }

    // One reference, matched against the definitions as written and then — for
    // `normalized_i_j_k_l(2 from R)(1)`, whose definition names the axis of its
    // second group — against their qualifier indices alone.
    private lookup(reference: string): Block | undefined {
        return this.blocks.get(this.normalizeKey(reference)) ?? this.blocksByIndices.get(this.indexKey(reference));
    }

    // A reference reduced to its name and the indices of its qualifiers, with a
    // group that is not a plain index kept verbatim so it cannot collide.
    private indexKey(reference: string): string {
        const normalized = this.normalizeKey(reference);
        const opening = normalized.indexOf('(');

        if (opening < 0) {
            return normalized;
        }

        const groups = [...normalized.slice(opening).matchAll(/\(([^()]*)\)/g)]
            .map((group) => QUALIFIER_GROUP.exec(group[1])?.[1] ?? group[1]);

        return `${normalized.slice(0, opening)}(${groups.join(')(')})`;
    }

    // The scalar a reference names, for the primitives whose parameter is a
    // number rather than a matrix.
    scalar(reference: string): Scalar | undefined {
        return this.scalars.get(this.normalizeKey(reference));
    }

    // The coordinate a name stands for, as `filter_by_coordinate(..., First,
    // FCA)` and `replace_coord(..., 1 from R, Second)` spell one: either the
    // display name of a coordinate (`First` — `1 from R`) or the index and its
    // axis directly. A name two axes both carry fixes nothing and resolves to
    // nothing.
    // Every axis that carries a label, for a caller that has to tell an unknown
    // name apart from one two axes both answer to.
    labels(text: string): {letter: string; index: number}[] {
        return [...this.axesByName.values()]
            .flatMap((axis) => [...axis.labels]
                .filter(([, label]) => label === text.trim())
                .map(([index]) => ({letter: axis.letter, index})));
    }

    coordinate(text: string, carried?: string[]): {letter: string; index: number} | undefined {
        const written = [...text.trim().matchAll(COORDINATE_ITEM)];

        if (written.length === 1) {
            return {letter: written[0][2], index: Number(written[0][1])};
        }

        const matches = [...this.axesByName.values()]
            .flatMap((axis) => [...axis.labels]
                .filter(([, label]) => label === text.trim())
                .map(([index]) => ({letter: axis.letter, index})));

        // `AI_92` labels both `Product` and `Product_category`; a caller that
        // knows which axes its matrix carries resolves the name against those.
        const narrowed = carried ? matches.filter((match) => carried.includes(match.letter)) : matches;

        return narrowed.length === 1 ? narrowed[0] : undefined;
    }

    // Parse a coordinate tuple such as `1 from I, 4 from K, 12 from P`.
    parseCoordinates(text: string): Coordinates {
        const coordinates: Coordinates = new Map();

        for (const item of text.matchAll(COORDINATE_ITEM)) {
            coordinates.set(item[2], Number(item[1]));
        }

        return coordinates;
    }

    // The lookup key of one leaf: its coordinates along the given axes only.
    coordinateKey(coordinates: Coordinates, signature: string[]): string {
        return signature.map((letter) => `${letter}=${coordinates.get(letter)}`).join(';');
    }

    // The inverse of `coordinateKey`, used to read a coordinate set back.
    coordinatesFromKey(key: string): Coordinates {
        return new Map(key.split(';').map((part) => {
            const [letter, index] = part.split('=');
            return [letter, Number(index)] as const;
        }));
    }

    // Collapse the index padding the example files use (`12 from P`, `1  from P`)
    // so that a reference and its definition produce the same key.
    normalizeKey(text: string): string {
        return text.replace(/\s+/g, ' ').replace(/\(\s*/g, '(').replace(/\s*\)/g, ')');
    }

    // Read the axis enumerations — `Refinery = ( # J` and its coordinate lines.
    private parseAxes(text: string): void {
        const lines = text.split('\n');

        for (let index = 0; index < lines.length; index += 1) {
            const header = AXIS_HEADER.exec(lines[index]);

            if (!header) {
                continue;
            }

            const axis: Axis = {name: header[1], letter: header[2], labels: new Map()};

            for (index += 1; index < lines.length && !lines[index].startsWith(')'); index += 1) {
                const item = AXIS_ITEM.exec(lines[index]);

                if (item && item[3] === axis.letter) {
                    axis.labels.set(Number(item[2]), item[1]);
                }
            }

            this.axesByName.set(axis.name, axis);
        }
    }

    // Read every top-level expanded variable of one example file. A definition
    // starts in column 0 and its body runs to the line that closes its braces.
    private parseBlocks(text: string, file: string): void {
        const lines = text.split('\n');

        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];

            if (!line || line.startsWith('#') || /^\s/.test(line) || !line.includes(' = ')) {
                continue;
            }

            const head = line.slice(0, line.indexOf(' = ')).trim();
            const block: Block = {
                key: this.normalizeKey(head),
                name: head,
                expression: this.definingExpression(line),
                signatures: [],
                values: new Map(),
                leaves: [],
                file,
                line: index + 1,
            };

            let depth = this.braceBalance(line);

            if (depth === 0) {
                this.collectScalar(head, block.expression, file, index + 1);
            }

            for (index += 1; depth > 0 && index < lines.length; index += 1) {
                this.collectLeaf(lines[index], index + 1, block);
                depth += this.braceBalance(lines[index]);
            }

            index -= 1;
            this.addBlock(block);
        }
    }

    // The expression a definition line applies, with the trailing ` = {` (or
    // ` = {}`) that opens the expanded body stripped off.
    private definingExpression(line: string): string {
        const rest = line.slice(line.indexOf(' = ') + 3).trim();

        return rest.replace(/=\s*\{\}?\s*$/, '').replace(/\{\}?\s*$/, '').trim();
    }

    // Record one scalar definition — a top-level line that opens no body and
    // ends in a number. A definition that ends in anything else (an axis
    // enumeration, a matrix alias) fixes no value and is passed over.
    private collectScalar(head: string, expression: string, file: string, line: number): void {
        const stages = expression.split(/\s+#/)[0].split(/\s+=\s+/).map((stage) => stage.trim());
        const value = stages[stages.length - 1];

        if (!DECIMAL.test(value)) {
            return;
        }

        const name = head.replace(DECLARED_TYPE, '').trim();
        const scalar: Scalar = {
            names: [name, ...stages.slice(0, -1).filter((stage) => ALIAS.test(stage))],
            value,
            file,
            line,
        };
        const existing = this.scalars.get(this.normalizeKey(name));

        if (existing && existing.value !== value) {
            this.diagnostics.push(`${file}:${line}: ${name} is also fixed to ${existing.value} in ${existing.file}`);
            return;
        }

        this.scalars.set(this.normalizeKey(name), scalar);
    }

    // Record one leaf line of an expanded variable, ignoring the group openers
    // (`(1 from I) = {`) that only introduce a nesting level.
    private collectLeaf(line: string, number: number, block: Block): void {
        const match = LEAF_LINE.exec(line);

        if (!match || match[2].trimEnd().endsWith('{')) {
            return;
        }

        const coordinates = this.parseCoordinates(match[1]);
        const signature = [...coordinates.keys()].sort();
        const body = match[2].split(/\s+#/)[0].trim().replace(/,$/, '').trim();
        const parts = body.split(/\s+=\s+/).map((part) => part.trim());
        const total = parts[parts.length - 1];

        if (!block.signatures.some((known) => known.join() === signature.join())) {
            block.signatures.push(signature);
        }

        const stages = parts.slice(0, -1);
        const expression = stages[0] ?? '';

        block.values.set(this.coordinateKey(coordinates, signature), total);
        block.leaves.push({
            coordinates,
            total,
            stages,
            expression,
            summands: expression ? expression.split(/\s*\+\s*/).map((part) => part.trim()) : [],
            line: number,
            text: line,
        });
    }

    // Store a block, reporting the ambiguity if two example files expand the
    // same name and qualifiers — a lookup could not then pick between them.
    private addBlock(block: Block): void {
        const existing = this.blocks.get(block.key);

        this.blockList.push(block);
        this.indexByIndices(block);

        if (existing) {
            this.diagnostics.push(
                `${block.file}: ${block.key} is also expanded in ${existing.file}; values are ambiguous`,
            );
            return;
        }

        this.blocks.set(block.key, block);
    }

    // Add a block to the by-indices index, blanking the entry when a second
    // block claims the same indices — an ambiguous reference must not resolve.
    private indexByIndices(block: Block): void {
        const key = this.indexKey(block.name);

        this.blocksByIndices.set(key, this.blocksByIndices.has(key) ? undefined : block);
    }

    // The net number of braces a line opens.
    private braceBalance(line: string): number {
        const code = line.split(/\s+#/)[0];

        return (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;
    }
}

export {ExampleIndex};
export type {Axis, Block, Coordinates, Leaf, Scalar};
