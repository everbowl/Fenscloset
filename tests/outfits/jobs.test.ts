import { beforeEach, describe, expect, it } from "vitest";
import { dressingStatus, dressingsRunning, forgetDressings, settled, startDressing } from "@/lib/tryon/jobs";
import type { TryOnView } from "@/lib/tryon";

const view = (id: string): TryOnView => ({ id, key: `tryon/x/${id}.jpg`, itemIds: [], createdAt: new Date().toISOString(), cached: false });
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("dressing jobs (the mirror dresses in the background)", () => {
  beforeEach(() => forgetDressings());

  it("runs on, reports its steps, is joined by a second request for the same key, and is the owner's alone", async () => {
    const job = startDressing("k1", "jeff", async (step) => { step("Dressing you · Tee"); await wait(80); step("Checking the picture…"); await wait(80); return view("a"); });
    expect(dressingsRunning()).toBe(1);
    expect(await settled(job, 10)).toMatchObject({ state: "running", step: "Dressing you · Tee" }); // not done in time: the screen gets a job to poll
    expect(startDressing("k1", "jeff", async () => view("b"))).toBe(job); // the same look again joins the running job
    expect(dressingStatus(job.id, "jeff")).toMatchObject({ state: "running" });
    expect(dressingStatus(job.id, "brittney")).toBeNull(); // someone else's dressing is not readable
    expect(await settled(job, 2000)).toMatchObject({ state: "done", tryOn: { id: "a" } });
    expect(dressingsRunning()).toBe(0);
    expect(dressingStatus(job.id, "jeff")).toMatchObject({ state: "done", tryOn: { id: "a" } }); // still there for a phone that comes back late
    expect(startDressing("k1", "jeff", async () => view("c"))).not.toBe(job); // once done, the key is free again
  });

  it("a quick dressing answers in the first call; a failure is kept with its reason", async () => {
    const quick = startDressing("k2", "jeff", async () => view("q"));
    expect(await settled(quick, 500)).toMatchObject({ state: "done", tryOn: { id: "q" } });
    const bad = startDressing("k3", "jeff", async () => { throw new Error("no photo"); });
    expect(await settled(bad, 500)).toMatchObject({ state: "failed", error: { message: "no photo" } });
    expect(dressingStatus("nope", "jeff")).toBeNull();
  });
});
