// First-line chat filter. Runs on the server for every message, so it must be
// cheap and deterministic. It targets the scams common on Nigerian platforms:
// phone numbers, bank account numbers, and "move to WhatsApp/Telegram" lures.
// An AI classifier sits behind this in a later build (see research/02).

import { MAX_BIO, MAX_CHAT, MAX_NAME } from "./protocol";

export type Verdict = { ok: true; text: string } | { ok: false; reason: string };

const BANKS =
  /\b(opay|palm ?pay|moniepoint|kuda|gtb|gt ?bank|zenith|access|uba|first ?bank|fcmb|wema|sterling|fidelity|union ?bank|polaris|stanbic|ecobank|keystone)\b/i;
const OFF_PLATFORM = /\b(whats ?app|wa\.me|telegram|t\.me|snap(chat)?|dm me|inbox me|chat me up on)\b/i;
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|ng|net|org|io|me|xyz|link|ly)\b)/i;
const SPAM_WORDS = /\b(investment|forex|crypto|double your|binary option|loan offer|recharge card pin)\b/i;

function digitsOnly(text: string): string {
  // Catch "0 8 0 3..." and "o8o3..." style obfuscation.
  return text.replace(/[oO]/g, "0").replace(/[iIl|]/g, "1").replace(/\D/g, "");
}

export function moderateChat(raw: string): Verdict {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_CHAT);
  if (!text) return { ok: false, reason: "empty" };
  const digits = digitsOnly(text);
  if (/(234|0)[789][01]\d{8}/.test(digits) || digits.length >= 10) {
    return { ok: false, reason: "Numbers like phone or account numbers can't be shared in chat. Stay safe 🙏🏾" };
  }
  if (BANKS.test(text) && digits.length >= 6) {
    return { ok: false, reason: "Bank details can't be shared in chat. Stay safe 🙏🏾" };
  }
  if (OFF_PLATFORM.test(text) || LINK.test(text)) {
    return { ok: false, reason: "Links and off-game contacts are blocked for now. Gist here 😄" };
  }
  if (SPAM_WORDS.test(text)) {
    return { ok: false, reason: "That message looks like a scam pattern, so it wasn't sent." };
  }
  return { ok: true, text };
}

export function cleanName(raw: unknown): string {
  const s = String(raw ?? "").replace(/[^\p{L}\p{N} _.'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return s || "Guest";
}

export function cleanBio(raw: unknown): string {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_BIO);
  const v = moderateChat(s);
  return v.ok ? v.text : "";
}
