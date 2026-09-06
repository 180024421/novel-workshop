import { describe, expect, it } from "vitest";
import { filterAnnouncements, pickForceAnnouncements, type Announcement } from "./appMeta";

const base: Announcement[] = [
  {
    id: "a1",
    title: "全量",
    body: "hello",
    level: "info",
    minVersionCode: 0,
    maxVersionCode: 999,
  },
  {
    id: "a2",
    title: "仅新版本",
    body: "new",
    level: "warn",
    minVersionCode: 5,
    maxVersionCode: 10,
  },
  {
    id: "a3",
    title: "强制",
    body: "must",
    level: "critical",
    force: true,
    minVersionCode: 0,
    maxVersionCode: 999,
  },
  {
    id: "a4",
    title: "过期",
    body: "old",
    expireAt: "2020-01-01T00:00:00Z",
    minVersionCode: 0,
    maxVersionCode: 999,
  },
];

describe("filterAnnouncements", () => {
  it("filters by versionCode", () => {
    const low = filterAnnouncements({ announcements: base, versionCode: 1, now: Date.parse("2026-09-06T00:00:00Z") });
    expect(low.map((a) => a.id).sort()).toEqual(["a1", "a3"]);

    const mid = filterAnnouncements({ announcements: base, versionCode: 6, now: Date.parse("2026-09-06T00:00:00Z") });
    expect(mid.map((a) => a.id).sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("hides dismissed non-force items but keeps force/critical", () => {
    const list = filterAnnouncements({
      announcements: base,
      versionCode: 6,
      now: Date.parse("2026-09-06T00:00:00Z"),
      dismissedIds: ["a1", "a2", "a3"],
    });
    expect(list.map((a) => a.id)).toEqual(["a3"]);
  });

  it("drops expired announcements", () => {
    const list = filterAnnouncements({
      announcements: base,
      versionCode: 1,
      now: Date.parse("2026-09-06T00:00:00Z"),
    });
    expect(list.some((a) => a.id === "a4")).toBe(false);
  });

  it("pickForceAnnouncements selects force/critical", () => {
    const forced = pickForceAnnouncements(base);
    expect(forced.map((a) => a.id)).toEqual(["a3"]);
  });
});
