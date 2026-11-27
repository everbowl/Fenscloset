import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/csp-report/route";
import { CSP_REPORT_MAX_BYTES, parseCspReports } from "@/lib/csp-report";

const post = (body: string, type = "application/csp-report") => POST(new Request("http://localhost/api/csp-report", { method: "POST", headers: { "content-type": type }, body }));

describe("the CSP report route (security item 11)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a legacy report becomes one log line with every URL cut back to origin and path; nothing else is kept", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await post(JSON.stringify({ "csp-report": { "document-uri": "https://closet.example.test/reset-password?token=SECRET#x", "violated-directive": "script-src 'self'", "effective-directive": "script-src", "blocked-uri": "https://evil.test/x.js?k=SECRET", "source-file": "https://closet.example.test/_next/static/chunk.js", "line-number": 12, "original-policy": "default-src 'self'" } }));
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toBe("csp-report (report): script-src blocked=https://evil.test/x.js at https://closet.example.test/reset-password (https://closet.example.test/_next/static/chunk.js:12)");
    expect(line).not.toContain("SECRET");
  });

  it("a Reporting API batch is read too, other report types are ignored", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await post(JSON.stringify([
      { type: "csp-violation", url: "https://closet.example.test/today", body: { documentURL: "https://closet.example.test/today?x=1", effectiveDirective: "img-src", blockedURL: "https://cdn.example.test/p.jpg", disposition: "report" } },
      { type: "deprecation", url: "https://closet.example.test/today", body: { id: "x" } },
    ]), "application/reports+json");
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toBe("csp-report (report): img-src blocked=https://cdn.example.test/p.jpg at https://closet.example.test/today");
  });

  it("garbage logs nothing and still answers 204; an oversize body is refused; GET is not allowed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await post("not json")).status).toBe(204);
    expect((await post(JSON.stringify({ "csp-report": {} }))).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
    expect((await post("x".repeat(CSP_REPORT_MAX_BYTES + 1))).status).toBe(413);
    expect(GET().status).toBe(405);
    expect(parseCspReports("[]")).toEqual([]);
  });
});
