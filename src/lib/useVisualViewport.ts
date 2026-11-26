import { useEffect, useState } from "react";

interface VisualViewportState {
  keyboardOpen: boolean;
}

/**
 * Keeps the fixed mobile app shell full-bleed (100% height) on iOS Home-Screen
 * PWAs when the keyboard is closed (avoiding iOS WebKit's visualViewport.height
 * under-reporting safe-area insets), and locks cleanly to visualViewport only
 * while the software keyboard is open.
 */
export function useVisualViewport(): VisualViewportState {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    let rafId = 0;

    const syncNow = () => {
      rafId = 0;
      const layoutHeight = window.innerHeight;
      const vvHeight = vv ? Math.round(vv.height) : layoutHeight;
      const vvOffsetTop = vv ? Math.max(0, Math.round(vv.offsetTop)) : 0;

      // Only treat as keyboard-open when visualViewport shrinks substantially (> 130px)
      const kbOpen = layoutHeight - vvHeight > 130;
      setKeyboardOpen(kbOpen);
      root.classList.toggle("kb-open", kbOpen);

      if (kbOpen) {
        root.style.setProperty("--vvh", `${vvHeight}px`);
        root.style.setProperty("--vvt", `${vvOffsetTop}px`);
      } else {
        root.style.setProperty("--vvh", "100%");
        root.style.setProperty("--vvt", "0px");
      }

      if (window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };

    const scheduleSync = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(syncNow);
    };

    const handleFocusChange = () => {
      scheduleSync();
      window.setTimeout(scheduleSync, 120);
      window.setTimeout(scheduleSync, 320);
    };

    syncNow();

    if (vv) {
      vv.addEventListener("resize", scheduleSync);
      vv.addEventListener("scroll", scheduleSync);
    }
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("orientationchange", scheduleSync);
    window.addEventListener("focusin", handleFocusChange);
    window.addEventListener("focusout", handleFocusChange);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (vv) {
        vv.removeEventListener("resize", scheduleSync);
        vv.removeEventListener("scroll", scheduleSync);
      }
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("orientationchange", scheduleSync);
      window.removeEventListener("focusin", handleFocusChange);
      window.removeEventListener("focusout", handleFocusChange);
      root.classList.remove("kb-open");
    };
  }, []);

  return { keyboardOpen };
}
