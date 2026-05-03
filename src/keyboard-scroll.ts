// iOS keyboard-avoidance helper.
//
// Obsidian's WKWebView does NOT shrink the layout viewport when the keyboard
// opens — only the visual viewport shrinks. So `scrollIntoView({ block: "end"
// })` aligns the input with the scrollport's visible bottom, which sits BEHIND
// the keyboard. We have to drive scrollTop ourselves using
// `window.visualViewport.height`.
//
// On focus we add `.tick-keyboard-open` (CSS bumps `padding-bottom` to 60vh so
// the container has enough scroll room past its natural last row to push any
// input above the keyboard) and then call `adjust()` from several signals —
// see comment at the trigger sites for why none of them is sufficient on its
// own.
//
// `adjust()` scrolls the container by the gap between the input's bottom and
// the visual viewport's bottom — i.e. it pushes the input up just enough to
// clear the keyboard, with 16px breathing room. It's idempotent: once the
// input is in position the next call computes overflow=0 and no-ops, so it's
// safe to fire from multiple triggers.
//
// Why we manage scrollTop ourselves instead of `scrollIntoView({ block: "end"
// })`: in Obsidian's iOS WKWebView the layout viewport doesn't shrink when the
// keyboard appears, so the scrollport's "end" sits behind the keyboard.
// `scrollIntoView({ block: "end" })` will dutifully park the input there —
// which is what we used to do, and which is why beta.17–23 all failed in
// slightly different ways. visualViewport is the only signal that actually
// reflects what the user can see.

// iOS keyboard animation is ~250–350ms, so by 400ms vv.height should reflect
// the keyboard. This is the guaranteed-to-fire baseline for our scroll adjust.
const KEYBOARD_SETTLE_FALLBACK_MS = 400;

// Pixels of visible space we want above the input top once it's pushed up,
// so the caret doesn't sit flush against the keyboard's top edge.
const KEYBOARD_BREATHING_ROOM_PX = 16;

// On blur we wait this long before stripping `.tick-keyboard-open`, so a
// focus jump from one input to another (Tab / tap-edit-next-row) doesn't
// briefly collapse the container's scroll room.
const BLUR_DEFER_MS = 100;

export function attachKeyboardScroll(container: HTMLElement, input: HTMLInputElement): void {
  const adjust = () => {
    if (document.activeElement !== input) return;
    const vv = window.visualViewport;
    const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const inputRect = input.getBoundingClientRect();
    const overflow = inputRect.bottom + KEYBOARD_BREATHING_ROOM_PX - visibleBottom;
    if (overflow > 0) {
      container.scrollTop += overflow;
    }
  };

  let vvHandler: (() => void) | null = null;
  let resizeObs: ResizeObserver | null = null;

  input.addEventListener("focus", () => {
    container.classList.add("tick-keyboard-open");

    // Multiple triggers because no single signal is reliable across all
    // WebView versions / Obsidian builds:
    //   - rAF: layout settled, but keyboard not up yet — usually a no-op
    //     but cheap insurance for the rare case iOS already auto-scrolled.
    //   - setTimeout(KEYBOARD_SETTLE_FALLBACK_MS): iOS keyboard animation is
    //     ~250–350ms, so by 400ms vv.height should reflect the keyboard.
    //     This is our guaranteed-to-fire baseline.
    //   - visualViewport.resize: best signal — fires on keyboard up,
    //     down, rotation, split-screen, accessory-bar toggling.
    //   - ResizeObserver on the container: belt-and-suspenders fallback
    //     for the (rare) case the layout viewport itself shrinks.
    requestAnimationFrame(adjust);
    setTimeout(adjust, KEYBOARD_SETTLE_FALLBACK_MS);

    if (window.visualViewport) {
      vvHandler = adjust;
      window.visualViewport.addEventListener("resize", vvHandler);
    }

    if (typeof ResizeObserver !== "undefined") {
      resizeObs = new ResizeObserver(adjust);
      resizeObs.observe(container);
    }
  });

  input.addEventListener("blur", () => {
    if (vvHandler && window.visualViewport) {
      window.visualViewport.removeEventListener("resize", vvHandler);
      vvHandler = null;
    }
    if (resizeObs) {
      resizeObs.disconnect();
      resizeObs = null;
    }
    setTimeout(() => {
      if (!container.contains(document.activeElement)) {
        container.classList.remove("tick-keyboard-open");
      }
    }, BLUR_DEFER_MS);
  });
}
