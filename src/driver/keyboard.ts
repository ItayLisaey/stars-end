/**
 * Hotkey string -> key sequence (US layout). Produces Playwright key names.
 *
 * US-layout hardcoded — known limitation.
 */

export interface KeySpec {
  key: string;
  /** Semantic command when a modifier + a/c/v is pressed. */
  command?: "SelectAll" | "Copy" | "Paste";
}

/** Alias map -> canonical Playwright key names. */
const KEY_ALIASES: Record<string, string> = {
  return: "Enter",
  enter: "Enter",
  esc: "Escape",
  escape: "Escape",
  del: "Delete",
  delete: "Delete",
  ins: "Insert",
  space: "Space",
  spacebar: "Space",
  tab: "Tab",
  backspace: "Backspace",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  ctrl: "Control",
  control: "Control",
  cmd: "Meta",
  command: "Meta",
  meta: "Meta",
  win: "Meta",
  super: "Meta",
  option: "Alt",
  opt: "Alt",
  alt: "Alt",
  shift: "Shift",
  pageup: "PageUp",
  "page up": "PageUp",
  pagedown: "PageDown",
  "page down": "PageDown",
  home: "Home",
  end: "End",
};

const MODIFIERS = new Set(["Control", "Meta", "Shift", "Alt"]);

function canonicalKey(token: string): string {
  const lower = token.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  // single letters: keep case as given (Playwright accepts 'a'/'A')
  if (token.length === 1) return token;
  // Named keys like Enter/Tab/F1: title-case first letter, leave rest
  return token;
}

/** Split a hotkey string into individual key tokens. */
function tokenize(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  // alias for a multi-word key (e.g. "page down") — match before splitting
  if (KEY_ALIASES[trimmed.toLowerCase()]) return [trimmed];
  // combos use '+' or whitespace as separators
  return trimmed
    .replace(/\s*\+\s*/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Parse a hotkey (e.g. `'Control+A'`, `'Enter'`, `['Meta', 'c']`) into an
 * ordered key sequence. Detects Meta/Ctrl + a/c/v as SelectAll/Copy/Paste.
 */
export function parseHotkey(input: string | string[]): KeySpec[] {
  const tokens = (Array.isArray(input) ? input : [input]).flatMap(tokenize).map(canonicalKey);

  const hasCtrlOrMeta = tokens.includes("Control") || tokens.includes("Meta");

  return tokens.map((key) => {
    if (hasCtrlOrMeta && (key === "a" || key === "A")) return { key, command: "SelectAll" };
    if (hasCtrlOrMeta && (key === "c" || key === "C")) return { key, command: "Copy" };
    if (hasCtrlOrMeta && (key === "v" || key === "V")) return { key, command: "Paste" };
    return { key };
  });
}

export const isModifierKey = (key: string): boolean => MODIFIERS.has(key);
