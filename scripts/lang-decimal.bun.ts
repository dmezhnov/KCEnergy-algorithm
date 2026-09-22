// Exact decimal arithmetic for the values of the `*.example_*.lang` files.
//
// The worked examples carry values of up to 20 significant digits (a share such
// as `0.819112627986348122` multiplied by a volume), which float64 cannot hold:
// every operation here is therefore a BigInt operation on a scaled integer, and
// a value keeps every digit it was written with.
//
// Division and multiplication can produce more fraction digits than the example
// files ever print; `truncated` implements the cut the files apply (see
// `DISPLAY_DIGITS` in the checker that uses it), always towards zero.

// A decimal literal as the example files spell one, with an optional sign.
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

class Decimal {
    static readonly ZERO = Decimal.of(0n, 0);

    private constructor(
        private readonly units: bigint,
        private readonly scale: number,
    ) {}

    // The value a literal spells, or `undefined` when the text is not a number.
    static parse(text: string): Decimal | undefined {
        if (!DECIMAL.test(text)) {
            return undefined;
        }

        const [whole, fraction = ''] = text.split('.');

        return Decimal.of(BigInt(whole + fraction), fraction.length);
    }

    // A value from its scaled integer representation.
    private static of(units: bigint, scale: number): Decimal {
        return new Decimal(units, scale);
    }

    // Ten to the given non-negative power, as a BigInt factor.
    private static power(exponent: number): bigint {
        return 10n ** BigInt(exponent);
    }

    plus(other: Decimal): Decimal {
        const scale = Math.max(this.scale, other.scale);

        return Decimal.of(this.at(scale) + other.at(scale), scale);
    }

    minus(other: Decimal): Decimal {
        const scale = Math.max(this.scale, other.scale);

        return Decimal.of(this.at(scale) - other.at(scale), scale);
    }

    times(other: Decimal): Decimal {
        return Decimal.of(this.units * other.units, this.scale + other.scale);
    }

    // The quotient, truncated towards zero at `digits` fraction digits, or
    // `undefined` for a division by zero — which the caller decides about, since
    // `safe_divide` and `"/"` answer it differently.
    dividedBy(other: Decimal, digits: number): Decimal | undefined {
        if (other.isZero()) {
            return undefined;
        }

        const shift = digits - this.scale + other.scale;
        const numerator = shift >= 0 ? this.units * Decimal.power(shift) : this.units;
        const denominator = shift >= 0 ? other.units : other.units * Decimal.power(-shift);

        return Decimal.of(numerator / denominator, digits);
    }

    // The value cut to `digits` fraction digits, towards zero. Shorter values are
    // returned unchanged, so a terminating result keeps its own spelling.
    truncated(digits: number): Decimal {
        if (this.scale <= digits) {
            return this;
        }

        return Decimal.of(this.units / Decimal.power(this.scale - digits), digits);
    }

    min(other: Decimal): Decimal {
        return this.compare(other) <= 0 ? this : other;
    }

    // Negative, zero or positive as this value is below, equal to or above the
    // other — the sign of the difference, not a difference itself.
    compare(other: Decimal): number {
        const scale = Math.max(this.scale, other.scale);
        const difference = this.at(scale) - other.at(scale);

        return difference === 0n ? 0 : Number(difference / (difference < 0n ? -difference : difference));
    }

    equals(other: Decimal): boolean {
        return this.compare(other) === 0;
    }

    isZero(): boolean {
        return this.units === 0n;
    }

    // The canonical spelling: no trailing fraction zeros, no `-0`, so that `65`,
    // `65.0` and `65.00` all print the same.
    toString(): string {
        if (this.scale === 0) {
            return this.units.toString();
        }

        const negative = this.units < 0n;
        const digits = (negative ? -this.units : this.units).toString().padStart(this.scale + 1, '0');
        const fraction = digits.slice(-this.scale).replace(/0+$/, '');
        const text = fraction ? `${digits.slice(0, -this.scale)}.${fraction}` : digits.slice(0, -this.scale);

        return negative ? `-${text}` : text;
    }

    // The units this value would have at the given (never smaller) scale.
    private at(scale: number): bigint {
        return this.units * Decimal.power(scale - this.scale);
    }
}

export {Decimal};
