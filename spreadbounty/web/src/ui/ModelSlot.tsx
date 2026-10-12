import type { Config } from "../api";
import { ModelChip } from "./ModelDialog";

/** The header's Writer chip and model dialog (A6, gamma's ModelChip). "This server" appears only when the operator enabled server AI. */
export function WriterChip({ config }: { config: Config | null }) {
  return <ModelChip serverAi={config?.ai ?? null} />;
}
