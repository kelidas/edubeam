import { describe, it, expect } from 'vitest';
import { formatEngineeringNumber } from '@/utils/formatScientificNumber';

const format = new Intl.NumberFormat('en', { maximumSignificantDigits: 3 });
const engineering = (v: number) => formatEngineeringNumber(v, format);

describe('engineering notation', () => {
  it('keeps the everyday range plain', () => {
    expect(engineering(0)).toBe('0');
    expect(engineering(12.3456)).toBe('12.3');
    expect(engineering(-999)).toBe('-999');
  });

  it('writes a small value as a power of ten, in steps of three', () => {
    expect(engineering(-0.000001529)).toBe('-1.53·10⁻⁶');
    expect(engineering(0.0034)).toBe('3.4·10⁻³');
    expect(engineering(0.12)).toBe('120·10⁻³');
  });

  it('writes a large value the same way', () => {
    expect(engineering(45678)).toBe('45.7·10³');
  });
});
