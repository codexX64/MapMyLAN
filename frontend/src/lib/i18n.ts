// UI strings — multilingual.
//
// The language is chosen by the user (top bar or sign-in screen) and stored in
// the browser. A missing key falls back to English, then to the key itself, so
// a gap never breaks the display. Translations live in `i18n-data.ts`.

import { useSyncExternalStore } from "react";
import { LANGS, DICT } from "./i18n-data";

export { LANGS };
export type Lang = string;

const CODES = new Set(LANGS.map(l => l.code));
const KEY = "mapmylan_lang";

function dirOf(code: string): "ltr" | "rtl" {
  return (LANGS.find(l => l.code === code)?.dir as "ltr" | "rtl") ?? "ltr";
}

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && CODES.has(saved)) return saved;
  } catch { /* storage may be unavailable */ }
  const nav = (typeof navigator !== "undefined" ? navigator.language : "en") || "en";
  const short = nav.toLowerCase().split("-")[0];
  return CODES.has(short) ? short : "en";
}

let current: Lang = initial();
const listeners = new Set<() => void>();

function applyDocument(code: string) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = code;
  document.documentElement.dir = dirOf(code);
}
applyDocument(current);

export function getLang(): Lang { return current; }

export function setLang(l: Lang) {
  if (!CODES.has(l)) return;
  current = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  applyDocument(l);
  listeners.forEach(fn => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function translate(key: string, vars?: Record<string, string | number>): string {
  const out = DICT[current]?.[key] ?? DICT.en[key] ?? key;
  if (!vars) return out;
  return out.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

// Hook: re-renders the component when the language changes.
export function useT() {
  useSyncExternalStore(subscribe, getLang, getLang);
  return translate;
}

export function useLang(): [Lang, (l: Lang) => void] {
  const l = useSyncExternalStore(subscribe, getLang, getLang);
  return [l, setLang];
}
