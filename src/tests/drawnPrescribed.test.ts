import { describe, it, expect } from 'vitest';
import { drawnPrescribed } from '@/utils/drawnPrescribed';

const drawn = (loads: { target: string; active?: boolean }[]) => drawnPrescribed(loads).map((d) => d.index);

describe('which prescribed displacements are drawn', () => {
  it('draws one alone on its node whether or not it is on', () => {
    expect(drawn([{ target: 'A', active: false }, { target: 'B' }])).toEqual([0, 1]);
  });

  it('draws only the switched-on ones where a node has several', () => {
    expect(drawn([{ target: 'A', active: false }, { target: 'A', active: true }, { target: 'B' }])).toEqual([1, 2]);
  });

  it('keeps the first of several on a node when none is on, so the node is not left bare', () => {
    expect(
      drawn([
        { target: 'A', active: false },
        { target: 'A', active: false },
      ])
    ).toEqual([0]);
  });
});
