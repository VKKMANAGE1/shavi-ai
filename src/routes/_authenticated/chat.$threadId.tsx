import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { UIMessage } from "ai";
import { ChatWorkspace } from "@/components/chat-workspace";
import { getThread } from "@/lib/chat.functions";

export const Route = createFileRoute("/_authenticated/chat/$threadId")({
  head: () => ({ meta: [
    { title: "Conversation — VK AI" },
    { name: "description", content: "Your private VK AI conversation." },
    { property: "og:title", content: "Conversation — VK AI" },
    { property: "og:description", content: "Your private VK AI conversation." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }), component: ThreadPage,
});

function ThreadPage() {
  const { threadId } = Route.useParams();
  const [data, setData] = useState<{ title: string; messages: UIMessage[] }>();
  const [error, setError] = useState("");
  useEffect(() => { setData(undefined); setError(""); void getThread({ data: { threadId } }).then((result) => setData({ title: result.thread.title, messages: result.messages })).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not open this conversation.")); }, [threadId]);
  if (error) return <div className="flex h-dvh items-center justify-center bg-background text-sm text-destructive">{error}</div>;
  if (!data) return <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground">Opening conversation…</div>;
  return <ChatWorkspace initialMessages={data.messages} key={threadId} threadId={threadId} title={data.title} />;
}