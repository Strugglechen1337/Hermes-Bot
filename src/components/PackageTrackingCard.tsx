import React, { useState } from "react";
import { Check, Copy, ExternalLink, Home, Package, ShoppingBag, Truck } from "lucide-react";
import type { DetectedPackageCard } from "../lib/secretDetection";

interface PackageTrackingCardProps {
  pkg: DetectedPackageCard;
}

function getCarrierAccent(carrier: string): { bg: string; fg: string; short: string } {
  const c = carrier.trim().toLowerCase();
  if (c.includes("dhl")) return { bg: "#ffcc00", fg: "#b91c1c", short: "DHL" };
  if (c.includes("dpd")) return { bg: "#dc2626", fg: "#ffffff", short: "DPD" };
  if (c.includes("hermes")) return { bg: "#0284c7", fg: "#ffffff", short: "Hermes" };
  if (c.includes("ups")) return { bg: "#78350f", fg: "#fbbf24", short: "UPS" };
  if (c.includes("gls")) return { bg: "#1d4ed8", fg: "#fde047", short: "GLS" };
  if (c.includes("amazon")) return { bg: "#f59e0b", fg: "#090b10", short: "AMZ" };
  return { bg: "#334155", fg: "#f8fafc", short: carrier.slice(0, 6) || "Paket" };
}

export const PackageTrackingCard: React.FC<PackageTrackingCardProps> = ({ pkg }) => {
  const [copied, setCopied] = useState(false);
  const accent = getCarrierAccent(pkg.carrier);
  const isDelivered = pkg.progress >= 100;

  return (
    <div className="package-card" aria-label={`Paketverfolgung: ${pkg.product}`}>
      <div className="package-card-top">
        <div className="package-card-shop">
          <span className="package-shop-icon" aria-hidden="true">
            <ShoppingBag size={13} />
          </span>
          <span className="package-shop-name">{pkg.shop}</span>
        </div>
        {pkg.eta && <span className="package-eta">{pkg.eta}</span>}
      </div>

      <div className="package-status">{pkg.status}</div>
      <div className="package-product">{pkg.product}</div>

      {(pkg.orderNumber || pkg.trackingNumber) && (
        <div className="package-meta-row">
          {pkg.orderNumber && <span>Bestellung {pkg.orderNumber}</span>}
          {pkg.orderNumber && pkg.trackingNumber && <span>·</span>}
          {pkg.trackingNumber && (
            <button
              type="button"
              className="package-copy-num"
              onClick={() => {
                void navigator.clipboard?.writeText(pkg.trackingNumber!).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                });
              }}
            >
              <span>{pkg.trackingNumber}</span>
              {copied ? <Check size={11} /> : <Copy size={11} />}
            </button>
          )}
        </div>
      )}

      <div className="package-progress-wrap" aria-label={`Fortschritt ${pkg.progress}%`}>
        <div className="package-progress-track">
          <div
            className="package-progress-fill"
            style={{ width: `${pkg.progress}%` }}
          />
        </div>
        <span
          className="package-node carrier"
          style={{ background: accent.bg, color: accent.fg }}
          title={pkg.carrier}
        >
          {accent.short}
        </span>
        <span
          className={`package-node transit${pkg.progress >= 50 ? " active" : ""}`}
          style={{ left: `${Math.min(Math.max(pkg.progress, 22), 86)}%` }}
          aria-hidden="true"
        >
          {pkg.progress >= 80 ? <Truck size={14} /> : <Package size={14} />}
        </span>
        <span className={`package-node home${isDelivered ? " active" : ""}`} aria-hidden="true">
          <Home size={14} />
        </span>
      </div>

      <div className="package-actions">
        {pkg.trackingUrl && (
          <a
            href={pkg.trackingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="package-track-btn"
          >
            <span>Bei {pkg.carrier} verfolgen</span>
            <ExternalLink size={13} />
          </a>
        )}
      </div>
    </div>
  );
};
