import { describe, expect, it } from "vitest";
import {
  DEFAULT_OFFLINE_GRACE_MS,
  DEMO_LICENSE_KEY,
  TRIAL_DAYS,
  evaluateLicenseState,
} from "./license";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

describe("evaluateLicenseState", () => {
  const t0 = Date.parse("2026-09-01T00:00:00Z");

  it("allows trial within 14 days from firstLaunchAt", () => {
    const st = evaluateLicenseState({
      now: t0 + 3 * DAY,
      firstLaunchAt: t0,
      trialDays: TRIAL_DAYS,
    });
    expect(st.ok).toBe(true);
    expect(st.phase).toBe("trial");
    expect(st.daysLeft).toBe(11);
    expect(st.licensed).toBe(false);
  });

  it("expires trial after 14 days without license", () => {
    const st = evaluateLicenseState({
      now: t0 + 15 * DAY,
      firstLaunchAt: t0,
    });
    expect(st.ok).toBe(false);
    expect(st.phase).toBe("expired");
    expect(st.daysLeft).toBe(0);
  });

  it("treats valid ticket + entitlement as licensed", () => {
    const st = evaluateLicenseState({
      now: t0,
      firstLaunchAt: t0 - 30 * DAY,
      activatedOnline: true,
      timeUnlimited: false,
      licenseExpireAt: t0 + 30 * DAY,
      ticketExpireAt: t0 + 2 * DAY,
    });
    expect(st.ok).toBe(true);
    expect(st.phase).toBe("licensed");
    expect(st.licensed).toBe(true);
    expect(st.grace).toBe(false);
  });

  it("enters grace after ticket exp if previously activated online", () => {
    const ticketExp = t0;
    const st = evaluateLicenseState({
      now: ticketExp + 10 * HOUR,
      firstLaunchAt: t0 - 40 * DAY,
      activatedOnline: true,
      timeUnlimited: true,
      ticketExpireAt: ticketExp,
      graceMs: DEFAULT_OFFLINE_GRACE_MS,
    });
    expect(st.ok).toBe(true);
    expect(st.phase).toBe("grace");
    expect(st.grace).toBe(true);
  });

  it("denies after grace window ends", () => {
    const ticketExp = t0;
    const st = evaluateLicenseState({
      now: ticketExp + DEFAULT_OFFLINE_GRACE_MS + HOUR,
      firstLaunchAt: t0 - 40 * DAY,
      activatedOnline: true,
      timeUnlimited: true,
      ticketExpireAt: ticketExp,
      graceMs: DEFAULT_OFFLINE_GRACE_MS,
    });
    // trial also expired → expired
    expect(st.ok).toBe(false);
    expect(st.phase).toBe("expired");
  });

  it("does not grant grace if never activated online", () => {
    const st = evaluateLicenseState({
      now: t0 + 20 * DAY,
      firstLaunchAt: t0,
      activatedOnline: false,
      ticketExpireAt: t0 + DAY,
      licenseExpireAt: t0 + 100 * DAY,
    });
    expect(st.ok).toBe(false);
    expect(st.phase).toBe("expired");
  });

  it("allows demo key only when allowDemoKey is true", () => {
    const denied = evaluateLicenseState({
      now: t0 + 20 * DAY,
      firstLaunchAt: t0,
      licenseKey: DEMO_LICENSE_KEY,
      allowDemoKey: false,
    });
    expect(denied.ok).toBe(false);

    const allowed = evaluateLicenseState({
      now: t0 + 20 * DAY,
      firstLaunchAt: t0,
      licenseKey: DEMO_LICENSE_KEY,
      allowDemoKey: true,
    });
    expect(allowed.ok).toBe(true);
    expect(allowed.phase).toBe("licensed");
  });

  it("ignores local MOSHU-XXXX permanent unlock pattern", () => {
    const st = evaluateLicenseState({
      now: t0 + 20 * DAY,
      firstLaunchAt: t0,
      licenseKey: "MOSHU-ABCD-EFGH-IJKL",
      allowDemoKey: true,
    });
    expect(st.ok).toBe(false);
    expect(st.phase).toBe("expired");
  });
});
