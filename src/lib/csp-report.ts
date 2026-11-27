/**
 * Reading the violation reports browsers post to /api/csp-report (security item 11). Nothing is stored: each report becomes
 * one warning line in the server log, with every URL cut back to origin and path so a reset link's token or a query never
 * lands in the logs. Two shapes arrive: the legacy `application/csp-report` object and the Reporting API's
 * `application/reports+json` array.
 */
export const CSP_REPORT_MAX_BYTES = 16 * 1024;
const MAX_REPORTS_PER_POST = 20;
const MAX_FIELD = 200;

export type CspViolation = { document: string; directive: string; blocked: string; source: string | null; line: number | null; disposition: string };

/** Origin and path only, capped; a bare token (like "inline" or "eval") passes through as is. */
function scrubUrl(v: unknown): string {
  if (typeof v !== "string" || !v) return "";
  try { const u = new URL(v); return (u.origin + u.pathname).slice(0, MAX_FIELD); } catch { return v.replace(/[?#].*$/, "").slice(0, MAX_FIELD); }
}
const str = (v: unknown): string => (typeof v === "string" ? v.slice(0, MAX_FIELD) : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parseCspReports(text: string): CspViolation[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return []; }
  const out: CspViolation[] = [];
  const legacy = (data as { "csp-report"?: Record<string, unknown> } | null)?.["csp-report"];
  if (legacy && typeof legacy === "object") {
    out.push({
      document: scrubUrl(legacy["document-uri"]), directive: str(legacy["effective-directive"] ?? legacy["violated-directive"]),
      blocked: scrubUrl(legacy["blocked-uri"]), source: scrubUrl(legacy["source-file"]) || null, line: num(legacy["line-number"]), disposition: str(legacy["disposition"]) || "report",
    });
  } else if (Array.isArray(data)) {
    for (const r of data.slice(0, MAX_REPORTS_PER_POST)) {
      const body = (r as { type?: string; url?: string; body?: Record<string, unknown> })?.body;
      if ((r as { type?: string })?.type !== "csp-violation" || !body || typeof body !== "object") continue;
      out.push({
        document: scrubUrl(body["documentURL"] ?? (r as { url?: string }).url), directive: str(body["effectiveDirective"]),
        blocked: scrubUrl(body["blockedURL"]), source: scrubUrl(body["sourceFile"]) || null, line: num(body["lineNumber"]), disposition: str(body["disposition"]) || "report",
      });
    }
  }
  return out.filter((v) => v.directive || v.blocked);
}

/** One line per violation, for the server log. */
export function describeViolation(v: CspViolation): string {
  return `csp-report (${v.disposition}): ${v.directive || "?"} blocked=${v.blocked || "?"} at ${v.document || "?"}${v.source ? ` (${v.source}${v.line != null ? `:${v.line}` : ""})` : ""}`;
}
