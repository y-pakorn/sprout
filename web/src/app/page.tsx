import { SiteHeader } from "@/components/site-header";
import { Conversation } from "@/components/conversation";

export default function Home() {
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Conversation />
      </main>
    </div>
  );
}
