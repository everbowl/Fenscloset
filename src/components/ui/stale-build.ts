/**
 * A page from before a deploy talking to the server that replaced it: Next's stale-action error (the client's name for it,
 * or the server's own words), or a hashed chunk the new build no longer serves. src/app/error.tsx and (app)/error.tsx offer
 * Reload for these instead of Try again, which would call the build that is gone.
 */
const STALE = /Server Action|ChunkLoadError|Loading chunk|older or newer deployment/;

export function looksLikeStaleBuild(error: { name?: string; message?: string }): boolean {
  return error.name === "ChunkLoadError" || error.name === "UnrecognizedActionError" || STALE.test(error.message ?? "");
}
