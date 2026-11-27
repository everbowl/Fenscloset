import { NextResponse } from "next/server";
import { CSP_REPORT_MAX_BYTES, describeViolation, parseCspReports } from "@/lib/csp-report";

/**
 * Where browsers post Content-Security-Policy violation reports (security item 11). Public (no session: browsers may send
 * reports without cookies), small (16 KB), stores nothing: each report is one warning line in the server log, read during
 * the report-only week before the policy turns enforcing. Anything unreadable is dropped quietly; a browser never retries.
 */
export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > CSP_REPORT_MAX_BYTES) return new NextResponse(null, { status: 413 });
  const text = await req.text();
  if (text.length > CSP_REPORT_MAX_BYTES) return new NextResponse(null, { status: 413 });
  for (const v of parseCspReports(text)) console.warn(describeViolation(v));
  return new NextResponse(null, { status: 204 });
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
