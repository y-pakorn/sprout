import "server-only";
import { generateText } from "ai";
import { aiModel, aiModels } from "@/lib/ai/openrouter";
import type { PtbExplainRequest } from "@/lib/ptb-explain";
import type { PtbView } from "@/lib/ptb-view";
import type { ResolvedStep } from "@/lib/ai/action-plan-cache";

export const maxDuration = 30;

const SYSTEM = `You explain a Sui Programmable Transaction Block (PTB) in plain, friendly English for someone about to sign it.

Hard rules:
- Ground EVERY statement in the provided structure and the verified plan steps. Do not invent token amounts, package semantics, or behavior.
- For Move calls into known protocols (the Ember gateway, the Sui framework) explain what they do. For unknown third-party packages (e.g. a DEX router injected by the aggregator), say "third-party DEX call" and describe it only from its module::function name and arguments — never guess hidden behavior.
- Be concise and concrete. Reference how outputs flow between commands when relevant ("the coin from step 2 is deposited in step 3").
- Never include private keys, addresses in full, or speculation about risk beyond what the data shows.`;

function argRefText(ref: PtbView["commands"][number]["args"][number]["ref"]): string {
  switch (ref.kind) {
    case "gas":
      return "GasCoin";
    case "input":
      return `Input ${ref.index}`;
    case "result":
      return `result of #${ref.index + 1}`;
    case "nestedResult":
      return `#${ref.cmd + 1}.${ref.out}`;
  }
}

function describeView(view: PtbExplainRequest["view"]): string {
  const inputs = view.inputs
    .map((i) => {
      const label = i.label ? ` [${i.label}]` : "";
      const approx = i.approxDecode ? " (approx)" : "";
      return `  Input ${i.index} (${i.kind}): ${i.display}${label}${approx}`;
    })
    .join("\n");

  const commands = view.commands
    .map((c) => {
      const tgt = c.target
        ? ` target=${c.target.packageLabel ?? c.target.packageShort}::${c.target.module}::${c.target.function}${c.target.typeArguments.length ? `<${c.target.typeArguments.join(", ")}>` : ""}`
        : "";
      const args = c.args
        .map((a) => (a.role ? `${a.role}=${argRefText(a.ref)}` : argRefText(a.ref)))
        .join(", ");
      return `  #${c.index + 1} ${c.kind}${tgt} args(${args})`;
    })
    .join("\n");

  return `INPUTS:\n${inputs || "  (none)"}\n\nCOMMANDS (in execution order):\n${commands || "  (none)"}`;
}

// Strip heavy/raw fields so the verified semantics stay small + grounded.
function pruneSteps(steps?: ResolvedStep[]): unknown[] {
  if (!steps?.length) return [];
  return steps.map((s) => {
    const { ...rest } = s as Record<string, unknown>;
    delete rest.quote;
    delete rest.fromIcon;
    delete rest.toIcon;
    return rest;
  });
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return json({ error: "OPENROUTER_API_KEY is not set." }, 500);
  }

  let body: PtbExplainRequest;
  try {
    body = (await req.json()) as PtbExplainRequest;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (!body?.view?.commands) return json({ error: "Missing PTB view." }, 400);

  const structure = describeView(body.view);
  const steps = pruneSteps(body.steps);
  const stepsBlock = steps.length
    ? `\n\nVERIFIED PLAN STEPS (source of truth for amounts / vault names / providers):\n${JSON.stringify(steps)}`
    : "";

  const isFocus = typeof body.focusCommand === "number";

  const prompt = isFocus
    ? `Explain command #${(body.focusCommand as number) + 1} of this Sui transaction in 2-4 plain sentences. What does it do, what does it read, what does it produce?\n\n${structure}${stepsBlock}\n\nReturn ONLY a JSON object: {"explanation": "..."}`
    : `Explain this Sui transaction.\n\n${structure}${stepsBlock}\n\nReturn ONLY a JSON object of the form {"summary": "2-3 sentence plain-English overview of the whole transaction", "commands": [{"index": 0, "plain": "one short sentence for command #1"}, ...]} with one entry per command in order.`;

  try {
    const { text } = await generateText({
      model: aiModel,
      system: SYSTEM,
      prompt,
      maxOutputTokens: 1024,
      abortSignal: req.signal,
      providerOptions: {
        openrouter: { reasoning: { enabled: false, exclude: true }, models: aiModels },
      },
    });

    const parsed = extractJson(text);
    if (isFocus) {
      const explanation =
        (parsed as { explanation?: string } | null)?.explanation ?? text.trim();
      return json({ explanation });
    }
    const p = parsed as { summary?: string; commands?: unknown } | null;
    return json({
      summary: p?.summary ?? text.trim(),
      commands: Array.isArray(p?.commands) ? p.commands : [],
    });
  } catch (e) {
    console.error("[api/explain-ptb] error", e);
    return json({ error: "Explanation failed. The deterministic view is still accurate." }, 502);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
