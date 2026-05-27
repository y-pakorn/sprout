import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { chatModel, aiModels } from "@/lib/ai/openrouter";
import { isKnownModel, defaultModelId } from "@/lib/ai/pricing";
import { systemPrompt } from "@/lib/ai/system-prompt";
import { swapTools } from "@/lib/ai/tools";
import { MAX_USER_MESSAGE_CHARS } from "@/lib/chat-limits";

export const maxDuration = 60;

// The client (useChat) replays the whole conversation each request, so it grows
// unbounded over a session. Only forward the most recent turns to the model.
const MAX_MESSAGES = 10;

export async function POST(req: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return new Response(
      JSON.stringify({
        error:
          "OPENROUTER_API_KEY is not set. Add it to web/.env.local and restart the dev server.",
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  const {
    messages: incoming = [],
    model: requestedModel,
    walletAddress = null,
  }: {
    messages?: UIMessage[];
    model?: string;
    walletAddress?: string | null;
  } = await req.json();

  // The client picks a model in the input; validate it against the pricing
  // table (never trust an arbitrary id) and fall back to the default.
  const modelId =
    requestedModel && isKnownModel(requestedModel)
      ? requestedModel
      : defaultModelId();

  // Keep only the most recent messages, starting at a user turn so the model
  // context begins cleanly (never on a dangling assistant/tool message).
  let messages = incoming.slice(-MAX_MESSAGES);
  const firstUser = messages.findIndex((m) => m.role === "user");
  if (firstUser > 0) messages = messages.slice(firstUser);

  // Clamp each user message's text so a single message can't spam the model.
  messages = messages.map((m) =>
    m.role !== "user"
      ? m
      : {
          ...m,
          parts: m.parts.map((p) =>
            p.type === "text"
              ? { ...p, text: p.text.slice(0, MAX_USER_MESSAGE_CHARS) }
              : p
          ),
        }
  );

  const startedAt = Date.now();

  // Inject per-request context (connected wallet + current time) onto the
  // LATEST user message instead of the system prompt. The system prompt is a
  // stable cached prefix; appending dynamic data there would bust the cache on
  // every turn. The newest user message is never cached, so this is free.
  const modelMessages = await convertToModelMessages(messages);
  const context =
    `<context>\n` +
    (walletAddress
      ? `Connected wallet: ${walletAddress}`
      : `No wallet connected.`) +
    `\nCurrent time: ${new Date().toISOString()}\n</context>`;
  for (let i = modelMessages.length - 1; i >= 0; i--) {
    const m = modelMessages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") {
      m.content = `${m.content}\n\n${context}`;
    } else {
      m.content = [...m.content, { type: "text", text: `\n\n${context}` }];
    }
    break;
  }

  const result = streamText({
    model: chatModel(modelId),
    system: systemPrompt,
    messages: modelMessages,
    tools: swapTools,
    stopWhen: ({ steps }) => steps.length >= 10,
    // Plenty of output budget so tool-call args don't get truncated.
    maxOutputTokens: 8192,
    // Stop the upstream model call the moment the client disconnects (tab
    // closed, navigated away, or useChat.stop()). Next.js aborts req.signal
    // on disconnect; forwarding it here cancels the in-flight LLM request so
    // we don't keep generating (and billing) for a stream nobody's reading.
    abortSignal: req.signal,
    onAbort: () => {
      console.log("[api/chat] aborted by client disconnect");
    },
    onError: (e) => {
      console.error("[api/chat] streamText error", e);
    },
    onFinish: ({ finishReason, usage }) => {
      console.log("[api/chat] finish", { finishReason, usage });
    },
    providerOptions: {
      openrouter: {
        // Reasoning OFF. hy3-preview is a reasoning model; with CoT on,
        // hidden tokens eat the output budget mid-stream and tool-call
        // args get truncated. For multi-step plans, accurate tool args
        // matter more than the model thinking aloud.
        reasoning: { enabled: false, exclude: true },
        models: aiModels,
      },
    },
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
    // Attach usage + duration to the message metadata on the final
    // 'finish' chunk so the client can render a cost/duration footer.
    messageMetadata: ({ part }) => {
      if (part.type === "finish") {
        return {
          usage: {
            inputTokens: part.totalUsage?.inputTokens,
            outputTokens: part.totalUsage?.outputTokens,
            cachedInputTokens: part.totalUsage?.cachedInputTokens,
            totalTokens: part.totalUsage?.totalTokens,
            model: modelId.replace(":free", ""),
          },
          durationMs: Date.now() - startedAt,
        };
      }
    },
  });
}
