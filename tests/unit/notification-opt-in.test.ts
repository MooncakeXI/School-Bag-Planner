import { describe, expect, it } from "vitest";
import { requiresHomeScreenForPush } from "@/lib/notification-support";

describe("requiresHomeScreenForPush", () => {
  it("requires an iPhone browser tab to be installed, but allows the Home Screen app", () => {
    const iphone = {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      platform: "iPhone",
      maxTouchPoints: 5,
    };

    expect(requiresHomeScreenForPush({ ...iphone, standalone: false })).toBe(true);
    expect(requiresHomeScreenForPush({ ...iphone, standalone: true })).toBe(false);
  });
});
