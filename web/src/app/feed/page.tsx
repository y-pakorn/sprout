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
        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 flex-1 overflow-hidden md:border-r md:border-hairline">
            <FeedList />
          </div>
          <aside className="hidden min-h-0 shrink-0 md:flex md:w-[440px] lg:w-[480px]">
            <Conversation embedded />
          </aside>
        </div>
      </div>
      <FeedChatSheet className="md:hidden" />
    </CinematicShell>
  );
}
