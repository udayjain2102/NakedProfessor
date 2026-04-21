import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";

const WEB_VITALS_ENDPOINT = import.meta.env.VITE_WEB_VITALS_ENDPOINT || "";

function createPayload(metric) {
  if (typeof window === "undefined") return null;

  return {
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
    delta: metric.delta,
    navigationType: metric.navigationType,
    path: window.location.pathname,
    href: window.location.href,
    timestamp: Date.now(),
  };
}

function emitMetric(payload) {
  if (!payload || typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent("np:web-vital", {
      detail: payload,
    })
  );

  if (!WEB_VITALS_ENDPOINT) return;

  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    navigator.sendBeacon(WEB_VITALS_ENDPOINT, body);
    return;
  }

  fetch(WEB_VITALS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
    keepalive: true,
  }).catch(() => {
    /* ignore telemetry delivery failures */
  });
}

function handleMetric(metric) {
  emitMetric(createPayload(metric));
}

export function reportWebVitals() {
  onCLS(handleMetric);
  onFCP(handleMetric);
  onINP(handleMetric);
  onLCP(handleMetric);
  onTTFB(handleMetric);
}

export const __internal = {
  createPayload,
  emitMetric,
};
