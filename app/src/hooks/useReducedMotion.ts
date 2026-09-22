"use client";

/// The one JS-level reduced-motion check this codebase needs; every other animated effect is
/// plain CSS, covered by the global `@media (prefers-reduced-motion: reduce)` rule in
/// `globals.css`. SVG `<animate>`/`<animateMotion>` elements aren't reachable by that CSS rule
/// at all, so `CycleDiagram.tsx` reads this directly.

import { useEffect, useState } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  return reduced;
}
