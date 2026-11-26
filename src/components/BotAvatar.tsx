import React from "react";
import type { BotVisualIdentity } from "../lib/botTheme";

interface BotAvatarProps {
  visual: BotVisualIdentity;
  imageUrl?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  online?: boolean;
  showStatus?: boolean;
  className?: string;
}

export const BotAvatar: React.FC<BotAvatarProps> = ({
  visual,
  imageUrl,
  size = "md",
  online = false,
  showStatus = false,
  className = "",
}) => {
  const sizeClass = size === "md" ? "" : size;

  return (
    <div
      className={`avatar ${sizeClass} ${className}`.trim()}
      style={imageUrl ? { background: "#14161b" } : { background: visual.gradient }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={visual.label}
          className="avatar-img"
        />
      ) : (
        <span>{visual.initials}</span>
      )}
      {showStatus && (
        <span
          className={`avatar-status ${online ? "online" : ""}`}
          title={online ? "Aktiv" : "Offline"}
        />
      )}
    </div>
  );
};
