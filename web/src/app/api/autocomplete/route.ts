import { streamText, type ModelMessage } from "ai";
import {
  autoCompleteAiModel,
  autoCompleteAiModels,
} from "@/lib/ai/openrouter";
import { autoCompletePrompt } from "@/lib/ai/autocomplete-prompt";

export const maxDuration = 10;

type RecentMessage = { role: "user" | "assistant"; text: string };

export async function POST(req: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return new Response("", { status: 200 });
  }
  const body = (await req.json()) as {
    draft?: string;
    recentMessages?: RecentMessage[];
  };
  const draft = body.draft ?? "";
  const recent = (body.recentMessages ?? []).filter(
    (m) => m && typeof m.text === "string" && m.text.trim().length > 0,
  );
  if (!draft || draft.trim().length < 3) {
    return new Response("", { status: 200 });
  }

  console.log("[autocomplete] request", {
    draftLen: draft.length,
    historyLen: recent.length,
  });

  // Prompt layout — cache-friendly: every byte BEFORE the final user
  // message is stable across a typing session, so providers that
  // support prefix caching (DeepSeek, Anthropic, OpenAI) can hit the
  // cache on every keystroke. The Anthropic-style cacheControl markers
  // are no-ops for providers that don't read them.
  //
  // The bulky system prompt goes through `system` (AI SDK's safe slot)
  // rather than the messages array — keeps the SDK from warning about
  // system-message injection risk. The history + draft go in messages.
  const messages: ModelMessage[] = [
    ...recent.map((m, i): ModelMessage => {
      const isLast = i === recent.length - 1;
      return {
        role: m.role,
        content: m.text,
        // Mark the final history message as a cache breakpoint so the
        // entire system + history prefix is cached on subsequent
        // keystrokes (Anthropic-style; no-op elsewhere).
        ...(isLast && {
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        }),
      };
    }),
    // The draft is the ONLY part that varies per keystroke.
    {
      role: "user",
      content: `Complete this in-progress message (output only the continuation, no prefix, no quotes, ${draft.endsWith(" ") ? "no leading space" : "start with a space if appropriate"}):\n${draft}`,
    },
  ];

  const result = streamText({
    model: autoCompleteAiModel,
    system: autoCompletePrompt,
    messages,
    maxOutputTokens: 64,
    // Hard guard against reasoning leak — some models think out loud
    // even with reasoning disabled. Stop at the first newline so any
    // chain-of-thought rambling gets cut off before it reaches the UI.
    stopSequences: ["\n", "\n\n", "**", "<thinking>", "User typed", "User wants"],
    providerOptions: {
      openrouter: {
        models: autoCompleteAiModels,
        reasoning: { enabled: false, exclude: true },
      },
    },
    onError: (e) => {
      console.error("[autocomplete] streamText onError", e);
    },
    onFinish: ({ text, finishReason, usage }) => {
      console.log("[autocomplete] streamText onFinish", {
        text,
        finishReason,
        usage,
      });
    },
  });
  return result.toTextStreamResponse();
}
