// Parser of the trace-string template of `step-n-plus-1.lang`.
//
// The template is the text of the `## Трассировочная строка ...` section with
// its `# ` comment prefixes stripped. Besides plain text it carries branch
// markup, `{if: …}{then: …}{else if: …}{then: …}{else: …}`, which this parser
// turns into a tree; the text itself (references, lists) is read later by
// `TraceEngine`.

// The template as a tree: runs of text and conditionals. A conditional is a
// sequence of branches with the whitespace (`gap`) written between them.
type TemplateNode = {kind: 'text'; text: string} | {kind: 'if'; parts: TemplatePart[]};
type TemplatePart = {kind: 'gap'; text: string} | {kind: 'branch'; condition: string | undefined; body: TemplateNode[]};

type Token = {kind: 'if' | 'elseif'; condition: string} | {kind: 'then' | 'else' | 'close'} | {kind: 'text'; text: string};

// Header of the trace-string section in a step file and in its examples.
const TEMPLATE_HEADER = '## Трассировочная строка';

class TemplateParser {
    private position = 0;
    private readonly tokens: Token[];

    constructor(text: string) {
        // `{` and its keyword may sit on two lines; join them so markup never spans a line.
        this.tokens = TemplateParser.tokenize(text.replace(/\{[ \t]*\n[ \t]*(then:|else:|else if:)/g, '{$1'));
    }

    // The template text of a step file: the `# ` lines after the section header,
    // up to the first line that is not a comment. A bare `#` is a blank line.
    static extract(stepText: string, stepFile: string): string | undefined {
        const lines = stepText.split('\n');
        const start = lines.findIndex((line) => line.startsWith(TEMPLATE_HEADER));

        if (start < 0) {
            return undefined;
        }

        const body: string[] = [];

        for (const line of lines.slice(start + 1)) {
            if (line === '#') {
                body.push('');
            } else if (line.startsWith('# ')) {
                body.push(line.slice(2));
            } else if (line.startsWith('#')) {
                throw new Error(`${stepFile}: a template line must start with "# ": ${line}`);
            } else {
                break;
            }
        }

        return body.join('\n');
    }

    static tokenize(text: string): Token[] {
        const tokens: Token[] = [];
        let plain = '';
        const flush = (): void => {
            if (plain) {
                tokens.push({kind: 'text', text: plain});
            }

            plain = '';
        };

        for (let at = 0; at < text.length;) {
            const rest = text.slice(at);
            const condition = /^\{(if|else if):([^}]*)\}/.exec(rest);
            const keyword = /^\{(then|else):/.exec(rest);

            if (condition) {
                flush();
                tokens.push({kind: condition[1] === 'if' ? 'if' : 'elseif', condition: condition[2]!.trim()});
                at += condition[0].length;
            } else if (keyword) {
                flush();
                tokens.push({kind: keyword[1] as 'then' | 'else'});
                at += keyword[0].length;
            } else if (rest[0] === '}') {
                flush();
                tokens.push({kind: 'close'});
                at += 1;
            } else if (rest[0] === '{') {
                throw new Error(`stray "{" in the template: ${rest.slice(0, 40)}`);
            } else {
                plain += rest[0];
                at += 1;
            }
        }

        flush();
        return tokens;
    }

    parse(): TemplateNode[] {
        const nodes = this.sequence();

        if (this.position !== this.tokens.length) {
            throw new Error(`unexpected "}" at token ${this.position}`);
        }

        return nodes;
    }

    private peek(offset = 0): Token | undefined {
        return this.tokens[this.position + offset];
    }

    private sequence(): TemplateNode[] {
        const nodes: TemplateNode[] = [];

        for (let token = this.peek(); token && token.kind !== 'close'; token = this.peek()) {
            if (token.kind === 'text') {
                nodes.push(token);
                this.position += 1;
            } else if (token.kind === 'if') {
                nodes.push(this.conditional());
            } else {
                throw new Error(`"${token.kind}" without an "if" at token ${this.position}`);
            }
        }

        return nodes;
    }

    // IF gap? THEN body } (gap? ELSEIF gap? THEN body })* (gap? ELSE body })?
    private conditional(): TemplateNode {
        const parts: TemplatePart[] = [];
        let condition: string | undefined = (this.tokens[this.position++] as {condition: string}).condition;

        for (;;) {
            this.gap(parts);
            this.expect('then');
            parts.push({kind: 'branch', condition, body: this.branchBody()});
            const next = this.continuation();

            if (next === 'elseif') {
                this.gap(parts);
                condition = (this.tokens[this.position++] as {condition: string}).condition;
                continue;
            }

            if (next === 'else') {
                this.gap(parts);
                this.expect('else');
                parts.push({kind: 'branch', condition: undefined, body: this.branchBody()});
            }

            return {kind: 'if', parts};
        }
    }

    private branchBody(): TemplateNode[] {
        const body = this.sequence();
        this.expect('close');
        return body;
    }

    // Whether whitespace and then an `else` / `else if` follow the branch just closed.
    private continuation(): 'elseif' | 'else' | undefined {
        const first = this.peek();
        const blank = first?.kind === 'text' && /^\s*$/.test(first.text);
        const next = blank ? this.peek(1) : first;

        if (next?.kind === 'elseif') {
            return 'elseif';
        }

        if (next?.kind === 'else') {
            return 'else';
        }

        return undefined;
    }

    private gap(parts: TemplatePart[]): void {
        const token = this.peek();

        if (token?.kind === 'text' && /^\s*$/.test(token.text)) {
            parts.push({kind: 'gap', text: token.text});
            this.position += 1;
        }
    }

    private expect(kind: Token['kind']): void {
        const token = this.peek();

        if (token?.kind !== kind) {
            throw new Error(`expected "${kind}" at token ${this.position}, got ${JSON.stringify(token)}`);
        }

        this.position += 1;
    }
}

export {TEMPLATE_HEADER, TemplateParser};
export type {TemplateNode, TemplatePart};
