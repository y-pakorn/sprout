import { Conversation } from "@/components/conversation";

export default function Home() {
  // Conversation owns its own header chrome — solid header in chat mode,
  // glass overlay in idle (hero) mode. Page is just the canvas.
  return (
    <main className="min-h-screen">
      <Conversation />
    </main>
  );
}
