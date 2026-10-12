import { useState } from "react";
import { api, type Config, type Health } from "../api";
import { Dialog } from "./Dialog";

/**
 * A6 HOOK POINT (lane gamma). The header renders <WriterChip/>; clicking it opens the model dialog.
 *
 * Today the dialog body is ServerModelDialog: it shows the model this server was started with.
 * Gamma's web/src/ui/ModelDialog.tsx replaces it. Contract:
 *   export function ModelDialog(props: ModelDialogProps): JSX.Element   // renders <Dialog title="AI models">
 * Wiring is one line: change `const ModelDialogImpl = ServerModelDialog` below to the imported ModelDialog.
 * The chip text comes from `writerLabel(config)`; when the browser Writer exists, pass its label
 * ("Writer: gemma4 (browser)") through WriterChip's `label` prop from App.tsx.
 */
export interface ModelDialogProps { open: boolean; onClose: () => void; config: Config }

export const writerLabel = (config: Config | null) => {
  if (!config || config.ai.provider === "off") return "none";
  return config.ai.provider === "local" ? `${config.ai.model ?? "local"} (server)` : `Claude (server)`;
};

export function WriterChip({ config, label }: { config: Config | null; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="chip" onClick={() => setOpen(true)} aria-haspopup="dialog" title="Which model writes text. Models never score or pay.">
        Writer: <b>{label ?? writerLabel(config)}</b>
      </button>
      {config && <ModelDialogImpl open={open} onClose={() => setOpen(false)} config={config} />}
    </>
  );
}

function ServerModelDialog({ open, onClose, config }: ModelDialogProps) {
  const [health, setHealth] = useState<Health | null>(null);
  const [testing, setTesting] = useState(false);
  const ai = config.ai;
  const test = async () => {
    setTesting(true);
    setHealth(null);
    try {
      setHealth(await api.health());
    } catch (e: any) {
      setHealth({ ok: false, provider: ai.provider, reason: String(e?.message ?? e) });
    }
    setTesting(false);
  };
  return (
    <Dialog open={open} onClose={onClose} title="AI models">
      <p className="ink2">A model reads your request and explains numbers the code computed. It never scores or pays anyone. Every number it writes is checked against the data; an invented one sends the text back to a template.</p>
      <dl className="kv">
        <dt>Writer</dt><dd>{ai.provider === "local" ? "Local model, OpenAI-compatible, run by this server" : ai.provider === "claude" ? "Claude (Anthropic API), run by this server" : "None: rules and templates"}</dd>
        {ai.model && <><dt>Model</dt><dd className="mono">{ai.model}</dd></>}
        {ai.endpoint && <><dt>Endpoint</dt><dd className="mono">{ai.endpoint}</dd></>}
      </dl>
      {ai.provider !== "off" && (
        <div className="row">
          <button className="btn small" onClick={test} disabled={testing}>{testing ? "Testing…" : "Test connection"}</button>
          {health && (health.ok ? <span className="badge good">Answered in {health.latencyMs} ms</span> : <span className="badge bad">No answer</span>)}
        </div>
      )}
      {health && !health.ok && health.reason && <p className="note bad">{health.reason}</p>}
      <div className="stack" style={{ gap: 6 }}>
        <span className="label">Run with a local model</span>
        <div className="code-block">{`ollama pull gemma3:4b
AI_PROVIDER=local LOCAL_LLM_MODEL=gemma3:4b npm run serve

# LM Studio, llama.cpp, vLLM
LOCAL_LLM_URL=http://localhost:1234/v1 \\
AI_PROVIDER=local LOCAL_LLM_MODEL=<model id> npm run serve`}</div>
      </div>
    </Dialog>
  );
}

const ModelDialogImpl = ServerModelDialog;
