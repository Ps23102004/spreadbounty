/**
 * Browser-only model settings and API keys. Nothing in this file is ever sent to this app's server
 * (web/src/api.ts may not import it: test/boundary.test.ts).
 *   - preferences (provider, model id, local base URL): localStorage, they hold no secret
 *   - keys: sessionStorage, gone when the tab closes; also localStorage only after "Remember on this device"
 *   - one key slot per provider, so a key typed for one provider is never sent to another
 * Every storage call is guarded: private windows and blocked site data just mean nothing is remembered.
 */
export type ProviderId = "none" | "server" | "anthropic" | "openai" | "gemini" | "openrouter" | "local";
export const PROVIDER_IDS: ProviderId[] = ["none", "server", "anthropic", "openai", "gemini", "openrouter", "local"];

export interface ModelSettings {
  provider: ProviderId;
  model: string;
  baseUrl: string; // used by Local only; cloud providers have fixed endpoints
  remember: boolean;
}
export const DEFAULT_SETTINGS: ModelSettings = { provider: "none", model: "", baseUrl: "", remember: false };
export const SETTINGS_EVENT = "sb-model-change";

const PREFS = "sb-model";
const keyName = (p: ProviderId) => `sb-model-key:${p}`;
const area = (which: "local" | "session"): Storage | null => {
  try {
    return which === "local" ? globalThis.localStorage : globalThis.sessionStorage;
  } catch {
    return null;
  }
};
const read = (which: "local" | "session", k: string) => {
  try {
    return area(which)?.getItem(k) ?? null;
  } catch {
    return null;
  }
};
const write = (which: "local" | "session", k: string, v: string | null) => {
  try {
    if (v === null) area(which)?.removeItem(k);
    else area(which)?.setItem(k, v);
  } catch {
    /* storage unavailable: the setting lasts until reload */
  }
};
const changed = () => globalThis.dispatchEvent?.(new Event(SETTINGS_EVENT));

export function loadSettings(): ModelSettings {
  try {
    const s = { ...DEFAULT_SETTINGS, ...JSON.parse(read("local", PREFS) ?? "{}") } as ModelSettings;
    return PROVIDER_IDS.includes(s.provider) ? s : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: ModelSettings) {
  write("local", PREFS, JSON.stringify(s));
  // the Remember box applies to the stored key too
  const key = getKey(s.provider);
  if (key) write("local", keyName(s.provider), s.remember ? key : null);
  changed();
}

export const getKey = (p: ProviderId) => read("session", keyName(p)) ?? read("local", keyName(p)) ?? "";

export function setKey(p: ProviderId, key: string, remember: boolean) {
  const v = key.trim() || null;
  write("session", keyName(p), v);
  write("local", keyName(p), remember ? v : null);
  changed();
}

/** "Forget key": every provider's key, from both stores. */
export function forgetKeys() {
  for (const p of PROVIDER_IDS) {
    write("session", keyName(p), null);
    write("local", keyName(p), null);
  }
  changed();
}
