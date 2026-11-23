import { describe, expect, it } from "vitest";
import { SW_SOURCE, swScript, swVersion } from "@/lib/sw-source";
import { looksLikeStaleBuild } from "@/components/ui/stale-build";

describe("the service worker's version", () => {
  it("is the commit, else the build id fixed at build time, never the clock", () => {
    expect(swVersion({ sha: "abcdef1234567890", build: "b" })).toBe("abcdef123456");
    expect(swVersion({ build: "build-1" })).toBe("build-1");
    expect(swVersion({})).toBe("dev");
    expect(swVersion({})).toBe(swVersion({}));
  });
  it("is written into the script", () => {
    expect(swScript("abc")).toContain('const VERSION = "abc";');
    expect(swScript("abc")).not.toContain('"v1"');
  });
});

describe("the service worker waits for the person", () => {
  it("never takes over an open page on its own", () => {
    // The only skipWaiting is the one the Reload bar asks for; there is no clients.claim().
    expect(SW_SOURCE.match(/self\.skipWaiting\(\)/g)).toHaveLength(1);
    expect(SW_SOURCE).toMatch(/type === "skipWaiting"\) self\.skipWaiting\(\)/);
    expect(SW_SOURCE).not.toContain("self.clients.claim");
  });
  it("keeps photos in a bounded cache and forgets them on logout", () => {
    expect(SW_SOURCE).toContain('type === "logout"');
    expect(SW_SOURCE).toContain("caches.delete(PHOTOS)");
    expect(SW_SOURCE).toContain("PHOTO_LIMIT = 300");
  });
  it("gives a navigation 8 s before the offline page", () => {
    expect(SW_SOURCE).toContain("NAV_DEADLINE_MS = 8000");
  });
  it("is valid JavaScript", () => {
    expect(() => new Function(SW_SOURCE)).not.toThrow();
  });
});

describe("a page left open across a deploy", () => {
  it("is recognized by the client's error, the server's words, or a missing chunk", () => {
    expect(looksLikeStaleBuild({ name: "UnrecognizedActionError", message: "x" })).toBe(true);
    expect(looksLikeStaleBuild({ name: "Error", message: 'Failed to find Server Action "abc". This request might be from an older or newer deployment.' })).toBe(true);
    expect(looksLikeStaleBuild({ name: "ChunkLoadError", message: "Loading chunk 123 failed." })).toBe(true);
    expect(looksLikeStaleBuild({ name: "Error", message: "Loading chunk 123 failed." })).toBe(true);
    expect(looksLikeStaleBuild({ name: "TypeError", message: "Cannot read properties of undefined" })).toBe(false);
  });
});
