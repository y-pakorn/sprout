import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { aiModel, aiModels } from "@/lib/ai/openrouter";
import { systemPrompt } from "@/lib/ai/system-prompt";
import { swapTools } from "@/lib/ai/tools";

export const maxDuration = 60;

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

  const { messages }: { messages: UIMessage[] } = await req.json();

  const startedAt = Date.now();

  const result = streamText({
    model: aiModel,
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
    tools: swapTools,
    stopWhen: ({ steps }) => steps.length >= 10,
    // Plenty of output budget so tool-call args don't get truncated.
    maxOutputTokens: 8192,
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
          },
          durationMs: Date.now() - startedAt,
        };
      }
    },
  });
}
