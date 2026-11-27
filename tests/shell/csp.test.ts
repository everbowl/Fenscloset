import { describe, expect, it } from "vitest";
import { buildCsp, CSP_HEADER, CSP_REPORT_PATH, newNonce, reportingEndpoints } from "@/lib/csp";

describe("the Content-Security-Policy (security item 11)", () => {
  it("scripts run only with the request's nonce; nothing inline, no eval, no other origin; framing, plugins and off-site forms refused", () => {
    const nonce = newNonce();
    const csp = buildCsp(nonce);
    const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(name + " "))?.slice(name.length + 1) ?? "";
    expect(directive("script-src")).toBe(`'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(directive("script-src")).not.toMatch(/unsafe-inline|unsafe-eval|https:/);
    expect(directive("default-src")).toBe("'self'");
    expect(directive("frame-ancestors")).toBe("'none'");
    expect(directive("object-src")).toBe("'none'");
    expect(directive("base-uri")).toBe("'self'");
    expect(directive("form-action")).toBe("'self'");
    expect(directive("img-src")).toBe("'self' data: blob: https:"); // store photos come straight from store CDNs
    expect(directive("connect-src")).toBe("'self'");
    expect(csp).not.toContain("upgrade-insecure-requests"); // browsers ignore it in a report-only policy and warn on every page
    expect(buildCsp(nonce, { enforcing: true })).toContain("upgrade-insecure-requests"); // it joins the policy when the header turns enforcing
    expect(CSP_HEADER).toBe("Content-Security-Policy-Report-Only"); // report-only until a week of screens shows no violation
    expect(directive("report-uri")).toBe(CSP_REPORT_PATH); // violations are logged on the server, so the week has something to read
    expect(directive("report-to")).toBe("csp");
    expect(reportingEndpoints("https://closet.example.test")).toBe('csp="https://closet.example.test/api/csp-report"');
  });

  it("a nonce is fresh every time and base64", () => {
    const a = newNonce(); const b = newNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(a, "base64").length).toBe(16);
  });

  it("direct uploads add the bucket's origin to connect-src, and nothing else", () => {
    const before = { ...process.env };
    process.env.S3_DIRECT_UPLOADS = "true"; process.env.S3_ENDPOINT = "https://bucket.example.com/path";
    try { expect(buildCsp("n")).toContain("connect-src 'self' https://bucket.example.com"); }
    finally { process.env.S3_DIRECT_UPLOADS = before.S3_DIRECT_UPLOADS; process.env.S3_ENDPOINT = before.S3_ENDPOINT; }
    delete process.env.S3_DIRECT_UPLOADS; delete process.env.S3_ENDPOINT;
    expect(buildCsp("n")).toContain("connect-src 'self';");
  });
});
