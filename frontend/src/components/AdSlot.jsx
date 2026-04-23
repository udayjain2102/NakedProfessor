import { useEffect, useRef } from "react";

const ADSENSE_CLIENT = "ca-pub-5068079947571403";
const ADSENSE_SCRIPT_ID = "np-adsense-script";

function ensureAdsenseScript() {
  if (typeof document === "undefined") return null;

  const existingScript = document.getElementById(ADSENSE_SCRIPT_ID);
  if (existingScript) return existingScript;

  const script = document.createElement("script");
  script.id = ADSENSE_SCRIPT_ID;
  script.async = true;
  script.crossOrigin = "anonymous";
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
  document.head.appendChild(script);
  return script;
}

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

    ensureAdsenseScript();
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
