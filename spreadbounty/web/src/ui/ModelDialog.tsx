import { useEffect, useId, useRef, useState } from "react";
import type { Config } from "../api";
import { forgetKeys, getKey, loadSettings, saveSettings, setKey, SETTINGS_EVENT, type ModelSettings, type ProviderId } from "../ai/keys";
import "../ai/model-dialog.css";
import { endpointHost, listModels, LOCAL_PRESETS, PROVIDERS, testConnection, writerLabel } from "../ai/providers";

type ServerAi = Config["ai"] | null;
const BROWSER: ProviderId[] = ["anthropic", "openai", "gemini", "openrouter", "local"];

/** The Writer settings, kept fresh when the dialog (or another tab) changes them. */
export function useWriterSettings(): ModelSettings {
  const [s, set] = useState(loadSettings);
  useEffect(() => {
    const on = () => set(loadSettings());
    addEventListener(SETTINGS_EVENT, on);
    addEventListener("storage", on);
    return () => {
      removeEventListener(SETTINGS_EVENT, on);
      removeEventListener("storage", on);
    };
  }, []);
  return s;
}

/** Header chip that opens the dialog: "Writer: none", "Writer: gemma4 (browser)", "Writer: Claude (browser)". */
export function ModelChip({ serverAi }: { serverAi: ServerAi }) {
  const s = useWriterSettings();
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={chip} type="button" className="chip md-chip" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {writerLabel(s, serverAi?.model ?? null)}
      </button>
      <ModelDialog open={open} onClose={() => { setOpen(false); chip.current?.focus(); }} serverAi={serverAi} />
    </>
  );
}

export function ModelDialog({ open, onClose, serverAi }: { open: boolean; onClose: () => void; serverAi: ServerAi }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const s = useWriterSettings();
  const [key, setKeyText] = useState(() => getKey(s.provider));
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<"running" | Awaited<ReturnType<typeof testConnection>> | null>(null);
  const [models, setModels] = useState<{ list: string[]; error: string | null; busy: boolean }>({ list: [], error: null, busy: false });

  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
    if (!open && d?.open) d.close();
  }, [open]);
  useEffect(() => {
    setKeyText(getKey(s.provider));
    setTest(null);
    setModels({ list: [], error: null, busy: false });
  }, [s.provider, s.baseUrl]);

  const p = PROVIDERS[s.provider];
  const browser = BROWSER.includes(s.provider);
  const host = endpointHost(s);
  const serverOn = !!serverAi && serverAi.provider !== "off";
  const update = (patch: Partial<ModelSettings>) => {
    saveSettings({ ...s, ...patch });
    setTest(null);
  };
  const pick = (provider: ProviderId) =>
    update({ provider, model: PROVIDERS[provider].defaultModel, baseUrl: provider === "local" ? s.baseUrl || PROVIDERS.local.baseUrl : "" });
  const onKey = (v: string) => {
    setKeyText(v);
    setKey(s.provider, v, s.remember);
    setTest(null);
  };
  const runTest = async () => {
    setTest("running");
    setTest(await testConnection(s, key));
  };
  const runList = async () => {
    setModels({ list: [], error: null, busy: true });
    try {
      const list = await listModels(s, key);
      setModels({ list, error: list.length ? null : "The provider listed no models.", busy: false });
    } catch (e) {
      setModels({ list: [], error: String((e as Error)?.message ?? e), busy: false });
    }
  };

  return (
    <dialog
      ref={ref}
      className="md"
      aria-labelledby={`${id}-h`}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()} // backdrop click
    >
      <div className="md-head">
        <h2 id={`${id}-h`}>AI models</h2>
        <button type="button" className="btn ghost small" onClick={() => ref.current?.close()}>Close</button>
      </div>
      <p className="md-lede">Reads your request and explains numbers the code computed. Never scores or pays anyone.</p>

      <fieldset className="md-set">
        <legend className="label">Writer</legend>
        {(["none", ...(serverOn ? (["server"] as const) : []), ...BROWSER] as ProviderId[]).map((v) => (
          <label key={v} className="md-option">
            <input type="radio" name={`${id}-provider`} checked={s.provider === v} onChange={() => pick(v)} />
            <span>{v === "server" ? `This server: ${serverAi?.model ?? "server model"}` : PROVIDERS[v].label}</span>
          </label>
        ))}
      </fieldset>

      {s.provider === "none" && <p className="md-note">No model: the request is read by rules and the brief and reports use templates. Every number still comes from the code.</p>}
      {s.provider === "server" && <p className="md-note">The operator's model runs on this server, behind its rate limits. No key from you is involved.</p>}

      {browser && (
        <div className="md-form">
          {s.provider === "local" && (
            <>
              <div className="md-presets" role="group" aria-label="Local server presets">
                {LOCAL_PRESETS.map((x) => (
                  <button key={x.name} type="button" className="btn ghost small" aria-pressed={s.baseUrl === x.baseUrl} onClick={() => update({ baseUrl: x.baseUrl })}>{x.name}</button>
                ))}
              </div>
              <label className="md-field">
                <span className="label">Base URL</span>
                <input type="url" value={s.baseUrl} onChange={(e) => update({ baseUrl: e.target.value })} spellCheck={false} autoComplete="off" inputMode="url" />
              </label>
            </>
          )}

          <div className="md-field">
            <label className="label" htmlFor={`${id}-model`}>Model</label>
            <div className="md-inline">
              <input id={`${id}-model`} type="text" list={`${id}-models`} value={s.model} onChange={(e) => update({ model: e.target.value })} placeholder={p.defaultModel || "model id"} spellCheck={false} autoComplete="off" />
              <button type="button" className="btn ghost small" onClick={runList} disabled={models.busy || (p.needsKey && !key)}>{models.busy ? "Listing…" : "List models"}</button>
            </div>
            <datalist id={`${id}-models`}>{models.list.map((m) => <option key={m} value={m} />)}</datalist>
            {models.list.length > 0 && <span className="md-hint">{models.list.length} models listed; pick one from the field's suggestions.</span>}
            {models.error && <span className="md-error">{models.error}</span>}
          </div>

          <div className="md-field">
            <label className="label" htmlFor={`${id}-key`}>{p.needsKey ? "API key" : "API key (optional)"}</label>
            <div className="md-inline">
              <input id={`${id}-key`} type={showKey ? "text" : "password"} value={key} onChange={(e) => onKey(e.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="off" />
              <button type="button" className="btn ghost small" aria-pressed={showKey} onClick={() => setShowKey(!showKey)}>{showKey ? "Hide" : "Show"}</button>
            </div>
            <div className="md-inline">
              <label className="md-check">
                <input type="checkbox" checked={s.remember} onChange={(e) => update({ remember: e.target.checked })} />
                <span>Remember on this device</span>
              </label>
              <button type="button" className="btn ghost small" onClick={() => { forgetKeys(); setKeyText(""); }}>Forget key</button>
            </div>
            <p className="md-privacy">
              {key || p.needsKey ? `Your key goes from this browser to ${host}. This server never receives it.` : `Requests go from this browser to ${host}. This server never sees them.`}
              {key && (s.remember ? " The key stays on this device until you forget it." : " The key is forgotten when this tab closes.")}
            </p>
          </div>

          <div className="md-inline">
            <button type="button" className="btn small" onClick={runTest} disabled={test === "running"}>{test === "running" ? "Testing…" : "Test connection"}</button>
            <span role="status" aria-live="polite" className={test && test !== "running" ? (test.ok ? "md-ok" : "md-error") : "md-hint"}>
              {test === "running" && <><span className="spinner" aria-hidden /> Waiting for {host}</>}
              {test && test !== "running" && (test.ok ? `✓ Answered in ${test.latencyMs} ms · model ${test.model}` : `✕ ${test.message}`)}
            </span>
          </div>
        </div>
      )}
    </dialog>
  );
}
