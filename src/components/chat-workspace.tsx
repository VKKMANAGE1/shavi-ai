import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Link, useNavigate } from "@tanstack/react-router";
import { BrainCircuit, Check, Copy, Download, LogOut, Menu, MessageSquare, Moon, MoreHorizontal, Pencil, Plus, Search, Sun, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageAction, MessageActions, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { createThread, deleteThread, listThreads, renameThread } from "@/lib/chat.functions";
import { supabase } from "@/integrations/supabase/client";

type Thread = Awaited<ReturnType<typeof listThreads>>[number];

export function ChatWorkspace({ threadId, initialMessages = [], title = "New conversation" }: { threadId?: string; initialMessages?: UIMessage[]; title?: string }) {
  const navigate = useNavigate();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [filter, setFilter] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const [input, setInput] = useState("");
  const [currentTitle, setCurrentTitle] = useState(title);
  const [dark, setDark] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat", headers: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
  }, body: { threadId } }), [threadId]);
  const { messages, sendMessage, status, stop, error } = useChat({ id: threadId ?? "chat-home", messages: initialMessages, transport, onFinish: () => { void refreshThreads(); inputRef.current?.focus(); }, onError: (err) => toast.error(err.message) });
  const busy = status === "submitted" || status === "streaming";

  async function refreshThreads() { try { setThreads(await listThreads()); } catch { /* auth gate handles this */ } }
  useEffect(() => { void refreshThreads(); }, [threadId]);
  useEffect(() => { inputRef.current?.focus(); }, [threadId, status]);
  useEffect(() => { setDark(document.documentElement.classList.contains("dark")); }, []);
  useEffect(() => { if (!threadId) return; const key = `vk-ai-prompt-${threadId}`; const pending = sessionStorage.getItem(key); if (pending) { sessionStorage.removeItem(key); void sendMessage({ text: pending }); setCurrentTitle(pending.slice(0, 54)); } }, [threadId]);

  async function newChat() { try { const created = await createThread(); await refreshThreads(); void navigate({ to: "/chat/$threadId", params: { threadId: created.id } }); setSidebar(false); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not start a conversation."); } }
  async function remove(id: string) { await deleteThread({ data: { threadId: id } }); await refreshThreads(); if (id === threadId) void navigate({ to: "/chat" }); }
  async function rename(id: string, oldTitle: string) { const next = window.prompt("Rename conversation", oldTitle)?.trim(); if (!next) return; await renameThread({ data: { threadId: id, title: next } }); await refreshThreads(); }
  async function signOut() { await supabase.auth.signOut(); void navigate({ to: "/auth" }); }
  function toggleTheme() { document.documentElement.classList.toggle("dark"); setDark(document.documentElement.classList.contains("dark")); }
  function exportChat() { const markdown = messages.map((message) => `## ${message.role === "user" ? "You" : "VK AI"}\n\n${message.parts.filter((part) => part.type === "text").map((part) => part.text).join("")}`).join("\n\n---\n\n"); const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${currentTitle.replace(/[^a-z0-9 -]/gi, "").slice(0, 40) || "conversation"}.md`; anchor.click(); URL.revokeObjectURL(url); }
  async function submit({ text }: { text: string }) { const value = text.trim(); if (!value || busy) return; if (!threadId) { try { const created = await createThread(); sessionStorage.setItem(`vk-ai-prompt-${created.id}`, value); void navigate({ to: "/chat/$threadId", params: { threadId: created.id } }); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not start a conversation."); } return; } setInput(""); if (currentTitle === "New conversation") setCurrentTitle(value.slice(0, 54)); await sendMessage({ text: value }); }
  const visibleThreads = threads.filter((thread) => thread.title.toLowerCase().includes(filter.toLowerCase()));

  return <div className="flex h-dvh bg-background text-foreground">
    {sidebar && <Button aria-label="Close sidebar" className="fixed inset-0 z-30 h-auto w-auto rounded-none bg-foreground/40 lg:hidden" variant="ghost" onClick={() => setSidebar(false)} />}
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-sidebar-border bg-sidebar transition-transform lg:static lg:translate-x-0 ${sidebar ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-16 items-center justify-between px-4"><Link className="flex items-center gap-2.5" to="/chat"><div className="grid size-8 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground"><BrainCircuit className="size-4" /></div><span className="font-display font-bold">VK AI</span></Link><Button aria-label="Close sidebar" className="lg:hidden" size="icon-sm" variant="ghost" onClick={() => setSidebar(false)}><X /></Button></div>
      <div className="px-3"><Button className="h-10 w-full justify-start" onClick={newChat}><Plus />New conversation</Button><div className="relative mt-3"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Search conversations" className="h-9 bg-background/50 pl-9" placeholder="Search chats" value={filter} onChange={(e) => setFilter(e.target.value)} /></div></div>
      <div className="mt-5 flex-1 overflow-y-auto px-2"><p className="px-2 pb-2 text-xs font-semibold uppercase text-muted-foreground">Conversations</p>{visibleThreads.map((thread) => <div className={`group mb-1 flex items-center rounded-md ${thread.id === threadId ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"}`} key={thread.id}><Link className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-sm" params={{ threadId: thread.id }} to="/chat/$threadId" onClick={() => setSidebar(false)}><MessageSquare className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{thread.title}</span></Link><DropdownMenu><DropdownMenuTrigger asChild><Button aria-label="Conversation options" className="mr-1 opacity-0 group-hover:opacity-100" size="icon-sm" variant="ghost"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => rename(thread.id, thread.title)}><Pencil />Rename</DropdownMenuItem><DropdownMenuItem className="text-destructive" onClick={() => remove(thread.id)}><Trash2 />Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>)}</div>
      <div className="border-t border-sidebar-border p-3"><div className="mb-3 px-2 text-xs text-muted-foreground">Made by <span className="font-semibold text-sidebar-foreground">Vinay Kushwaha</span></div><Button className="w-full justify-start" variant="ghost" onClick={toggleTheme}>{dark ? <Sun /> : <Moon />}{dark ? "Light mode" : "Dark mode"}</Button><Button className="w-full justify-start" variant="ghost" onClick={signOut}><LogOut />Sign out</Button></div>
    </aside>
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4 sm:px-6"><div className="flex min-w-0 items-center gap-3"><Button aria-label="Open sidebar" className="lg:hidden" size="icon-sm" variant="ghost" onClick={() => setSidebar(true)}><Menu /></Button><div className="min-w-0"><h1 className="truncate font-display text-sm font-semibold sm:text-base">{currentTitle}</h1><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-primary" />NVIDIA Nemotron 3 Ultra</p></div></div><div className="flex items-center gap-2">{messages.length > 0 && <Button aria-label="Download conversation" title="Download conversation" size="icon-sm" variant="ghost" onClick={exportChat}><Download className="size-4" /></Button>}<div className="hidden items-center gap-2 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground sm:flex"><Check className="size-3.5 text-primary" />Private</div></div></header>
      <Conversation className="min-h-0"><ConversationContent className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">{messages.length === 0 ? <Welcome onPick={(prompt) => void submit({ text: prompt })} /> : messages.map((message) => <Message from={message.role} key={message.id} className="animate-rise-in"><MessageContent>{message.parts.map((part, index) => part.type === "text" ? <MessageResponse key={index}>{part.text}</MessageResponse> : part.type === "reasoning" ? <details className="text-xs text-muted-foreground" key={index}><summary className="cursor-pointer font-medium">Thinking process</summary><div className="mt-2 border-l border-border pl-3"><MessageResponse>{part.text}</MessageResponse></div></details> : null)}</MessageContent>{message.role === "assistant" && <MessageActions><MessageAction tooltip="Copy" onClick={() => { const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join(""); void navigator.clipboard.writeText(text); toast.success("Copied"); }}><Copy /></MessageAction></MessageActions>}</Message>)}{status === "submitted" && <div className="flex items-center gap-3 text-sm text-muted-foreground"><BrainCircuit className="size-5 text-primary" /><Shimmer>Nemotron is thinking deeply…</Shimmer></div>}{error && <p className="text-sm text-destructive">{error.message}</p>}</ConversationContent><ConversationScrollButton /></Conversation>
      <div className="shrink-0 bg-background px-3 pb-4 pt-2 sm:px-6"><div className="mx-auto max-w-3xl"><PromptInput className="border-border bg-card shadow-lg" onSubmit={(message) => submit(message)}><PromptInputTextarea ref={inputRef} placeholder="Message VK AI…" value={input} onChange={(e) => setInput(e.target.value)} /><PromptInputFooter><PromptInputTools><span className="px-2 text-xs text-muted-foreground">Enter to send · Shift + Enter for new line</span></PromptInputTools><PromptInputSubmit disabled={!input.trim() && !busy} onStop={stop} status={status} /></PromptInputFooter></PromptInput><p className="mt-2 text-center text-[11px] text-muted-foreground">AI can make mistakes. Check important information.</p></div></div>
    </main>
  </div>;
}

function Welcome({ onPick }: { onPick: (prompt: string) => void }) { const prompts = ["Explain a complex topic simply", "Help me write something better", "Plan my next project", "Debug a piece of code"]; return <ConversationEmptyState className="min-h-[60vh]"><div className="grid size-14 place-items-center rounded-md border border-primary/30 bg-accent text-primary"><BrainCircuit className="size-7" /></div><div className="mt-3 max-w-lg"><h2 className="font-display text-3xl font-semibold">What can I help you think through?</h2><p className="mt-3 leading-7 text-muted-foreground">Ask anything—from quick questions to deep research, writing, planning, and code.</p></div><div className="mt-7 grid w-full max-w-xl gap-2 sm:grid-cols-2">{prompts.map((prompt) => <Button className="h-auto justify-start whitespace-normal px-4 py-3 text-left" key={prompt} variant="outline" onClick={() => onPick(prompt)}>{prompt}</Button>)}</div></ConversationEmptyState>; }