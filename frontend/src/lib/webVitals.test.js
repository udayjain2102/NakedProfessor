import { describe, expect, it, vi } from "vitest";
import { __internal } from "./webVitals";

describe("webVitals instrumentation", () => {
  it("creates route-aware metric payloads", () => {
    window.history.replaceState({}, "", "/app/select");

    const payload = __internal.createPayload({
      name: "LCP",
      value: 1200,
      rating: "good",
      id: "metric-1",
      delta: 1200,
      navigationType: "navigate",
    });

    expect(payload).toMatchObject({
      name: "LCP",
      value: 1200,
      rating: "good",
      id: "metric-1",
      path: "/app/select",
    });
  });

  it("dispatches a browser event for each metric", () => {
    const listener = vi.fn();
    window.addEventListener("np:web-vital", listener);

    __internal.emitMetric({
      name: "CLS",
      value: 0.01,
      rating: "good",
      id: "metric-2",
      path: "/app/select",
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toMatchObject({
      name: "CLS",
      id: "metric-2",
    });

    window.removeEventListener("np:web-vital", listener);
  });
});
