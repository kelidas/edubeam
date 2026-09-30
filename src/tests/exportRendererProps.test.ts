import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { createExportRenderer } from '@/utils/exportImage';

/**
 * The image export draws through a viewer of its own, mounted off screen.
 *
 * A component reads its props as it sets itself up, and the viewer sets watchers on them there -
 * `watch(props.solver, …)` among them. Mounted before the props are in, that watcher is handed
 * `undefined` and watches nothing for the rest of its life: the off-screen drawing would then never
 * notice a model that changed under it, and Vue says as much twice over on every export.
 */
describe('the off-screen viewer of the image export', () => {
  it('has its props before it is mounted', async () => {
    const seen: Record<string, unknown>[] = [];

    const stub = defineComponent({
      props: { solver: { type: Object, default: undefined } },
      setup(props, { expose }) {
        seen.push({ ...props });

        // what the renderer drives it by; a drawing of nothing is enough for the order of events
        expose({
          fitContent: async () => ({ x: 0, y: 0, w: 1, h: 1 }),
          setView: () => {},
          update: () => {},
        });

        return () => h('svg');
      },
    });

    await createExportRenderer(stub).update({ solver: { model: 'a solver' } }, 100, 100);

    expect(seen).toHaveLength(1);
    expect(seen[0].solver).toEqual({ model: 'a solver' });
  });
});
