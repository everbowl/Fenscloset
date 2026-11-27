import { describe, expect, it } from "vitest";
import { ruleKind } from "@/lib/rules-kind";

describe("rule kinds (review E D1)", () => {
  it("decides the input from the key, never from the value, so 0 and 1 stay numbers", () => {
    expect(ruleKind({ key: "wantSweepHours", value: "0" })).toBe("number");
    expect(ruleKind({ key: "wantSweepHours", value: "1" })).toBe("number");
    expect(ruleKind({ key: "compareKling", value: "off" })).toBe("onoff");
    expect(ruleKind({ key: "noRepeatDays", value: "1" })).toBe("number");
    expect(ruleKind({ key: "needSnoozeDays", value: "off" })).toBe("number");
    expect(ruleKind({ key: "sizeBandXsMaxLb", value: "1" })).toBe("number");
    expect(ruleKind({ key: "accentColor", value: "#FF5A00" })).toBe("color");
    expect(ruleKind({ key: "accentColor", value: "0" })).toBe("color");
    expect(ruleKind({ key: "timezone", value: "America/Los_Angeles" })).toBe("text");
    expect(ruleKind({ key: "mirrorEngine", value: "fashn" })).toBe("choice");
  });
});
