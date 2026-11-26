import { useEffect, useState } from "react";

interface VisualViewportState {
  keyboardOpen: boolean;
}

/**
 * Keeps the fixed mobile chat shell locked cleanly to the iOS VisualViewport
 * when the software keyboard opens or closes, preventing Safari from pushing
 * the header off-screen or requiring manual page scroll while typing.
 */
export function useVisualViewport(): VisualViewportState {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;

    const sync = () => {
      const height = vv ? Math.round(vv.height) : window.innerHeight;
      const offsetTop = vv ? Math.max(0, Math.round(vv.offsetTop)) : 0;
      root.style.setProperty("--vvh", `${height}px`);
      root.style.setProperty("--vvt", `${offsetTop}px`);

      const kbOpen = window.innerHeight - height > 120;
      setKeyboardOpen(kbOpen);
      root.classList.toggle("kb-open", kbOpen);

      if (kbOpen && window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };

    sync();

    if (vv) {
      vv.addEventListener("resize", sync);
      vv.addEventListener("scroll", sync);
    }
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);

    return () => {
      if (vv) {
        vv.removeEventListener("resize", sync);
        vv.removeEventListener("scroll", sync);
      }
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      root.classList.remove("kb-open");
    };
  }, []);

  return { keyboardOpen };
}
