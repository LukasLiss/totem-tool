/** Small pure helpers for the assistant chat (kept out of component files for fast refresh). */

/**
 * Repairs Latin-1 / Windows-1252 mojibake where UTF-8 bytes were misdecoded.
 * E.g., 'ð\x9f\x93\x8a' -> '📊'
 */
export function repairMojibake(text: string): string {
  if (!text) return "";
  if (!text.includes("ð") && !text.includes("â") && !text.includes("Ã")) {
    return text;
  }
  try {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      bytes[i] = text.charCodeAt(i) & 0xff;
    }
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (decoded && !decoded.includes("\ufffd")) {
      return decoded;
    }
  } catch {
    // fall back to the original text
  }
  return text;
}

/** Only these link targets become anchors; anything else (javascript:, data:, relative) stays plain text. */
export function isSafeHref(href: string | undefined): href is string {
  return !!href && /^(https?:\/\/|mailto:)/i.test(href.trim());
}

export function formatToolDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
