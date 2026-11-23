import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPublicAddress, UnsafeUrlError } from "@/lib/net/safe-fetch";

describe("the guarded fetch keeps the server off private networks", () => {
  it("knows the private, loopback, link-local and metadata ranges", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "192.168.0.9", "172.16.0.1", "172.31.255.255", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(isPublicAddress(a), a).toBe(false);
    for (const a of ["8.8.8.8", "151.101.1.69", "172.32.0.1", "2606:4700::1111"]) expect(isPublicAddress(a), a).toBe(true);
  });
  it("refuses literal addresses in every spelling the URL parser accepts", async () => {
    for (const u of ["http://127.0.0.1/", "http://2130706433/", "http://0x7f000001/", "http://[::1]/", "http://169.254.169.254/latest/meta-data/", "http://localhost/", "http://db.railway.internal:5432/", "http://metadata.google.internal/"]) {
      await expect(assertPublicUrl(new URL(u)), u).rejects.toBeInstanceOf(UnsafeUrlError);
    }
  });
  it("refuses anything but http and https", async () => {
    await expect(assertPublicUrl(new URL("ftp://example.com/"))).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});
