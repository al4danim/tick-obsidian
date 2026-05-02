import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { Store, Task, todayString, splitProjectFromTitle } from "./store";

export const VIEW_TYPE_TODAY = "tick-today";

interface ViewSettings {
  groupByProject: boolean;
  enableSwipe: boolean;
}


export class TodayView extends ItemView {
  private store: Store;
  private rendering = false;
  private tasks: Task[] = [];
  private streak = 0;
  private getViewSettings: () => ViewSettings;

  // ── Edit / add state ────────────────────────────────────────────────
  // Which existing task (by id) is currently being edited in-place. null = no edit.
  private editingId: string | null = null;
  // Sticky add: when true, a phantom row sits at the top of the list. Saving
  // an entry re-opens a fresh phantom (TUI parity); empty Enter or Esc exits.
  private phantomActive = false;

  // ── Swipe state ─────────────────────────────────────────────────────
  // Which row currently has its Delete button revealed (only one at a time).
  private swipeRevealedId: string | null = null;

  constructor(leaf: WorkspaceLeaf, store: Store, getViewSettings: () => ViewSettings) {
    super(leaf);
    this.store = store;
    this.getViewSettings = getViewSettings;
  }

  getViewType(): string {
    return VIEW_TYPE_TODAY;
  }

  getDisplayText(): string {
    return "Tick Today";
  }

  getIcon(): string {
    return "check-square";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  async refresh(): Promise<void> {
    await this.render();
  }

  // Public hook for the "Add todo" command — opens sticky add at the top.
  startAdd(): void {
    this.phantomActive = true;
    void this.render();
  }

  private async render(): Promise<void> {
    if (this.rendering) return;
    this.rendering = true;

    const container = this.contentEl;
    container.empty();
    container.addClass("tick-today-container");

    try {
      const data = await this.store.load();
      this.tasks = data.tasks;
      this.streak = await this.store.computeStreak();
    } catch (e) {
      const errEl = container.createDiv({ cls: "tick-error" });
      errEl.createEl("p", { text: `Failed to load: ${(e as Error).message}` });
      errEl.createEl("p", {
        text: `Path: ${this.store.getPath()}`,
        cls: "tick-error-hint",
      });
      this.rendering = false;
      return;
    }

    const today = todayString();
    const pending = this.tasks.filter((t) => !t.done);
    const doneToday = this.tasks.filter((t) => t.done && t.doneDate === today);

    this.renderHeader(container, this.streak, doneToday.length, pending.length + doneToday.length);

    const body = container.createDiv({ cls: "tick-today-body" });

    // Empty state — only shown when no tasks AND no phantom add row.
    if (pending.length === 0 && doneToday.length === 0 && !this.phantomActive) {
      body.createEl("p", {
        text: "No tasks for today. Tap + to add one.",
        cls: "tick-empty-hint",
      });
      this.rendering = false;
      return;
    }

    // Phantom add row sits above all groups, never inside a group.
    if (this.phantomActive) {
      this.renderPhantomAdd(body);
    }

    if (pending.length > 0) {
      this.renderPending(body, pending);
    }

    if (doneToday.length > 0) {
      this.renderDoneToday(body, doneToday);
    }

    // Re-focus edit field after re-render. A fresh DOM means we lose focus
    // every render; this restores it so users can type continuously.
    this.refocusActiveInput();

    this.rendering = false;
  }

  private renderHeader(container: HTMLElement, streak: number, doneCount: number, totalCount: number): void {
    const header = container.createDiv({ cls: "tick-today-header" });

    header.createEl("span", { text: "Today", cls: "tick-today-title" });

    const addBtn = header.createEl("button", {
      cls: "tick-add-fab clickable-icon",
      attr: { "aria-label": "Add" },
      text: "+",
    });
    addBtn.addEventListener("click", () => {
      this.phantomActive = true;
      this.editingId = null;
      void this.render();
    });

    const streakChip = header.createSpan({ cls: "tick-streak-chip" });
    if (streak === 0) streakChip.addClass("is-cold");
    streakChip.createSpan({ text: "🔥" });
    streakChip.createSpan({ text: streak >= 30 ? "30+" : String(streak) });

    header.createEl("span", {
      cls: "tick-today-summary",
      text: `${doneCount}/${totalCount} done`,
    });
  }

  private renderPending(body: HTMLElement, pending: Task[]): void {
    const settings = this.getViewSettings();
    if (!settings.groupByProject) {
      for (const t of pending) this.renderRow(body, t);
      return;
    }

    const groups = new Map<string | null, Task[]>();
    const firstSeen = new Map<string | null, number>();
    pending.forEach((t, i) => {
      const key = t.project ?? null;
      if (!groups.has(key)) {
        groups.set(key, []);
        firstSeen.set(key, i);
      }
      groups.get(key)!.push(t);
    });

    const ordered = Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === null && b[0] !== null) return 1;
      if (b[0] === null && a[0] !== null) return -1;
      const sizeDiff = b[1].length - a[1].length;
      if (sizeDiff !== 0) return sizeDiff;
      return (firstSeen.get(a[0]) ?? 0) - (firstSeen.get(b[0]) ?? 0);
    });

    for (const [, tasks] of ordered) {
      const groupEl = body.createDiv({ cls: "tick-project-group" });
      for (const t of tasks) this.renderRow(groupEl, t);
    }
  }

  private renderDoneToday(body: HTMLElement, doneToday: Task[]): void {
    const divider = body.createDiv({ cls: "tick-divider" });
    divider.createSpan({ text: `Done today · ${doneToday.length}` });
    for (const t of doneToday) this.renderRow(body, t);
  }

  // ── Row rendering ───────────────────────────────────────────────────

  private renderRow(parent: HTMLElement, task: Task): void {
    const isEditing = this.editingId === task.id && task.id !== null;
    const cls =
      "tick-today-row" +
      (task.done ? " done" : "") +
      (isEditing ? " is-editing" : "") +
      (this.swipeRevealedId === task.id ? " is-swipe-revealed" : "");

    const row = parent.createDiv({
      cls,
      attr: task.id ? { "data-task-id": task.id } : {},
    });

    // Swipe-reveal Delete button — sits absolutely behind the foreground
    // wrapper. Only visible when row has .is-swipe-revealed.
    const swipeBtn = row.createEl("button", {
      cls: "tick-swipe-action",
      text: "Delete",
      attr: { "aria-label": "Delete task" },
    });
    swipeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void this.handleDelete(task);
    });

    // Foreground wrapper — what the user sees and what swipe transforms.
    const fg = row.createDiv({ cls: "tick-row-foreground" });

    // Native checkbox kept for a11y/keyboard.
    const checkbox = fg.createEl("input", { type: "checkbox", cls: "tick-checkbox" });
    checkbox.checked = task.done;
    checkbox.setAttribute("aria-label", `Toggle: ${task.title}`);

    const visual = fg.createSpan({
      cls: "tick-checkbox-visual",
      attr: { "aria-hidden": "true" },
    });
    visual.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.closeSwipeIfOpen();
      checkbox.click();
    });

    checkbox.addEventListener("change", async (ev) => {
      ev.stopPropagation();
      checkbox.disabled = true;
      try {
        if (task.id === null) {
          new Notice("Row has no ID yet; run tick-tui on Mac to assign one");
          checkbox.checked = task.done;
          return;
        }
        await this.store.toggleTask(task.id);
        await this.refresh();
      } catch (e) {
        new Notice(`Toggle failed: ${(e as Error).message}`, 5000);
        checkbox.checked = task.done;
      } finally {
        checkbox.disabled = false;
      }
    });

    const label = fg.createDiv({ cls: "tick-row-label" });

    if (isEditing) {
      this.renderEditFields(label, row, task);
    } else {
      this.renderViewFields(label, task);
    }

    if (this.getViewSettings().enableSwipe && task.id !== null && !isEditing) {
      this.attachSwipeHandlers(row, fg, task);
    }
  }

  private renderViewFields(label: HTMLElement, task: Task): void {
    const enterEdit = (ev: Event) => {
      ev.stopPropagation();
      if (this.swipeRevealedId !== null) {
        // First tap on a row while another is swiped open just closes the swipe.
        this.closeSwipeIfOpen();
        return;
      }
      if (task.id === null) {
        new Notice("Row has no ID yet; run tick-tui on Mac to assign one");
        return;
      }
      this.editingId = task.id;
      void this.render();
    };

    const titleSpan = label.createSpan({ text: task.title, cls: "tick-feature-title" });
    titleSpan.addEventListener("click", enterEdit);

    if (task.project) {
      const proj = label.createSpan({ cls: "tick-project" });
      proj.createSpan({ text: "@", cls: "tick-project-prefix" });
      proj.createSpan({ text: task.project, cls: "tick-project-name" });
      proj.addEventListener("click", enterEdit);
    }
  }

  // In-place edit: title and project become bare-looking inputs that visually
  // align with the original spans. Save on blur/Enter, cancel on Esc.
  private renderEditFields(label: HTMLElement, row: HTMLElement, task: Task): void {
    const initial = task.project ? `${task.title} @${task.project}` : task.title;
    const titleInput = label.createEl("input", {
      type: "text",
      cls: "tick-feature-title-input",
      value: initial,
    });
    titleInput.dataset.tickRole = "title-input";

    let committed = false;
    let cancelled = false;

    const commit = async () => {
      if (committed || cancelled) return;
      committed = true;
      const raw = titleInput.value.trim();
      const split = splitProjectFromTitle(raw);
      const newTitle = split.title;
      const newProject = split.project;
      if (!newTitle) {
        this.editingId = null;
        await this.refresh();
        return;
      }
      try {
        if (task.id !== null) {
          await this.store.editTask(task.id, { title: newTitle, project: newProject });
        }
        this.editingId = null;
        await this.refresh();
      } catch (e) {
        new Notice(`Save failed: ${(e as Error).message}`, 5000);
        committed = false;
      }
    };

    const cancel = () => {
      if (committed || cancelled) return;
      cancelled = true;
      this.editingId = null;
      void this.render();
    };

    titleInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        void commit();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        cancel();
      }
    });

    titleInput.addEventListener("blur", (ev) => {
      const next = ev.relatedTarget as HTMLElement | null;
      if (next && row.contains(next)) return;
      void commit();
    });
  }

  // ── Phantom add (sticky) ────────────────────────────────────────────

  private renderPhantomAdd(body: HTMLElement): void {
    const row = body.createDiv({ cls: "tick-today-row is-phantom is-editing" });
    const fg = row.createDiv({ cls: "tick-row-foreground" });

    // Disabled checkbox just for visual alignment with sibling rows.
    const cb = fg.createEl("input", { type: "checkbox", cls: "tick-checkbox" });
    cb.disabled = true;
    fg.createSpan({ cls: "tick-checkbox-visual", attr: { "aria-hidden": "true" } });

    const label = fg.createDiv({ cls: "tick-row-label" });

    const titleInput = label.createEl("input", {
      type: "text",
      cls: "tick-feature-title-input",
      attr: { placeholder: "New task... @project" },
    });
    titleInput.dataset.tickRole = "phantom-title";

    let committing = false;

    const commit = async () => {
      if (committing) return;
      const raw = titleInput.value.trim();
      if (!raw) {
        // Empty Enter / blur exits sticky add (TUI parity).
        this.phantomActive = false;
        await this.refresh();
        return;
      }
      committing = true;
      const split = splitProjectFromTitle(raw);
      try {
        await this.store.addTask({ title: split.title, project: split.project });
        this.phantomActive = true;
        await this.refresh();
      } catch (e) {
        new Notice(`Save failed: ${(e as Error).message}`, 5000);
        committing = false;
      }
    };

    const cancel = () => {
      this.phantomActive = false;
      void this.render();
    };

    titleInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        void commit();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        cancel();
      }
    });

    titleInput.addEventListener("blur", (ev) => {
      const next = ev.relatedTarget as HTMLElement | null;
      if (next && row.contains(next)) return;
      void commit();
    });
  }

  // After re-render the DOM is fresh; if we're in edit / phantom mode, restore
  // focus so users can type continuously.
  private refocusActiveInput(): void {
    if (this.editingId !== null) {
      const row = this.contentEl.querySelector(
        `[data-task-id="${cssEscape(this.editingId)}"]`
      );
      if (!row) return;
      const target = row.querySelector('[data-tick-role="title-input"]') as HTMLInputElement | null;
      if (target) {
        requestAnimationFrame(() => {
          target.focus();
          const end = target.value.length;
          target.setSelectionRange(end, end);
        });
      }
    } else if (this.phantomActive) {
      const target = this.contentEl.querySelector(
        '[data-tick-role="phantom-title"]'
      ) as HTMLInputElement | null;
      if (target) {
        requestAnimationFrame(() => target.focus());
      }
    }
  }

  // ── Swipe-to-reveal-Delete ──────────────────────────────────────────

  // Left swipe (dx < 0) only. Right swipe is intentionally ignored to avoid
  // colliding with Obsidian mobile's "close right panel" edge gesture. Past
  // threshold the row stays revealed showing a Delete button (iOS Mail style);
  // user taps Delete to actually delete (with 5s undo Notice).
  private attachSwipeHandlers(row: HTMLElement, fg: HTMLElement, task: Task): void {
    if (!("ontouchstart" in window)) return;

    const REVEAL_THRESHOLD = 40;  // px past which we'll commit to revealed state
    const DIRECTION_LOCK = 8;

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let trackingHorizontal: boolean | null = null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      currentX = 0;
      trackingHorizontal = null;
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
      if (dx > 0 && this.swipeRevealedId !== task.id) return;

      e.preventDefault();
      row.classList.add("is-swiping");

      // Limit visual: don't track beyond reveal width (-88px).
      currentX = Math.max(-88, Math.min(0, dx));
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
        if (this.swipeRevealedId !== null && this.swipeRevealedId !== task.id) {
          const other = this.contentEl.querySelector(
            `[data-task-id="${cssEscape(this.swipeRevealedId)}"]`
          );
          other?.classList.remove("is-swipe-revealed");
        }
        this.swipeRevealedId = task.id;
        row.classList.add("is-swipe-revealed");
      } else {
        // Snap back.
        this.swipeRevealedId = null;
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
      if (this.swipeRevealedId === task.id && !(ev.target as HTMLElement).closest(".tick-swipe-action")) {
        this.closeSwipeIfOpen();
      }
    });
  }

  private closeSwipeIfOpen(): void {
    if (this.swipeRevealedId === null) return;
    const row = this.contentEl.querySelector(
      `[data-task-id="${cssEscape(this.swipeRevealedId)}"]`
    );
    row?.classList.remove("is-swipe-revealed");
    this.swipeRevealedId = null;
  }

  // ── Delete with undo ────────────────────────────────────────────────

  private async handleDelete(task: Task): Promise<void> {
    if (task.id === null) return;
    let result: { line: string; rawIndex: number } | null = null;
    try {
      result = await this.store.deleteTask(task.id);
    } catch (e) {
      new Notice(`Delete failed: ${(e as Error).message}`, 5000);
      return;
    }
    if (!result) return;

    this.swipeRevealedId = null;
    await this.refresh();

    // 5s Undo Notice. Build a DocumentFragment so we can attach a click handler
    // to the Undo link inside Obsidian's standard Notice toast.
    const frag = document.createDocumentFragment();
    const span = document.createElement("span");
    span.textContent = `Deleted: ${truncateForNotice(task.title)} · `;
    frag.appendChild(span);
    const link = document.createElement("a");
    link.textContent = "Undo";
    link.style.cursor = "pointer";
    link.style.fontWeight = "600";
    link.style.color = "var(--text-on-accent, currentColor)";
    link.style.textDecoration = "underline";
    frag.appendChild(link);

    const notice = new Notice(frag, 5000);
    link.addEventListener("click", async () => {
      try {
        await this.store.restoreLine(result!.line, result!.rawIndex);
        await this.refresh();
        notice.hide();
      } catch (e) {
        new Notice(`Undo failed: ${(e as Error).message}`, 5000);
      }
    });
  }
}

// Best-effort polyfill for CSS.escape() — used when building selectors with
// task IDs (which are 8-char hex so usually safe, but legacy IDs may include
// other chars).
function cssEscape(value: string): string {
  if (typeof (window as { CSS?: { escape?: (v: string) => string } }).CSS?.escape === "function") {
    return (window as unknown as { CSS: { escape: (v: string) => string } }).CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

function truncateForNotice(s: string): string {
  return s.length > 40 ? s.slice(0, 37) + "…" : s;
}
