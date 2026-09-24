import { ref } from 'vue';

/**
 * Whether the primary pointer can hover. A touch screen cannot, so affordances that live behind
 * hovering (tooltips, a right button) need an on-screen stand-in there.
 */
export const deviceHasHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

/**
 * Whether the last thing to reach the page was a finger rather than a mouse.
 *
 * A touch screen synthesises hover: a tap sends `mouseover` and `mouseenter` to what was tapped and
 * never sends the `mouseout` that would match them, so anything that opens on hovering opens on a
 * tap and then stays open for good. Asking the device is not enough - a laptop with a touch screen
 * has a mouse as well, and the question is what is being used now, not what is plugged in.
 *
 * The pointer events of a tap arrive before the mouse events it synthesises, so an answer recorded
 * here is in place by the time anything reads it.
 */
export const pointerIsTouch = ref(false);

if (typeof window !== 'undefined') {
  const remember = (event: PointerEvent) => (pointerIsTouch.value = event.pointerType !== 'mouse');

  window.addEventListener('pointerover', remember, { capture: true, passive: true });
  window.addEventListener('pointerdown', remember, { capture: true, passive: true });
}
