import { beforeEach, describe, expect, it } from "vitest";
import { forgetJobs, jobsRunning, jobStatus, settled, startJob } from "@/lib/jobs";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("background jobs (the mirror dresses and Today builds its looks off the request)", () => {
  beforeEach(() => forgetJobs());

  it("runs on, reports its steps, is joined by a second request for the same key, and is the owner's alone", async () => {
    const job = startJob("k1", "jeff", async (step) => { step("Dressing you · Tee"); await wait(80); step("Checking the picture…"); await wait(80); return "a"; });
    expect(jobsRunning()).toBe(1);
    expect(await settled(job, 10)).toMatchObject({ state: "running", step: "Dressing you · Tee" }); // not done in time: the screen gets a job to poll
    expect(startJob("k1", "jeff", async () => "b")).toBe(job); // the same work again joins the running job
    expect(jobStatus(job.id, "jeff")).toMatchObject({ state: "running" });
    expect(jobStatus(job.id, "brittney")).toBeNull(); // someone else's job is not readable
    expect(await settled(job, 2000)).toMatchObject({ state: "done", result: "a" });
    expect(jobsRunning()).toBe(0);
    expect(jobStatus(job.id, "jeff")).toMatchObject({ state: "done", result: "a" }); // still there for a phone that comes back late
    expect(startJob("k1", "jeff", async () => "c")).not.toBe(job); // once done, the key is free again
  });

  it("quick work answers in the first call; a failure is kept with its reason", async () => {
    const quick = startJob("k2", "jeff", async () => "q");
    expect(await settled(quick, 500)).toMatchObject({ state: "done", result: "q" });
    const bad = startJob("k3", "jeff", async () => { throw new Error("no photo"); });
    expect(await settled(bad, 500)).toMatchObject({ state: "failed", error: { message: "no photo" } });
    expect(jobStatus("nope", "jeff")).toBeNull();
  });
});
