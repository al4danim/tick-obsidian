// Pure parsing / serialization helpers for tasks.md lines.
// Kept separate from store.ts so they can be unit-tested without
// pulling in the Obsidian module (which only exists at runtime in
// the host app).
//
// Format (position-insensitive when parsing, fixed order when marshalling):
//
//   - [ ] description @project +YYYY-MM-DD [N]
//   - [x] description @project +YYYY-MM-DD *YYYY-MM-DD [N]
//
// `[N]` is the integer ID and MUST be at end of line.

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
  return formatDate(new Date());
}

export function yesterdayString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatDate(d);
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// How far back computeStreak walks. Anything past this is left to tick-tui's
// stats panel, which has full archive history. Callers should display "N+"
// when streak === STREAK_WINDOW_DAYS since we can't tell N from N+1 here.
export const STREAK_WINDOW_DAYS = 30;

// Walks back from today through the last STREAK_WINDOW_DAYS counting
// consecutive days with at least one done task. Stops at the first
// zero-completion day.
//
// Limit: tasks.md only — we don't read archive.md (the Go-side tick-tui CLI
// owns the 7-day rolling sweep). On a vault where the user runs tick-tui
// daily, done tasks older than 7 days have moved to archive.md and won't
// count here. The TUI's stats panel is the source of truth for streaks
// longer than that window.
export function computeStreak(tasks: Task[]): number {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    if (t.done && t.doneDate) {
      counts.set(t.doneDate, (counts.get(t.doneDate) ?? 0) + 1);
    }
  }
  let streak = 0;
  const cursor = new Date();
  for (let i = 0; i < STREAK_WINDOW_DAYS; i++) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const day = String(cursor.getDate()).padStart(2, "0");
    const key = `${y}-${m}-${day}`;
    if (!counts.has(key)) return streak;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// Groups pending tasks by project for display. Returns an ordered array of
// groups (each group = an array of tasks sharing the same project).
// Ordering: null project always last; otherwise largest group first, ties
// broken by the group's first-seen position in the input list.
export function groupPendingByProject(pending: Task[]): Task[][] {
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

  return Array.from(groups.entries())
    .sort((a, b) => {
      if (a[0] === null && b[0] !== null) return 1;
      if (b[0] === null && a[0] !== null) return -1;
      const sizeDiff = b[1].length - a[1].length;
      if (sizeDiff !== 0) return sizeDiff;
      return (firstSeen.get(a[0]) ?? 0) - (firstSeen.get(b[0]) ?? 0);
    })
    .map(([, tasks]) => tasks);
}

// Split "title @project" trailing project (mirrors Go-side helper).
// Returns { title, project } where project may be null.
//
// Only the LAST `@xxx` (preceded by whitespace and ending the string) is
// treated as the project. Other `@xxx` patterns inside the title are kept
// as literal text — `splitTitle("Email @john about @work")` returns
// `{ title: "Email @john about", project: "work" }`. If the user typed
// multiple `@` intending several tags, only the last one is stored as
// project; the others survive as part of the title (no data loss).
export function splitProjectFromTitle(input: string): { title: string; project: string | null } {
  const trimmed = input.trim();
  const m = /(^|\s)@(\S+)\s*$/.exec(trimmed);
  if (!m) return { title: trimmed, project: null };
  return {
    title: trimmed.slice(0, m.index).trim(),
    project: m[2],
  };
}
