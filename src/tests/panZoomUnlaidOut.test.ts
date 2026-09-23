import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import SvgPanZoom from '@/components/SVGPanZoom.vue';

/**
 * The frame a hidden tab is shown on: the box already has its size, the drawing inside it has not
 * been laid out yet. The correction for the difference between the two is then the whole width, and
 * divided by a scale left over from before it sent the view off to around 1e35, where the drawing is
 * not on screen at all and the reader has no way to bring it back.
 */
const showing = async (hostSize: { width: number; height: number }, drawnWidth: number) => {
  const wrapper = mount(SvgPanZoom, {
    slots: { default: '<svg class="drawing"></svg>' },
    attachTo: document.body,
  });

  // the component takes hold of the slotted svg a tick after it mounts
  await nextTick();

  const root = wrapper.element as HTMLElement;
  const svg = wrapper.find('svg.drawing').element as SVGSVGElement;

  Object.defineProperty(root, 'offsetWidth', { value: hostSize.width, configurable: true });
  Object.defineProperty(root, 'offsetHeight', { value: hostSize.height, configurable: true });
  svg.getBoundingClientRect = () => ({ width: drawnWidth, height: drawnWidth === 0 ? 0 : hostSize.height }) as DOMRect;

  return { wrapper, svg };
};

describe('a drawing that has not been laid out yet', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('is left alone rather than corrected against a size it does not have', async () => {
    const { wrapper, svg } = await showing({ width: 1500, height: 500 }, 0);

    wrapper.vm.onWindowResize();

    // nothing was measured, so nothing is published: no view at all beats a view of empty space
    expect(svg.getAttribute('viewBox')).toBeNull();
  });

  it('is measured once it is on screen', async () => {
    const { wrapper, svg } = await showing({ width: 1500, height: 500 }, 1500);

    wrapper.vm.onWindowResize();

    const box = svg.getAttribute('viewBox');

    expect(box).not.toBeNull();

    const [x, y, w, h] = box!.split(' ').map(Number);

    expect([x, y, w, h].every(Number.isFinite)).toBe(true);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
    // the corner belongs within reach of the size it goes with, not out at 1e35
    expect(Math.abs(x)).toBeLessThan(1e9 * w);
    expect(Math.abs(y)).toBeLessThan(1e9 * h);
  });
});
