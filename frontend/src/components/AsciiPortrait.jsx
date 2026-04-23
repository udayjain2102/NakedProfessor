import { useMemo } from "react";
import { generateAsciiPortrait } from "../lib/asciiPortrait";

export default function AsciiPortrait({ seed, label, className = "" }) {
  const lines = useMemo(() => generateAsciiPortrait(seed), [seed]);
  const classes = ["np-ascii-portrait", className].filter(Boolean).join(" ");

  return (
    <pre className={classes} role="img" aria-label={label ? `ASCII portrait of ${label}` : "ASCII portrait"}>
      {lines.join("\n")}
    </pre>
  );
}
