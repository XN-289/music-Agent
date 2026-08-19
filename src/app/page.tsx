import { Suspense } from "react";
import { ChatView } from "@/components/chat/chat-view";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <ChatView />
    </Suspense>
  );
}
