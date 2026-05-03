import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { Store, Task, todayString, yesterdayString, splitProjectFromTitle, computeStreak, groupPendingByProject } from "./store";
import { attachKeyboardScroll } from "./keyboard-scroll";
import { SwipeController } from "./swipe-controller";

// String value is intentionally "tick-today" (not "tick") for back-compat with
// saved leaf state from before the rename. Changing it would orphan existing
// user layouts.
export const VIEW_TYPE_TICK = "tick-today";

interface ViewSettings {
  groupByProject: boolean;
  enableSwipe: boolean;
}

// Wire keydown (Enter → commit, Escape → cancel) and blur (intra-row focus
// changes are ignored) to an input. The caller's onCommit/onCancel handle
// all business logic; this helper is purely event plumbing.
//
// Blur ignores focus movements that stay inside `row` (e.g. moving from
// title input to a sibling button) so we don't prematurely commit when the
// user is just clicking another field in the same row.
//
// `cancelled` flag: Escape → onCancel re-renders → DOM is destroyed → the
// dying input fires a final blur. Without this guard that blur would be
// routed to onCommit and accidentally save the half-edited value. The
// caller's onCommit guards against double-commits via its own `committed`
// flag, but it can't tell "real blur" from "post-cancel blur" without help
// from this helper.
function wireInputCommit(
  input: HTMLInputElement,
  row: HTMLElement,
  opts: {
    onCommit: () => void | Promise<void>;
    onCancel: () => void;
  }
): void {
  let cancelled = false;

  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void opts.onCommit();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      if (cancelled) return;
      cancelled = true;
      opts.onCancel();
    }
  });

  input.addEventListener("blur", (ev) => {
    if (cancelled) return;
    const next = ev.relatedTarget as HTMLElement | null;
    if (next && row.contains(next)) return;
    void opts.onCommit();
  });
}

export class TickView extends ItemView {
  private store: Store;
  private rendering = false;
  private tasks: Task[] = [];
  private streak = 0;
  private getViewSettings: () => ViewSettings;
  private swipe: SwipeController;

  // ── Edit / add state ────────────────────────────────────────────────
  // Which existing task (by id) is currently being edited in-place. null = no edit.
  private editingId: string | null = null;
  // Sticky add: when true, a phantom row sits at the top of the list. Saving
  // an entry re-opens a fresh phantom (TUI parity); empty Enter or Esc exits.
  private phantomActive = false;

  // Track focus on edit / phantom inputs so we can keep them above the
  // iOS keyboard. The hard part is that Obsidian's WKWebView does NOT
  // shrink the layout viewport when the keyboard opens — only the visual
  // viewport shrinks. So `scrollIntoView({ block: "end" })` aligns the
  // input with the scrollport's visible bottom, which sits BEHIND the
  // keyboard. We have to drive scrollTop ourselves using
  // `window.visualViewport.height`.

  constructor(leaf: WorkspaceLeaf, store: Store, getViewSettings: () => ViewSettings) {
    super(leaf);
    this.store = store;
    this.getViewSettings = getViewSettings;
    this.swipe = new SwipeController(this.contentEl);
  }

  getViewType(): string {
    return VIEW_TYPE_TICK;
  }

  getDisplayText(): string {
    return "Tick";
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

  private async render(): Promise<void> {
    if (this.rendering) return;
    this.rendering = true;

    const container = this.contentEl;
    container.empty();
    container.addClass("tick-today-container");

    try {
      const data = await this.store.load();
      this.tasks = data.tasks;
      this.streak = computeStreak(data.tasks);
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
    const yesterday = yesterdayString();
    const pending = this.tasks.filter((t) => !t.done);
    const doneToday = this.tasks.filter((t) => t.done && t.doneDate === today);
    const doneYesterday = this.tasks.filter((t) => t.done && t.doneDate === yesterday);

    this.renderHeader(container, this.streak, doneToday.length, pending.length + doneToday.length);

    const body = container.createDiv({ cls: "tick-today-body" });

    // Empty state — only shown when no tasks AND no phantom add row.
    if (
      pending.length === 0 &&
      doneToday.length === 0 &&
      doneYesterday.length === 0 &&
      !this.phantomActive
    ) {
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

    if (doneToday.length > 0 || doneYesterday.length > 0) {
      this.renderDoneSection(body, doneToday, doneYesterday);
    }

    // Re-focus edit field after re-render. A fresh DOM means we lose focus
    // every render; this restores it so users can type continuously.
    this.refocusActiveInput();

    this.rendering = false;
  }

  private renderHeader(container: HTMLElement, streak: number, doneCount: number, totalCount: number): void {
    const header = container.createDiv({ cls: "tick-today-header" });

    header.createEl("span", { text: "Tick", cls: "tick-today-title" });

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

    for (const group of groupPendingByProject(pending)) {
      const groupEl = body.createDiv({ cls: "tick-project-group" });
      for (const t of group) this.renderRow(groupEl, t);
    }
  }

  // Combined "Done" section: today's done rows first, then yesterday's done
  // rows directly underneath. Yesterday rows carry a dim "-1d" marker on the
  // right so users can tell them apart at a glance — same layout as tick-tui
  // (one shared separator, append later-day rows below today's). The divider
  // count reflects today only; yesterday's rows are extra context, not part
  // of "today's progress".
  private renderDoneSection(
    body: HTMLElement,
    doneToday: Task[],
    doneYesterday: Task[],
  ): void {
    const divider = body.createDiv({ cls: "tick-divider" });
    if (doneToday.length > 0) {
      divider.createSpan({ text: `Done today · ${doneToday.length}` });
    } else {
      // Only yesterday rows exist (e.g. nothing done today yet) — change the
      // label so the count isn't a misleading "0".
      divider.createSpan({ text: `Done -1d · ${doneYesterday.length}` });
    }
    for (const t of doneToday) this.renderRow(body, t, 0);
    for (const t of doneYesterday) this.renderRow(body, t, 1);
  }

  // ── Row rendering ───────────────────────────────────────────────────

  private renderRow(parent: HTMLElement, task: Task, daysAgo: number = 0): void {
    const isEditing = this.editingId === task.id && task.id !== null;
    const cls =
      "tick-today-row" +
      (task.done ? " done" : "") +
      (isEditing ? " is-editing" : "") +
      (this.swipe.isRevealed(task.id) ? " is-swipe-revealed" : "");

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
      this.swipe.closeIfOpen();
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
      this.renderViewFields(label, task, daysAgo);
    }

    if (this.getViewSettings().enableSwipe && task.id !== null && !isEditing) {
      this.swipe.attach(row, fg, task.id);
    }
  }

  private renderViewFields(label: HTMLElement, task: Task, daysAgo: number): void {
    const enterEdit = (ev: Event) => {
      ev.stopPropagation();
      if (this.swipe.isAnyRevealed()) {
        // First tap on a row while another is swiped open just closes the swipe.
        this.swipe.closeIfOpen();
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

    if (daysAgo > 0) {
      // Dim "-Nd" marker before @project — mirrors tick-tui's right-side
      // formatting (`-1d @work`). Hooked to enterEdit so a tap on the marker
      // doesn't fall through to swipe handling.
      const marker = label.createSpan({
        text: `-${daysAgo}d`,
        cls: "tick-day-marker",
      });
      marker.addEventListener("click", enterEdit);
    }

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
    attachKeyboardScroll(this.contentEl, titleInput);

    let committed = false;

    const commit = async () => {
      if (committed) return;
      committed = true;
      const raw = titleInput.value.trim();
      const split = splitProjectFromTitle(raw);
      const newTitle = split.title;
      const newProject = split.project;
      if (!newTitle) {
        // Empty title on edit is invalid. Surface the error and stay in edit
        // mode so the user can correct or hit Esc to cancel; previously we
        // silently dismissed the edit, which dropped any in-progress changes.
        new Notice("Title cannot be empty", 3000);
        committed = false;
        // Re-focus the input — blur is what likely triggered this commit, so
        // the input has lost focus and the keyboard may have collapsed.
        requestAnimationFrame(() => {
          titleInput.focus();
          const end = titleInput.value.length;
          titleInput.setSelectionRange(end, end);
        });
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
      if (committed) return;
      this.editingId = null;
      void this.render();
    };

    wireInputCommit(titleInput, row, { onCommit: commit, onCancel: cancel });
  }

  // ── Phantom add (sticky) ────────────────────────────────────────────

  private renderPhantomAdd(body: HTMLElement): void {
    const row = body.createDiv({ cls: "tick-today-row is-editing" });
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
    attachKeyboardScroll(this.contentEl, titleInput);

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

    wireInputCommit(titleInput, row, { onCommit: commit, onCancel: cancel });
  }

  // After re-render the DOM is fresh; if we're in edit / phantom mode, restore
  // focus so users can type continuously.
  private refocusActiveInput(): void {
    if (this.editingId !== null) {
      const row = this.contentEl.querySelector(
        `[data-task-id="${CSS.escape(this.editingId)}"]`
      );
      if (!row) return;
      const target = row.querySelector('[data-tick-role="title-input"]') as HTMLInputElement | null;
      // Skip the focus call if this input is already the active element.
      // Calling .focus() again on iOS Safari can cause a brief keyboard
      // collapse-and-reopen flicker when render() fires while the user is
      // typing.
      if (target && document.activeElement !== target) {
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
      if (target && document.activeElement !== target) {
        requestAnimationFrame(() => target.focus());
      }
    }
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

    this.swipe.closeIfOpen();
    await this.refresh();

    // 5s Undo Notice. Build a DocumentFragment so we can attach a click handler
    // to the Undo link inside Obsidian's standard Notice toast.
    const frag = document.createDocumentFragment();
    const span = document.createElement("span");
    span.textContent = `Deleted: ${truncateForNotice(task.title)} · `;
    frag.appendChild(span);
    const link = document.createElement("a");
    link.textContent = "Undo";
    link.className = "tick-undo-link";
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

function truncateForNotice(s: string): string {
  return s.length > 40 ? s.slice(0, 37) + "…" : s;
}
