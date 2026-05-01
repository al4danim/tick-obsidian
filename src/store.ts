import { App, normalizePath, TFile } from "obsidian";

// Single line in tasks.md.
//
// Format (position-insensitive when parsing, fixed order when marshalling):
//
//   - [ ] description @project +YYYY-MM-DD [N]
//   - [x] description @project +YYYY-MM-DD *YYYY-MM-DD [N]
//
// `[N]` is the integer ID and MUST be at end of line. The Go side (tick-tui)
// owns the 7-day rolling archive sweep; this plugin only edits tasks.md.
export interface Task {
  id: string | null;       // null = unsaved row that hasn't picked up an ID yet
  done: boolean;
  title: string;
  project: string | null;
  created: string | null;  // YYYY-MM-DD
  doneDate: string | null; // YYYY-MM-DD; only when done=true
  rawIndex: number;        // line index in original file (for stable ID-less rows)
}

const checkboxRe = /^- \[([ xX])\]\s+(.*)$/;
// IDs are 8-char hex (new) but we accept any 1-16 alphanumerics so legacy
// numeric IDs from older exports still parse until the next sweep rewrites them.
const idRe = /\s\[([a-zA-Z0-9]{1,16})\]\s*$/;
const projectRe = /(^|\s)@(\S+)/;
const createdRe = /(^|\s)\+(\d{4}-\d{2}-\d{2})(\s|$)/;
const doneRe = /(^|\s)\*(\d{4}-\d{2}-\d{2})(\s|$)/;

// 8 hex chars. Random IDs avoid collisions when Mac and mobile both add tasks
// against unsynced views of the file (the sequential "max+1" approach we used
// before kept producing duplicates).
function genID(): string {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function parseLine(line: string, rawIndex: number): Task | null {
  const m = checkboxRe.exec(line);
  if (!m) return null;
  const done = m[1].toLowerCase() === "x";
  let rest = m[2];

  let id: string | null = null;
  const idMatch = idRe.exec(rest);
  if (idMatch) {
    id = idMatch[1];
    rest = rest.slice(0, idMatch.index);
  }

  let created: string | null = null;
  const cm = createdRe.exec(rest);
  if (cm) {
    created = cm[2];
    rest = stripRange(rest, cm.index, cm.index + cm[0].length);
  }

  let doneDate: string | null = null;
  const dm = doneRe.exec(rest);
  if (dm) {
    doneDate = dm[2];
    rest = stripRange(rest, dm.index, dm.index + dm[0].length);
  }

  let project: string | null = null;
  const pm = projectRe.exec(rest);
  if (pm) {
    project = pm[2];
    rest = stripRange(rest, pm.index, pm.index + pm[0].length);
  }

  return {
    id,
    done,
    title: rest.trim(),
    project,
    created,
    doneDate,
    rawIndex,
  };
}

function stripRange(s: string, start: number, end: number): string {
  const left = s.slice(0, start);
  const right = s.slice(end);
  const leftEndsSpace = left === "" || left.endsWith(" ");
  const rightStartsSpace = right === "" || right.startsWith(" ");
  if (!leftEndsSpace && !rightStartsSpace) return left + " " + right;
  return left + right;
}

export function marshalLine(t: Task): string {
  const status = t.done ? "[x]" : "[ ]";
  const parts: string[] = [`- ${status} ${t.title}`];
  if (t.project) parts.push(`@${t.project}`);
  if (t.created) parts.push(`+${t.created}`);
  if (t.done && t.doneDate) parts.push(`*${t.doneDate}`);
  if (t.id !== null) parts.push(`[${t.id}]`);
  return parts.join(" ");
}

export function todayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

  // Delete a task entirely from tasks.md.
  async deleteTask(id: string): Promise<void> {
    const { tasks, lines } = await this.load();
    const t = findById(tasks, id);
    if (!t) return;
    lines.splice(t.rawIndex, 1);
    await this.writeLines(lines);
  }
}

function findById(tasks: Task[], id: string): Task | null {
  for (const t of tasks) {
    if (t.id === id) return t;
  }
  return null;
}

// Split "title @project" trailing project (mirrors Go-side helper).
// Returns { title, project } where project may be null.
export function splitProjectFromTitle(input: string): { title: string; project: string | null } {
  const trimmed = input.trim();
  const m = /(^|\s)@(\S+)\s*$/.exec(trimmed);
  if (!m) return { title: trimmed, project: null };
  return {
    title: trimmed.slice(0, m.index).trim(),
    project: m[2],
  };
}
