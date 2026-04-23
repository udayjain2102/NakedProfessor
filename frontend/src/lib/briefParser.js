import { presets } from "../data/presets";

function parseNumber(text, pattern, fallback) {
  const match = text.match(pattern);
  return match ? Number(match[1]) : fallback;
}

export function inferFieldsFromBrief(brief, current) {
  const text = brief ?? "";
  const inferred = {
    load: parseNumber(text, /(\d+(?:\.\d+)?)\s*N\b/i, current.load),
    length: parseNumber(text, /(\d+(?:\.\d+)?)\s*mm\s*(?:reach|span|long|length)/i, current.length),
    width: parseNumber(text, /(\d+(?:\.\d+)?)\s*mm\s*(?:width|wide)/i, current.width),
    thickness: parseNumber(text, /(\d+(?:\.\d+)?)\s*mm\s*thick/i, current.thickness),
    hole: parseNumber(text, /(\d+(?:\.\d+)?)\s*mm\s*(?:bolt hole|hole)/i, current.hole),
    cycles: parseNumber(text, /(\d+(?:\.\d+)?)\s*cycles/i, current.cycles),
    temperature: parseNumber(text, /(\d+(?:\.\d+)?)\s*C\b/i, current.temperature),
    maxDeflection: parseNumber(text, /under\s*(\d+(?:\.\d+)?)\s*mm/i, current.maxDeflection)
  };

  const lower = text.toLowerCase();
  let material = current.material;
  if (lower.includes("stainless")) {
    material = "304 Stainless";
  } else if (lower.includes("titanium")) {
    material = "Ti-6Al-4V";
  } else if (lower.includes("7075")) {
    material = "7075-T6 Aluminum";
  } else if (lower.includes("6061")) {
    material = "6061-T6 Aluminum";
  } else if (lower.includes("steel")) {
    material = "A36 Steel";
  } else if (lower.includes("aluminum")) {
    material = "6061-T6 Aluminum";
  }

  return { ...current, ...inferred, material };
}

export function getDefaultInputs() {
  return { ...presets.hotArm };
}
