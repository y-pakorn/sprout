"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, MessageCircle } from "lucide-react";
import { Conversation } from "@/components/conversation";
import { subscribeAskSprout } from "@/lib/ask-sprout";
import { cn } from "@/lib/utils";

/**
 * Mobile-only chat panel pinned to the bottom. A persistent "drawer head"
 * (h-16) is always visible; tapping it expands the panel to ~92dvh. The panel
 * is always mounted (we only animate its height + clip the overflow), so
 * <Conversation> — and its chat session — survives collapse/expand instead of
 * resetting.
 */
export function FeedChatSheet({ className }: { className?: string }) {
  const [expanded, setExpanded] = useState(false);

  // Auto-expand when a feed post asks Sprout something (mobile only).
  useEffect(
    () =>
      subscribeAskSprout(() => {
        if (!window.matchMedia("(min-width: 768px)").matches) setExpanded(true);
      }),
    [],
  );

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-card bg-canvas-white shadow-header transition-[height] duration-300 ease-out",
        expanded ? "h-[92dvh]" : "h-16",
        className
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-label={expanded ? "Collapse chat" : "Expand chat"}
        aria-expanded={expanded}
        className="flex h-16 shrink-0 items-center gap-2 px-5 text-left"
      >
        <MessageCircle className="size-4 text-midnight-ink" strokeWidth={2.2} />
        <span className="text-body-sm font-medium text-midnight-ink">
          Ask Sprout
        </span>
        {expanded ? (
          <ChevronDown
            className="ml-auto size-4 text-muted-ash"
            strokeWidth={2.4}
          />
        ) : (
          <ChevronUp
            className="ml-auto size-4 text-muted-ash"
            strokeWidth={2.4}
          />
        )}
      </button>
      <div className="min-h-0 flex-1 overflow-hidden border-t border-hairline">
        <Conversation embedded surface="sheet" />
      </div>
    </div>
  );
}
