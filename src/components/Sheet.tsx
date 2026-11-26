import React from "react";
import { createPortal } from "react-dom";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  ariaLabelledBy?: string;
  children: React.ReactNode;
}

/**
 * Renders modal bottom sheets into document.body via a React Portal so they
 * always escape scrolling containers (like .main-scroll on iOS Safari) and sit
 * cleanly above both .topbar and .tabbar with reliable touch scrolling.
 */
export const Sheet: React.FC<SheetProps> = ({
  open,
  onClose,
  ariaLabelledBy,
  children,
}) => {
  if (!open) return null;

  return createPortal(
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaLabelledBy}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet">{children}</div>
    </div>,
    document.body
  );
};
