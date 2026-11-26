import { useEffect, useState } from "react";

interface VisualViewportState {
  keyboardOpen: boolean;
}

function isTextInputFocused(): boolean {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !["file", "checkbox", "radio", "button", "submit"].includes(el.type);
  }
  return false;
}

/**
 * Tracks a stable full-screen baseline height per orientation so iOS 16–26
 * Safari (where window.innerHeight can shrink alongside visualViewport) still
 * detects the software keyboard reliably, while keeping Home-Screen PWAs
 * full-bleed (100% height, zero bottom gap) when the keyboard is closed.
 */
export function useVisualViewport(): VisualViewportState {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    let rafId = 0;
    let baselineHeight = Math.max(
      window.innerHeight,
      vv ? Math.round(vv.height) : 0
    );

    const syncNow = () => {
      rafId = 0;
      const vvHeight = vv ? Math.round(vv.height) : window.innerHeight;
      const vvOffsetTop = vv ? Math.max(0, Math.round(vv.offsetTop)) : 0;
      const focused = isTextInputFocused();

      // Update baseline only when no text input is focused (keyboard closed)
      if (!focused) {
        baselineHeight = Math.max(baselineHeight, window.innerHeight, vvHeight);
      }

      const delta = baselineHeight - vvHeight;
      const kbOpen = delta > 110 || (focused && delta > 60);

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

    const handleOrientation = () => {
      baselineHeight = Math.max(window.innerHeight, vv ? Math.round(vv.height) : 0);
      window.setTimeout(() => {
        baselineHeight = Math.max(window.innerHeight, vv ? Math.round(vv.height) : 0);
        scheduleSync();
      }, 250);
    };

    const handleFocusChange = () => {
      scheduleSync();
      window.setTimeout(scheduleSync, 100);
      window.setTimeout(scheduleSync, 260);
      window.setTimeout(scheduleSync, 450);
    };

    syncNow();

    if (vv) {
      vv.addEventListener("resize", scheduleSync);
      vv.addEventListener("scroll", scheduleSync);
    }
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("orientationchange", handleOrientation);
    window.addEventListener("focusin", handleFocusChange);
    window.addEventListener("focusout", handleFocusChange);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (vv) {
        vv.removeEventListener("resize", scheduleSync);
        vv.removeEventListener("scroll", scheduleSync);
      }
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("orientationchange", handleOrientation);
      window.removeEventListener("focusin", handleFocusChange);
      window.removeEventListener("focusout", handleFocusChange);
      root.classList.remove("kb-open");
    };
  }, []);

  return { keyboardOpen };
}
