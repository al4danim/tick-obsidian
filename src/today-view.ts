import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { Store, Task, todayString, splitProjectFromTitle } from "./store";

export const VIEW_TYPE_TODAY = "tick-today";

type InputState =
  | { mode: "add" }
  | { mode: "edit"; id: string }
  | null;

interface ViewSettings {
  groupByProject: boolean;
  enableSwipe: boolean;
}

export class TodayView extends ItemView {
  private store: Store;
  private rendering = false;
  private input: InputState = null;
  private tasks: Task[] = [];
  private streak = 0;
  private getViewSettings: () => ViewSettings;

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

  // Public hook so the "Add todo" command can trigger inline add from anywhere.
  startAdd(): void {
    this.input = { mode: "add" };
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

    if (pending.length === 0 && doneToday.length === 0 && this.input?.mode !== "add") {
      body.createEl("p", {
        text: "No tasks for today. Tap + to add one.",
        cls: "tick-empty-hint",
      });
      this.rendering = false;
      return;
    }

    // Pending block — inline-add row at top, then groups (or flat list).
    if (pending.length > 0 || this.input?.mode === "add") {
      if (this.input?.mode === "add") this.renderInputRow(body, null);
      this.renderPending(body, pending);
    }

    if (doneToday.length > 0) {
      this.renderDoneToday(body, doneToday);
    }

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
      this.input = { mode: "add" };
      void this.render();
    });
    // No manual refresh button: vault.on("modify") in main.ts triggers a
    // re-render automatically whenever tasks.md changes.

    // Streak chip — pill with 🔥 N (or "30+" at the cap). Stays in layout
    // even when streak is 0, just dimmed via .is-cold.
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
      // Flat list — every row is a direct child of body.
      for (const t of pending) {
        if (this.input?.mode === "edit" && this.input.id === t.id) {
          this.renderInputRow(body, t);
        } else {
          this.renderRow(body, t);
        }
      }
      return;
    }

    // Group by project: largest groups first; ties broken by first-appearance
    // index (stable across re-renders); null project always last.
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
      // null group always last
      if (a[0] === null && b[0] !== null) return 1;
      if (b[0] === null && a[0] !== null) return -1;
      // size desc
      const sizeDiff = b[1].length - a[1].length;
      if (sizeDiff !== 0) return sizeDiff;
      // tie: first-appearance asc
      return (firstSeen.get(a[0]) ?? 0) - (firstSeen.get(b[0]) ?? 0);
    });

    for (const [, tasks] of ordered) {
      const groupEl = body.createDiv({ cls: "tick-project-group" });
      for (const t of tasks) {
        if (this.input?.mode === "edit" && this.input.id === t.id) {
          this.renderInputRow(groupEl, t);
        } else {
          this.renderRow(groupEl, t);
        }
      }
    }
  }

  private renderDoneToday(body: HTMLElement, doneToday: Task[]): void {
    const divider = body.createDiv({ cls: "tick-divider" });
    divider.createSpan({ text: `Done today · ${doneToday.length}` });
    for (const t of doneToday) {
      if (this.input?.mode === "edit" && this.input.id === t.id) {
        this.renderInputRow(body, t);
      } else {
        this.renderRow(body, t);
      }
    }
  }

  private renderRow(parent: HTMLElement, task: Task): void {
    const row = parent.createDiv({
      cls: `tick-today-row${task.done ? " done" : ""}`,
      attr: task.id ? { "data-task-id": task.id } : {},
    });

    // Native checkbox kept for a11y/keyboard, visually hidden via CSS.
    const checkbox = row.createEl("input", {
      type: "checkbox",
      cls: "tick-checkbox",
    });
    checkbox.checked = task.done;
    checkbox.setAttribute("aria-label", `Toggle: ${task.title}`);

    // Custom visual sibling — the actual circle/check the user sees.
    const visual = row.createSpan({
      cls: "tick-checkbox-visual",
      attr: { "aria-hidden": "true" },
    });
    visual.addEventListener("click", (ev) => {
      ev.stopPropagation();
      checkbox.click();
    });

    const label = row.createDiv({ cls: "tick-row-label" });
    label.createSpan({ text: task.title, cls: "tick-feature-title" });
    if (task.project) {
      // Leading "@" comes from CSS ::before so we only emit the project name.
      label.createSpan({ text: task.project, cls: "tick-project" });
    }

    label.addEventListener("click", () => {
      if (task.id === null) {
        new Notice("Row has no ID yet; run tick-tui on Mac to assign one");
        return;
      }
      this.input = { mode: "edit", id: task.id };
      void this.render();
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

    if (this.getViewSettings().enableSwipe) {
      this.attachSwipeHandlers(row, checkbox);
    }
  }

  // Mobile-only swipe-to-toggle gesture. Both directions toggle (avoids
  // "which way is done" cognitive load). Direction-locked at 8px so vertical
  // scroll wins ties; commits at 80px past start.
  private attachSwipeHandlers(row: HTMLElement, checkbox: HTMLInputElement): void {
    if (!("ontouchstart" in window)) return;

    const THRESHOLD = 80;
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

      if (!trackingHorizontal) return; // user is scrolling vertically

      e.preventDefault();
      const cap = row.clientWidth;
      currentX = Math.max(-cap, Math.min(cap, dx));
      row.classList.add("is-swiping");
      row.style.transform = `translateX(${currentX}px)`;
    };

    const onEnd = () => {
      if (!trackingHorizontal) {
        // Vertical scroll path or never moved — just clean up.
        row.classList.remove("is-swiping");
        row.style.transform = "";
        return;
      }

      if (Math.abs(currentX) > THRESHOLD) {
        // Commit: slide row off-screen, then toggle.
        const sign = currentX > 0 ? 1 : -1;
        row.classList.add("swipe-confirm");
        row.style.transition = "transform 150ms";
        row.style.transform = `translateX(${sign * 100}%)`;
        setTimeout(() => {
          checkbox.click();
        }, 150);
      } else {
        // Snap back.
        row.style.transition = "transform 200ms";
        row.style.transform = "";
        setTimeout(() => {
          row.style.transition = "";
          row.classList.remove("is-swiping");
        }, 220);
      }
    };

    row.addEventListener("touchstart", onStart, { passive: true });
    row.addEventListener("touchmove", onMove, { passive: false });
    row.addEventListener("touchend", onEnd);
    row.addEventListener("touchcancel", onEnd);
  }

  // Inline add (task=null) or inline edit (task=existing task).
  // Layout: stacked card with full-width title + project inputs over a
  // right-aligned action row (Delete pushed to far left when present).
  private renderInputRow(parent: HTMLElement, task: Task | null): void {
    const row = parent.createDiv({ cls: "tick-input-row" });

    const titleInput = row.createEl("input", {
      type: "text",
      cls: "tick-input-title",
      attr: { placeholder: "Task title" },
      value: task?.title ?? "",
    });

    const projInput = row.createEl("input", {
      type: "text",
      cls: "tick-input-project",
      attr: { placeholder: "Project (optional)" },
      value: task?.project ?? "",
    });

    const actions = row.createDiv({ cls: "tick-input-actions" });

    let delBtn: HTMLButtonElement | null = null;
    if (task && task.id !== null) {
      // Delete is destructive — gets a separate visual zone (margin-right:
      // auto in CSS pushes it to the far left of the action row).
      delBtn = actions.createEl("button", {
        text: "Delete",
        cls: "tick-input-delete",
        attr: { "aria-label": "Delete" },
      });
    }

    const cancelBtn = actions.createEl("button", {
      text: "Cancel",
      cls: "tick-input-cancel",
      attr: { "aria-label": "Cancel" },
    });

    const saveBtn = actions.createEl("button", {
      text: "Save",
      cls: "tick-input-save",
      attr: { "aria-label": "Save" },
    });

    const setBusy = (busy: boolean) => {
      saveBtn.disabled = busy;
      cancelBtn.disabled = busy;
      if (delBtn) delBtn.disabled = busy;
      titleInput.disabled = busy;
      projInput.disabled = busy;
    };

    const cancel = () => {
      this.input = null;
      void this.render();
    };

    const save = async () => {
      const rawTitle = titleInput.value.trim();
      // Trailing @project in title field is split out so users can type
      // "buy milk @home" in one field and it'll work.
      const split = splitProjectFromTitle(rawTitle);
      const title = split.title;
      const project = (projInput.value.trim() || split.project) || null;
      if (!title) {
        new Notice("Title cannot be empty");
        titleInput.focus();
        return;
      }
      setBusy(true);
      try {
        if (task === null) {
          await this.store.addTask({ title, project });
        } else if (task.id !== null) {
          await this.store.editTask(task.id, { title, project });
        }
        this.input = null;
        await this.refresh();
      } catch (e) {
        new Notice(`Save failed: ${(e as Error).message}`, 5000);
        setBusy(false);
      }
    };

    const del = async () => {
      if (!task || task.id === null) return;
      setBusy(true);
      try {
        await this.store.deleteTask(task.id);
        this.input = null;
        await this.refresh();
      } catch (e) {
        new Notice(`Delete failed: ${(e as Error).message}`, 5000);
        setBusy(false);
      }
    };

    saveBtn.addEventListener("click", save);
    cancelBtn.addEventListener("click", cancel);
    if (delBtn) delBtn.addEventListener("click", del);

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        void save();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        cancel();
      }
    };
    titleInput.addEventListener("keydown", onKey);
    projInput.addEventListener("keydown", onKey);

    requestAnimationFrame(() => titleInput.focus());
  }
}
