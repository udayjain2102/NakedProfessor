export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function formatNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return "n/a";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

export function riskLevel(score) {
  if (score >= 75) return { label: "High risk", className: "risk-high" };
  if (score >= 45) return { label: "Medium", className: "risk-medium" };
  return { label: "Low", className: "risk-low" };
}
