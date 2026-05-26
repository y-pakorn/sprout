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
      <div className="flex h-dvh flex-col px-6 pb-6 pt-20">
        <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 gap-6">
          {/* Timeline — contained white panel with divided rows */}
          <div className="min-h-0 flex-1 overflow-hidden surface-card rounded-card">
            <FeedList />
          </div>
          {/* Chat right rail */}
          <aside className="hidden min-h-0 w-[400px] shrink-0 md:flex lg:w-[460px]">
            <Conversation embedded surface="rail" />
          </aside>
        </div>
      </div>
      <FeedChatSheet className="md:hidden" />
    </CinematicShell>
  );
}
