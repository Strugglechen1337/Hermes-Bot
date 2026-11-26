import { hermesWs } from "./hermesWs";

/**
 * Loads a profile's native Hermes avatar via `profiles.get_asset`.
 * Returns a data URL (data:image/...) or null if none is set.
 */
export async function fetchBotAvatar(profileName: string): Promise<string | null> {
  try {
    const res = await hermesWs.call<{ found?: boolean; data?: string | null }>(
      "profiles.get_asset",
      { name: profileName, asset: "avatar" },
      10_000
    );
    if (res?.found && typeof res.data === "string" && res.data.startsWith("data:image/")) {
      return res.data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Stores a square avatar data URL natively in Hermes (`~/.hermes/profiles/<name>/assets/avatar.*`).
 */
export async function saveBotAvatar(profileName: string, dataUrl: string): Promise<void> {
  await hermesWs.call(
    "profiles.set_asset",
    { name: profileName, asset: "avatar", data: dataUrl },
    15_000
  );
}

/**
 * Removes a profile's custom avatar in Hermes.
 */
export async function clearBotAvatar(profileName: string): Promise<void> {
  await hermesWs.call(
    "profiles.set_asset",
    { name: profileName, asset: "avatar", clear: true },
    10_000
  );
}

/**
 * Center-crops and compresses any chosen image (including large iPhone photos)
 * into a crisp 320x320 JPEG data URL suitable for Hermes profile assets.
 */
export async function prepareAvatarDataUrl(file: File, size = 320): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Bild konnte nicht gelesen werden."));
      el.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas nicht verfügbar.");

    const minSide = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const sx = ((img.naturalWidth || img.width) - minSide) / 2;
    const sy = ((img.naturalHeight || img.height) - minSide) / 2;

    ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    if (!dataUrl.startsWith("data:image/jpeg;base64,")) {
      throw new Error("Bildformat konnte nicht konvertiert werden.");
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
