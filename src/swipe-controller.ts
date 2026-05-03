// SwipeController — manages the left-swipe-to-reveal-Delete gesture for task
// rows. Extracted from TickView so the gesture logic lives in one place and
// TickView stays focused on rendering.

export class SwipeController {
  // Which row currently has its Delete button revealed (only one at a time).
  private revealedId: string | null = null;

  constructor(private contentEl: HTMLElement) {}

  // Wire up touch handlers for a single row. Call once per rendered row.
  // `row` is the outer `.tick-today-row` element; `fg` is the
  // `.tick-row-foreground` inside it; `taskId` is the task's string ID.
  //
  // Left swipe (dx < 0) only. Right swipe is intentionally ignored to avoid
  // colliding with Obsidian mobile's "close right panel" edge gesture. Past
  // threshold the row stays revealed showing a Delete button (iOS Mail style);
  // user taps Delete to actually delete (with 5s undo Notice).
  attach(row: HTMLElement, fg: HTMLElement, taskId: string): void {
    if (!("ontouchstart" in window)) return;

    const REVEAL_THRESHOLD = 40;  // px past which we'll commit to revealed state
    const DIRECTION_LOCK = 8;

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let trackingHorizontal: boolean | null = null;
    // Reveal width — single source of truth lives in CSS as `--tick-swipe-px`
    // on `.tick-today-row` (88px desktop / 80px mobile). Read once per gesture
    // so handheld orientation flips between gestures pick up the new value
    // without polling on every touchmove.
    let revealPx = 88;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      currentX = 0;
      trackingHorizontal = null;
      const cssPx = parseFloat(
        getComputedStyle(row).getPropertyValue("--tick-swipe-px"),
      );
      if (Number.isFinite(cssPx) && cssPx > 0) revealPx = cssPx;
    };

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      if (trackingHorizontal === null) {
        if (Math.abs(dx) < DIRECTION_LOCK && Math.abs(dy) < DIRECTION_LOCK) return;
        trackingHorizontal = Math.abs(dx) > Math.abs(dy);
      }

      if (!trackingHorizontal) return;

      // RIGHT-SWIPE GUARD: if user is dragging right, ignore entirely. This
      // lets Obsidian's edge gesture (close panel) work without our row
      // stealing the touch.
      if (dx > 0 && this.revealedId !== taskId) return;

      e.preventDefault();
      row.classList.add("is-swiping");

      // Clamp to the same width CSS will snap to, so finger position and
      // resting position never disagree (no last-pixel rebound on release).
      currentX = Math.max(-revealPx, Math.min(0, dx));
      fg.style.transform = `translateX(${currentX}px)`;
    };

    const onEnd = () => {
      if (!trackingHorizontal) {
        row.classList.remove("is-swiping");
        fg.style.transform = "";
        return;
      }

      row.classList.remove("is-swiping");
      fg.style.transform = ""; // hand back to CSS class-driven transform

      if (currentX < -REVEAL_THRESHOLD) {
        // Commit reveal. Close any other revealed row first.
        if (this.revealedId !== null && this.revealedId !== taskId) {
          const other = this.contentEl.querySelector(
            `[data-task-id="${CSS.escape(this.revealedId)}"]`
          );
          other?.classList.remove("is-swipe-revealed");
        }
        this.revealedId = taskId;
        row.classList.add("is-swipe-revealed");
      } else {
        // Snap back.
        this.revealedId = null;
        row.classList.remove("is-swipe-revealed");
      }
    };

    row.addEventListener("touchstart", onStart, { passive: true });
    row.addEventListener("touchmove", onMove, { passive: false });
    row.addEventListener("touchend", onEnd);
    row.addEventListener("touchcancel", onEnd);

    // Tapping anywhere else on the document closes a revealed swipe.
    // We hook this once per row, but it only fires while this row is the
    // revealed one (guarded by the check inside).
    row.addEventListener("click", (ev) => {
      // The Delete button has its own click handler with stopPropagation.
      if (this.revealedId === taskId && !(ev.target as HTMLElement).closest(".tick-swipe-action")) {
        this.closeIfOpen();
      }
    });
  }

  closeIfOpen(): void {
    if (this.revealedId === null) return;
    const row = this.contentEl.querySelector(
      `[data-task-id="${CSS.escape(this.revealedId)}"]`
    );
    row?.classList.remove("is-swipe-revealed");
    this.revealedId = null;
  }

  // Returns true if the given taskId is the currently revealed row.
  // Used by row rendering to conditionally add `.is-swipe-revealed`.
  isRevealed(taskId: string | null): boolean {
    return taskId !== null && this.revealedId === taskId;
  }

  // Returns true if any row is currently revealed.
  // Used by enterEdit to close swipe before entering edit mode.
  isAnyRevealed(): boolean {
    return this.revealedId !== null;
  }
}
