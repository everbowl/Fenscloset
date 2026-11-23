/**
 * Cookie names and the session's lifetime, in a file with no imports: the proxy reads them on every request and must
 * not drag Prisma into its bundle (review A P1).
 */
export const SESSION_COOKIE = "fc_session";
export const VIEW_COOKIE = "fc_view";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
