import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { Store, Task, todayString, splitProjectFromTitle } from "./store";

export const VIEW_TYPE_TODAY = "tick-today";

type InputState =
  | { mode: "add" }
  | { mode: "edit"; id: string }
  | null;

export class TodayView extends ItemView {
  private store: Store;
  private rendering = false;
  private input: InputState = null;
  private tasks: Task[] = [];

  constructor(leaf: WorkspaceLeaf, store: Store) {
    super(leaf);
    this.store = store;
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

    // Header bar
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

    try {
      const data = await this.store.load();
      this.tasks = data.tasks;
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

    const summary = header.createEl("span", {
      cls: "tick-today-summary",
      text: `${doneToday.length}/${pending.length + doneToday.length} done`,
    });
    summary.style.marginLeft = "auto";
    summary.style.color = "var(--text-muted)";
    summary.style.fontSize = "0.9em";

    const body = container.createDiv({ cls: "tick-today-body" });

    if (pending.length === 0 && doneToday.length === 0 && this.input?.mode !== "add") {
      body.createEl("p", {
        text: "No tasks for today. Tap + to add one.",
        cls: "tick-empty-hint",
      });
      this.rendering = false;
      return;
    }

    if (pending.length > 0 || this.input?.mode === "add") {
      body.createEl("div", { text: "Pending", cls: "tick-section-label" });
      if (this.input?.mode === "add") this.renderInputRow(body, null);
      for (const t of pending) {
        if (this.input?.mode === "edit" && this.input.id === t.id) {
          this.renderInputRow(body, t);
        } else {
          this.renderRow(body, t);
        }
      }
    }

    if (doneToday.length > 0) {
      body.createEl("div", { text: "Done today", cls: "tick-section-label" });
      for (const t of doneToday) {
        if (this.input?.mode === "edit" && this.input.id === t.id) {
          this.renderInputRow(body, t);
        } else {
          this.renderRow(body, t);
        }
      }
    }

    this.rendering = false;
  }

  private renderRow(parent: HTMLElement, task: Task): void {
    const row = parent.createDiv({
      cls: `tick-today-row${task.done ? " done" : ""}`,
    });

    const checkbox = row.createEl("input", {
      type: "checkbox",
      cls: "tick-checkbox",
    });
    checkbox.checked = task.done;
    checkbox.setAttribute("aria-label", `Toggle: ${task.title}`);

    const label = row.createDiv({ cls: "tick-row-label" });
    label.createSpan({ text: task.title, cls: "tick-feature-title" });
    if (task.project) {
      label.createSpan({ text: ` @${task.project}`, cls: "tick-project" });
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
  }

  // Inline add (task=null) or inline edit (task=existing task).
  private renderInputRow(parent: HTMLElement, task: Task | null): void {
    const row = parent.createDiv({ cls: "tick-today-row tick-input-row" });

    // Static checkbox visual (just to align with sibling rows)
    const cb = row.createEl("input", { type: "checkbox", cls: "tick-checkbox" });
    cb.checked = task?.done ?? false;
    cb.disabled = true;

    const fields = row.createDiv({ cls: "tick-input-fields" });

    const titleInput = fields.createEl("input", {
      type: "text",
      cls: "tick-input-title",
      placeholder: "title",
      value: task?.title ?? "",
    });

    const projInput = fields.createEl("input", {
      type: "text",
      cls: "tick-input-project",
      placeholder: "project",
      value: task?.project ?? "",
    });

    const actions = row.createDiv({ cls: "tick-input-actions" });

    const saveBtn = actions.createEl("button", {
      text: "✓",
      cls: "tick-input-save",
      attr: { "aria-label": "Save" },
    });

    const cancelBtn = actions.createEl("button", {
      text: "✕",
      cls: "tick-input-cancel",
      attr: { "aria-label": "Cancel" },
    });

    let delBtn: HTMLButtonElement | null = null;
    if (task && task.id !== null) {
      delBtn = actions.createEl("button", {
        text: "🗑",
        cls: "tick-input-delete",
        attr: { "aria-label": "Delete" },
      });
    }

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
