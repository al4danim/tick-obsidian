import { App, normalizePath, TFile } from "obsidian";
import { Task, parseLine, marshalLine, todayString, yesterdayString, splitProjectFromTitle, computeStreak, groupPendingByProject } from "./parser";

// Re-export so existing imports from "./store" keep working.
export { parseLine, marshalLine, todayString, yesterdayString, splitProjectFromTitle, computeStreak, groupPendingByProject };
export type { Task };

// 8 hex chars. Random IDs avoid collisions when Mac and mobile both add tasks
// against unsynced views of the file (the sequential "max+1" approach we used
// before kept producing duplicates).
function genID(): string {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Store wraps tasks.md vault file IO.
export class Store {
  private app: App;
  private path: string;

  constructor(app: App, path: string) {
    this.app = app;
    this.path = normalizePath(path);
  }

  setPath(path: string): void {
    this.path = normalizePath(path);
  }

  getPath(): string {
    return this.path;
  }

  // Read tasks.md, returning all parseable rows. Non-task lines are ignored
  // (and preserved on save).
  async load(): Promise<{ tasks: Task[]; lines: string[] }> {
    let content = "";
    try {
      content = await this.app.vault.adapter.read(this.path);
    } catch {
      // File missing — treat as empty
      content = "";
    }
    const lines = content.length === 0 ? [] : content.split("\n");
    // Drop trailing empty line from split if file ends with \n
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    const tasks: Task[] = [];
    for (let i = 0; i < lines.length; i++) {
      const t = parseLine(lines[i], i);
      if (t) tasks.push(t);
    }
    return { tasks, lines };
  }

  // Replace tasks.md with the given lines (atomic-ish via vault.modify or
  // adapter.write — both write to a temp + rename on desktop).
  private async writeLines(lines: string[]): Promise<void> {
    const content = lines.length === 0 ? "" : lines.join("\n") + "\n";
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
      return;
    }
    // Ensure parent directory exists
    const dir = this.path.substring(0, this.path.lastIndexOf("/"));
    if (dir && !(await this.app.vault.adapter.exists(dir))) {
      await this.app.vault.adapter.mkdir(dir);
    }
    await this.app.vault.adapter.write(this.path, content);
  }

  // Append a new task with a fresh random ID and today's created date.
  async addTask(input: { title: string; project: string | null }): Promise<Task> {
    const { tasks, lines } = await this.load();
    const used = new Set(tasks.map((t) => t.id).filter((x): x is string => x !== null));
    let id = genID();
    while (used.has(id)) id = genID();
    const t: Task = {
      id,
      done: false,
      title: input.title,
      project: input.project,
      created: todayString(),
      doneDate: null,
      rawIndex: lines.length,
    };
    lines.push(marshalLine(t));
    await this.writeLines(lines);
    return t;
  }

  // Toggle a task's done state in place. When marking done, fills *date with
  // today. When unmarking, clears *date.
  async toggleTask(id: string): Promise<void> {
    const { tasks, lines } = await this.load();
    const t = findById(tasks, id);
    if (!t) return;
    t.done = !t.done;
    t.doneDate = t.done ? todayString() : null;
    lines[t.rawIndex] = marshalLine(t);
    await this.writeLines(lines);
  }

  // Edit title + project of an existing task.
  async editTask(id: string, fields: { title: string; project: string | null }): Promise<void> {
    const { tasks, lines } = await this.load();
    const t = findById(tasks, id);
    if (!t) return;
    t.title = fields.title;
    t.project = fields.project;
    lines[t.rawIndex] = marshalLine(t);
    await this.writeLines(lines);
  }

  // Delete a task entirely from tasks.md. Returns the deleted raw line + its
  // original line index so callers can call restoreLine() to undo the delete.
  // Returns null if the task wasn't found (already-deleted via another device).
  async deleteTask(id: string): Promise<{ line: string; rawIndex: number } | null> {
    const { tasks, lines } = await this.load();
    const t = findById(tasks, id);
    if (!t) return null;
    const line = lines[t.rawIndex];
    const rawIndex = t.rawIndex;
    lines.splice(rawIndex, 1);
    await this.writeLines(lines);
    return { line, rawIndex };
  }

  // Restore a previously-deleted line at its original index. If the file has
  // since gained more lines past that index (sync from another device, etc.)
  // the restored line is appended at the end instead.
  async restoreLine(line: string, rawIndex: number): Promise<void> {
    const { lines } = await this.load();
    const idx = Math.min(rawIndex, lines.length);
    lines.splice(idx, 0, line);
    await this.writeLines(lines);
  }

}

function findById(tasks: Task[], id: string): Task | null {
  for (const t of tasks) {
    if (t.id === id) return t;
  }
  return null;
}
