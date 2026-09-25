import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/chat")({ server: { handlers: { POST: async ({ request }) => {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return new Response("Please sign in again.", { status: 401 });
  const token = authorization.slice(7);
  const url = process.env['SUPABASE_URL']; const key = process.env['SUPABASE_PUBLISHABLE_KEY']; const nvidiaKey = process.env['NVIDIA_API_KEY'];
  if (!url || !key || !nvidiaKey) return new Response("AI service is not configured.", { status: 500 });
  const supabase = createClient<Database>(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: claims, error: authError } = await supabase.auth.getClaims(token);
  const userId = claims?.claims?.sub;
  if (authError || !userId) return new Response("Please sign in again.", { status: 401 });
  const body = await request.json() as { threadId?: string; messages?: UIMessage[] };
  if (!body.threadId || !Array.isArray(body.messages)) return new Response("Invalid chat request.", { status: 400 });
  const { data: thread } = await supabase.from("chat_threads").select("id,title").eq("id", body.threadId).single();
  if (!thread) return new Response("Conversation not found.", { status: 404 });
  const last = body.messages.at(-1);
  const userText = last?.parts.filter((part) => part.type === "text").map((part) => part.text).join("").trim();
  if (!last || last.role !== "user" || !userText) return new Response("Message cannot be empty.", { status: 400 });
  const { count } = await supabase.from("chat_messages").select("id", { count: "exact", head: true }).eq("thread_id", body.threadId);
  const sequence = count ?? 0;
  const { error: insertError } = await supabase.from("chat_messages").insert({ thread_id: body.threadId, user_id: userId, role: "user", content: userText, sequence });
  if (insertError) return new Response(insertError.message, { status: 409 });
  if (thread.title === "New conversation") await supabase.from("chat_threads").update({ title: userText.slice(0, 54) }).eq("id", body.threadId);
  else await supabase.from("chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", body.threadId);
  const nvidia = createOpenAICompatible({ name: "nvidia", baseURL: "https://integrate.api.nvidia.com/v1", apiKey: nvidiaKey, transformRequestBody: (requestBody) => ({ ...requestBody, chat_template_kwargs: { enable_thinking: true } }) });
  const result = streamText({ model: nvidia("nvidia/nemotron-3-ultra-550b-a55b"), system: "You are VK AI, a precise, thoughtful and friendly assistant created by Vinay Kushwaha. Answer in the user's language. Use clear Markdown. Be concise by default, but thorough when the task needs it.", messages: await convertToModelMessages(body.messages), temperature: 1, topP: 0.95, maxOutputTokens: 16384, maxRetries: 0, abortSignal: request.signal, onFinish: async ({ text, reasoningText }) => {
    const { error } = await supabase.from("chat_messages").insert({ thread_id: body.threadId as string, user_id: userId, role: "assistant", content: text, reasoning: reasoningText || null, sequence: sequence + 1 });
    if (error) console.error("Could not save assistant message", error.message);
  } });
  return result.toUIMessageStreamResponse({ originalMessages: body.messages, sendReasoning: true });
} } } });