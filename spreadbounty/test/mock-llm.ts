/**
 * A stand-in for a small local model behind an OpenAI-compatible endpoint, for demos and UI work without a GPU.
 * It behaves like a weak model on purpose: rejects json_schema, wraps JSON in prose, and its first draft of any
 * brief or report invents numbers, so you can watch the grounding guard reject it and accept the retry.
 *
 *   npm run mock:llm      then   AI_PROVIDER=local LOCAL_LLM_URL=http://localhost:11999/v1 LOCAL_LLM_MODEL=mock-gemma npm run serve
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_LLM_PORT ?? 11999);
createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const reply = (content: string) => res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
  if (!req.url?.endsWith("/chat/completions")) { res.statusCode = 404; return res.end("{}"); }
  const body = JSON.parse(raw || "{}");
  if (body.response_format?.type === "json_schema") { res.statusCode = 400; return res.end('{"error":"json_schema not supported"}'); }
  const sys: string = body.messages?.[0]?.content ?? "";
  const user: string = body.messages?.[1]?.content ?? "";
  if (sys.includes("single word")) return reply("ready");
  if (sys.includes("fill in a small form")) {
    const pair = /mon/i.test(user) ? "MON/USDC" : "AUSD/USDC";
    return reply(`Sure! \`\`\`json\n${JSON.stringify({ pair, bandBps: null, budgetPerDay: null, epochMinutes: 60, refPrice: pair === "AUSD/USDC" ? 1 : null, summary: user.slice(0, 120) })}\n\`\`\``);
  }
  const start = user.indexOf("{"), end = user.lastIndexOf("}");
  const f = JSON.parse(user.slice(start, end + 1));
  if (!user.includes("must not appear")) return reply("<think>estimating</think>This should land around 97.5% coverage and roughly 12,345 USDC of depth.");
  // the facts arrive with plain-word keys (src/ai/prompts.ts plainFacts)
  if (f.recommended) {
    const r = f.recommended;
    return reply(`Go with a ${r["band bps"]} bps band and a ${r["min rest blocks"]}-block minimum rest at ${f["budget per day USDC"]} USDC per day. Over the last ${f["last hours"]} hours ${f.history.makers} makers quoted, and this setting kept the book two-sided ${r["two sided coverage %"]}% of the time with about ${r["average depth USDC"]} USDC on the thinner side. Watch concentration: the top maker would take ${r["top maker share %"]}%.`);
  }
  const t = f["this epoch"], would = f.shadow ? "would have " : "";
  return reply(`Epoch ${t.epoch} kept ${f.pair} two-sided ${t["two sided coverage %"]}% of the time with ${t["average two sided depth USDC"]} USDC of depth on the thinner side, at ${t["cost per 1k depth USDC"]} USDC per $1k of depth. ${t["makers rewarded"]} makers ${would}shared the rewards and the largest ${f.shadow ? "would have taken" : "took"} ${t["top maker share %"]}%. Keep the band and see whether more makers join.`);
}).listen(PORT, () => console.log(`mock local model (OpenAI-compatible) on http://localhost:${PORT}/v1`));
