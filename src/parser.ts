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
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
