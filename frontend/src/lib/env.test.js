import { describe, expect, it, vi } from "vitest";
import { getRequiredEnv } from "./env";

describe("getRequiredEnv", () => {
  it("returns a configured environment value", () => {
    vi.stubEnv("VITE_TEST_VALUE", "configured");
    expect(getRequiredEnv("VITE_TEST_VALUE")).toBe("configured");
    vi.unstubAllEnvs();
  });

  it("throws a clear error when a required variable is missing", () => {
    vi.unstubAllEnvs();
    expect(() => getRequiredEnv("VITE_MISSING_VALUE")).toThrow(
      "Missing required environment variable: VITE_MISSING_VALUE"
    );
  });
});
