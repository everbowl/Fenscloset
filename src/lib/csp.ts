/**
 * The Content-Security-Policy every page carries (security item 11, LIVE-02), built per request around a nonce so only the
 * scripts the server itself emitted may run; 'strict-dynamic' lets those scripts load what they import, and nothing
 * inline without the nonce runs. Styles keep 'unsafe-inline' for React's style attributes and Next's injected styles; the
 * accent color is an inline <style> in the app layout. Store photos are shown straight from store CDNs, hence img-src
 * https:. Uploads go to this origin unless S3_DIRECT_UPLOADS is on, when the bucket's origin is added to connect-src.
 */
export function buildCsp(nonce: string, opts: { enforcing?: boolean } = {}): string {
  const enforcing = opts.enforcing ?? CSP_HEADER === "Content-Security-Policy";
  const connect = ["'self'"];
  if (process.env.S3_DIRECT_UPLOADS === "true" && process.env.S3_ENDPOINT) {
    try { connect.push(new URL(process.env.S3_ENDPOINT).origin); } catch { /* a malformed endpoint adds nothing */ }
  }
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    "media-src 'self' blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    // Violations are posted to a public route that writes one log line each, so the report-only week has something to
    // read: the legacy form for every browser, the newer one for those that honor Reporting-Endpoints.
    `report-uri ${CSP_REPORT_PATH}`,
    "report-to csp",
  ];
  // Browsers ignore upgrade-insecure-requests in a report-only policy and say so in the console on every page, so it joins
  // the policy only once the header turns enforcing. Until then the proxy's https redirect and HSTS keep every visit on https.
  if (enforcing) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/** A fresh nonce per request: 16 random bytes, base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** Where browsers post violation reports: a public route that logs one line per report and stores nothing. */
export const CSP_REPORT_PATH = "/api/csp-report";

/** The Reporting-Endpoints header naming that route for the report-to form. */
export function reportingEndpoints(origin: string): string {
  return `csp="${origin}${CSP_REPORT_PATH}"`;
}

/** The header the policy ships under. Report-only first (security item 11 step 4); enforcing once a week of screens shows no violation. */
export const CSP_HEADER: string = "Content-Security-Policy-Report-Only";
