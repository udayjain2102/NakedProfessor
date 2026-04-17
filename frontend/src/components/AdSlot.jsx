import { useEffect, useRef } from "react";

const ADSENSE_CLIENT = "ca-pub-5068079947571403";

export default function AdSlot({
  slot,
  className = "",
  format = "auto",
  responsive = true,
  minHeight = 120,
}) {
  const pushedRef = useRef(false);

  useEffect(() => {
    if (!slot || pushedRef.current || typeof window === "undefined") return;

    window.adsbygoogle = window.adsbygoogle || [];
    window.adsbygoogle.push({});
    pushedRef.current = true;
  }, [slot]);

  if (!slot) return null;

  return (
    <aside className={`np-ad-slot ${className}`.trim()} aria-label="Advertisement">
      <div className="np-ad-label">Advertisement</div>
      <ins
        className="adsbygoogle np-ad-unit"
        style={{ display: "block", minHeight }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive={responsive ? "true" : "false"}
      />
    </aside>
  );
}
