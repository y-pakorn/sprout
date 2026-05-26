import { CinematicShell } from "@/components/parts/cinematic-shell";
import { Conversation } from "@/components/conversation";
import { FeedList } from "@/components/parts/feed-list";
import { FeedChatSheet } from "@/components/parts/feed-chat-sheet";

export default function FeedPage() {
  // Chrome (bg + header) persists from app/layout.tsx. This page lays out the
  // live activity feed (left) beside the agent chat (right on desktop, a
  // bottom sheet on mobile).
  return (
    <CinematicShell mode="dim">
      <div className="flex h-dvh flex-col pt-16">
        <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1">
          {/* Timeline column — fixed-width white panel, like a Twitter feed */}
          <div className="min-h-0 flex-1 overflow-hidden border-x border-hairline bg-canvas-white">
            <FeedList />
          </div>
          {/* Chat right rail */}
          <aside className="hidden min-h-0 w-96 shrink-0 md:flex">
            <Conversation embedded />
          </aside>
        </div>
      </div>
      <FeedChatSheet className="md:hidden" />
    </CinematicShell>
  );
}
