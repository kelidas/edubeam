export const formatScientificNumber = (n: number, digs = 4) => {
  if (n === 0) return new Number(0).toFixed(digs);

  if (Math.abs(n) > 1000 || Math.abs(n) < 0.01) return n.toExponential(digs);

  return n.toFixed(digs);
};

/**
 * Human-friendly number for coordinates and dimensions: no exponent in the everyday range,
 * trailing zeros trimmed (0.003 → "0.003", 0.1 → "0.1", 1234.5 → "1234.5").
 */
export const formatCompactNumber = (n: number, significant = 6) => {
  if (n === 0 || Math.abs(n) < 1e-12) return '0';
  if (Math.abs(n) >= 1e-4 && Math.abs(n) < 1e7) return parseFloat(n.toPrecision(significant)).toString();
  return n.toExponential(3);
};

const SUPERSCRIPTS: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};

const superscript = (exponent: number) =>
  String(exponent)
    .split('')
    .map((c) => SUPERSCRIPTS[c] ?? c)
    .join('');

/**
 * Engineering notation, written the way it is on paper: 1.53·10⁻⁶ rather than -0.000001529 or an
 * `e-6` suffix. The exponent is a multiple of three, so it reads as the unit prefix it stands for,
 * and the everyday range keeps a plain number. For an SVG label, where markup is not an option.
 *
 * @param format supplies the locale and the number of digits shown on the mantissa
 */
export const formatEngineeringNumber = (value: number, format: Intl.NumberFormat) => {
  if (!Number.isFinite(value)) return format.format(value);

  const exponent = value === 0 ? 0 : Math.floor(Math.log10(Math.abs(value)) / 3) * 3;
  if (exponent === 0) return format.format(value);

  return `${format.format(value / 10 ** exponent)}·10${superscript(exponent)}`;
};
