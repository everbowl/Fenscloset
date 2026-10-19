import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { accentColor, getRuleFlag, photoRetouchOn, ruleKind, setRule } from "@/lib/rules";

describe("rules (Admin → Rules)", () => {
  beforeEach(async () => { await resetDb(); await seed(); });

  it("photo retouch is off unless an admin turns it on; the value is kept as on / off", async () => {
    expect(await photoRetouchOn()).toBe(false);
    expect(await setRule("photoRetouch", "On")).toMatchObject({ value: "on" });
    expect(await photoRetouchOn()).toBe(true);
    expect(await setRule("photoRetouch", "false")).toMatchObject({ value: "off" });
    expect(await photoRetouchOn()).toBe(false);
    await expect(setRule("photoRetouch", "maybe")).rejects.toThrow(/on or off/);
    expect(await getRuleFlag("noSuchRule", true)).toBe(true);
  });

  it("the button color takes a hex and nothing else; numbers stay numbers; the time zone is checked", async () => {
    expect(await setRule("accentColor", "#1a2b3c")).toMatchObject({ value: "#1A2B3C" });
    expect(await accentColor()).toBe("#1A2B3C");
    await expect(setRule("accentColor", "orange")).rejects.toThrow(/#FF5A00/);
    await expect(setRule("noRepeatDays", "abc")).rejects.toThrow(/whole number/);
    await expect(setRule("timezone", "Mars/Olympus")).rejects.toThrow(/time zone/);
    const rules = await db.rule.findMany();
    expect(ruleKind(rules.find((r) => r.key === "photoRetouch")!)).toBe("onoff");
    expect(ruleKind(rules.find((r) => r.key === "accentColor")!)).toBe("color");
    expect(ruleKind(rules.find((r) => r.key === "timezone")!)).toBe("text");
    expect(ruleKind(rules.find((r) => r.key === "noRepeatDays")!)).toBe("number");
  });
});
