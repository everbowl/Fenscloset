import { beforeEach, describe, expect, it } from "vitest";
import { forgetJobs, jobsRunning, jobStatus, settled, startJob } from "@/lib/jobs";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("background jobs (the mirror dresses and Today builds its looks off the request)", () => {
  beforeEach(() => forgetJobs());

  it("runs on, reports its steps, is joined by a second request for the same key, and is the owner's alone", async () => {
    const job = startJob("k1", "avery", async (step) => { step("Dressing you · Tee"); await wait(80); step("Checking the picture…"); await wait(80); return "a"; });
    expect(jobsRunning()).toBe(1);
    expect(await settled(job, 10)).toMatchObject({ state: "running", step: "Dressing you · Tee" }); // not done in time: the screen gets a job to poll
    expect(startJob("k1", "avery", async () => "b")).toBe(job); // the same work again joins the running job
    expect(jobStatus(job.id, "avery")).toMatchObject({ state: "running" });
    expect(jobStatus(job.id, "blake")).toBeNull(); // someone else's job is not readable
    expect(await settled(job, 2000)).toMatchObject({ state: "done", result: "a" });
    expect(jobsRunning()).toBe(0);
    expect(jobStatus(job.id, "avery")).toMatchObject({ state: "done", result: "a" }); // still there for a phone that comes back late
    expect(startJob("k1", "avery", async () => "c")).not.toBe(job); // once done, the key is free again
  });

  it("with `after`, a running job is followed by a fresh one, not joined (a check-in saved while the looks were building)", async () => {
    const order: string[] = [];
    const first = startJob("looks", "avery", async () => { await wait(80); order.push("first"); return "without check-in"; });
    const second = startJob("looks", "avery", async () => { order.push("second"); return "with check-in"; }, { after: true });
    expect(second).not.toBe(first);
    expect(jobsRunning()).toBe(1); // the key now points at the follower
    expect(startJob("looks", "avery", async () => "x")).toBe(second); // a plain request joins the follower
    expect(await settled(second, 2000)).toMatchObject({ state: "done", result: "with check-in" });
    expect(order).toEqual(["first", "second"]); // the follower waited its turn
    expect(jobStatus(first.id, "avery")).toMatchObject({ state: "done", result: "without check-in" }); // the first is still readable
    expect(jobsRunning()).toBe(0);
    // A failed first job does not stop the follower.
    const bad = startJob("looks2", "avery", async () => { await wait(20); throw new Error("no weather"); });
    const next = startJob("looks2", "avery", async () => "fine", { after: true });
    expect(await settled(next, 2000)).toMatchObject({ state: "done", result: "fine" });
    expect(await settled(bad, 10)).toMatchObject({ state: "failed" });
  });

  it("a job can say part of its result is saved (`partial`), and the flag sticks through later steps; a follower says it is waiting", async () => {
    const job = startJob("k4", "avery", async (step) => { step("First look ready", { partial: true }); await wait(60); step("Two more looks…"); await wait(60); return "x"; });
    expect(await settled(job, 10)).toMatchObject({ state: "running", step: "First look ready", partial: true });
    await wait(80);
    expect(jobStatus(job.id, "avery")).toMatchObject({ state: "running", step: "Two more looks…", partial: true }); // still true: the screen may poll late
    const follower = startJob("k4", "avery", async () => "y", { after: true });
    expect(follower.status).toMatchObject({ state: "running", step: "Waiting for the earlier build…" });
    expect(follower.status).not.toHaveProperty("partial", true); // nothing of the follower's own is saved yet
    expect(await settled(follower, 2000)).toMatchObject({ state: "done", result: "y" });
  });

  it("quick work answers in the first call; a failure is kept with its reason", async () => {
    const quick = startJob("k2", "avery", async () => "q");
    expect(await settled(quick, 500)).toMatchObject({ state: "done", result: "q" });
    const bad = startJob("k3", "avery", async () => { throw new Error("no photo"); });
    expect(await settled(bad, 500)).toMatchObject({ state: "failed", error: { message: "no photo" } });
    expect(jobStatus("nope", "avery")).toBeNull();
  });
});
