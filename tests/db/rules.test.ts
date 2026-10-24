import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { accentColor, getRuleFlag, ruleKind, setRule } from "@/lib/rules";

describe("rules (Admin → Rules)", () => {
  beforeEach(async () => { await resetDb(); await seed(); });

  it("the button color takes a hex and nothing else; numbers stay numbers; the time zone is checked", async () => {
    expect(await setRule("accentColor", "#1a2b3c")).toMatchObject({ value: "#1A2B3C" });
    expect(await accentColor()).toBe("#1A2B3C");
    await expect(setRule("accentColor", "orange")).rejects.toThrow(/#FF5A00/);
    await expect(setRule("noRepeatDays", "abc")).rejects.toThrow(/whole number/);
    await expect(setRule("timezone", "Mars/Olympus")).rejects.toThrow(/time zone/);
    const rules = await db.rule.findMany();
    expect(ruleKind(rules.find((r) => r.key === "accentColor")!)).toBe("color");
    expect(ruleKind(rules.find((r) => r.key === "timezone")!)).toBe("text");
    expect(ruleKind(rules.find((r) => r.key === "noRepeatDays")!)).toBe("number");
  });

  it("a choice rule (the mirror engine) takes one of its values only", async () => {
    expect(await setRule("mirrorEngine", "fashn")).toMatchObject({ value: "fashn" });
    expect(await setRule("mirrorEngine", "compare")).toMatchObject({ value: "compare" });
    await expect(setRule("mirrorEngine", "bing")).rejects.toThrow(/Choose one of/);
    expect(ruleKind({ key: "mirrorEngine", value: "google" })).toBe("choice");
  });

  it("an on/off rule keeps its value as on / off and reads as a flag", async () => {
    await db.rule.create({ data: { key: "testFlag", value: "off", label: "Test flag", description: "" } });
    expect(await getRuleFlag("testFlag", true)).toBe(false);
    expect(await setRule("testFlag", "On")).toMatchObject({ value: "on" });
    expect(await getRuleFlag("testFlag", false)).toBe(true);
    expect(await setRule("testFlag", "false")).toMatchObject({ value: "off" });
    await expect(setRule("testFlag", "maybe")).rejects.toThrow(/on or off/);
    expect(await getRuleFlag("noSuchRule", true)).toBe(true);
    expect(ruleKind({ key: "testFlag", value: "off" })).toBe("onoff");
  });
});
