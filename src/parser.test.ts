import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseLine,
  marshalLine,
  splitProjectFromTitle,
  todayString,
  yesterdayString,
  Task,
} from "./parser";

describe("splitProjectFromTitle", () => {
  it("extracts trailing @project", () => {
    expect(splitProjectFromTitle("buy milk @home")).toEqual({
      title: "buy milk",
      project: "home",
    });
  });

  it("returns null project when no trailing @ pattern", () => {
    expect(splitProjectFromTitle("buy milk")).toEqual({
      title: "buy milk",
      project: null,
    });
  });

  it("does not extract @ in middle of title", () => {
    expect(splitProjectFromTitle("email @john about budget")).toEqual({
      title: "email @john about budget",
      project: null,
    });
  });

  // Multi-@ behavior is intentional: only the LAST `@xxx\s*$` becomes project,
  // earlier `@xxx` patterns stay as literal title text. Locking this in so the
  // round-trip stays idempotent (no silent data loss across re-edits).
  it("only the last @xxx becomes project; earlier @xxx stays in title", () => {
    expect(splitProjectFromTitle("buy @milk @shopping")).toEqual({
      title: "buy @milk",
      project: "shopping",
    });
  });

  it("round-trips through edit cycle without losing tokens", () => {
    // Simulates: user types "buy @milk @shopping", we split, then they reopen
    // edit and the input is repopulated as `title + " @" + project`. A second
    // commit should produce the exact same split — no token migration.
    const split1 = splitProjectFromTitle("buy @milk @shopping");
    const repop = `${split1.title} @${split1.project}`;
    const split2 = splitProjectFromTitle(repop);
    expect(split2).toEqual(split1);
  });

  it("handles Chinese project names", () => {
    expect(splitProjectFromTitle("买牛奶 @家里")).toEqual({
      title: "买牛奶",
      project: "家里",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(splitProjectFromTitle("  buy milk @home  ")).toEqual({
      title: "buy milk",
      project: "home",
    });
  });

  it("empty input → empty title, null project", () => {
    expect(splitProjectFromTitle("")).toEqual({ title: "", project: null });
    expect(splitProjectFromTitle("   ")).toEqual({ title: "", project: null });
  });

  it("@ alone (no project name) is not treated as project", () => {
    // "@" with nothing after isn't `\S+`, so it stays in the title.
    expect(splitProjectFromTitle("buy milk @")).toEqual({
      title: "buy milk @",
      project: null,
    });
  });
});

describe("parseLine", () => {
  it("parses a pending line with all fields", () => {
    const t = parseLine("- [ ] buy milk @home +2026-05-01 [a3k7m2x9]", 0);
    expect(t).toEqual({
      id: "a3k7m2x9",
      done: false,
      title: "buy milk",
      project: "home",
      created: "2026-05-01",
      doneDate: null,
      rawIndex: 0,
    } satisfies Task);
  });

  it("parses a done line with done date", () => {
    const t = parseLine(
      "- [x] write report @work +2026-04-29 *2026-04-30 [b1d4e5f0]",
      3,
    );
    expect(t).toEqual({
      id: "b1d4e5f0",
      done: true,
      title: "write report",
      project: "work",
      created: "2026-04-29",
      doneDate: "2026-04-30",
      rawIndex: 3,
    } satisfies Task);
  });

  it("returns null for non-task lines", () => {
    expect(parseLine("# heading", 0)).toBeNull();
    expect(parseLine("plain text", 0)).toBeNull();
    expect(parseLine("", 0)).toBeNull();
  });

  it("parses minimal task line (no project, no dates, no ID)", () => {
    const t = parseLine("- [ ] just a title", 5);
    expect(t).toEqual({
      id: null,
      done: false,
      title: "just a title",
      project: null,
      created: null,
      doneDate: null,
      rawIndex: 5,
    } satisfies Task);
  });
});

describe("marshalLine", () => {
  it("round-trips a complete task", () => {
    const t: Task = {
      id: "a3k7m2x9",
      done: false,
      title: "buy milk",
      project: "home",
      created: "2026-05-01",
      doneDate: null,
      rawIndex: 0,
    };
    expect(marshalLine(t)).toBe("- [ ] buy milk @home +2026-05-01 [a3k7m2x9]");
  });

  it("omits done date when not done", () => {
    const t: Task = {
      id: "x",
      done: false,
      title: "t",
      project: null,
      created: "2026-05-01",
      doneDate: "2026-04-30",
      rawIndex: 0,
    };
    expect(marshalLine(t)).toBe("- [ ] t +2026-05-01 [x]");
  });

  it("parse → marshal round-trip is stable", () => {
    const line = "- [x] write report @work +2026-04-29 *2026-04-30 [b1d4e5f0]";
    const t = parseLine(line, 0)!;
    expect(marshalLine(t)).toBe(line);
  });
});

describe("todayString / yesterdayString", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns YYYY-MM-DD format", () => {
    expect(todayString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(yesterdayString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("yesterdayString is one day before todayString", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T12:00:00"));
    expect(todayString()).toBe("2026-05-03");
    expect(yesterdayString()).toBe("2026-05-02");
  });

  it("yesterdayString crosses month boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T12:00:00"));
    expect(yesterdayString()).toBe("2026-04-30");
  });

  it("yesterdayString crosses year boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00"));
    expect(yesterdayString()).toBe("2025-12-31");
  });
});
