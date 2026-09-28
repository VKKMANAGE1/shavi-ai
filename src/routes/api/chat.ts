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
  const supabase = createClient<Database>(url, key, { global: { headers: { Authorization: `Bearer ${token}` }, fetch: (input, init) => { const headers = new Headers(init?.headers); if (headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization"); headers.set("apikey", key); return fetch(input, { ...init, headers }); } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: claims, error: authError } = await supabase.auth.getClaims(token);
  const userId = claims?.claims?.sub;
  if (authError || !userId) return new Response("Please sign in again.", { status: 401 });
  let body: { threadId?: string; messages?: UIMessage[] };
  try { body = await request.json(); } catch { return new Response("Invalid chat request.", { status: 400 }); }
  if (!body.threadId || !/^[0-9a-f-]{36}$/i.test(body.threadId) || !Array.isArray(body.messages) || body.messages.length > 200) return new Response("Invalid chat request.", { status: 400 });
  const { data: thread } = await supabase.from("chat_threads").select("id,title").eq("id", body.threadId).single();
  if (!thread) return new Response("Conversation not found.", { status: 404 });
  const last = body.messages.at(-1);
  const userText = last?.parts?.filter((part) => part.type === "text").map((part) => part.text).join("").trim();
  if (!last || last.role !== "user" || !userText || userText.length > 20000) return new Response("Message must be between 1 and 20,000 characters.", { status: 400 });
  const { data: history, error: historyError } = await supabase.from("chat_messages").select("role,content,reasoning,sequence").eq("thread_id", body.threadId).order("sequence");
  if (historyError) return new Response("Could not load this conversation.", { status: 500 });
  const sequence = history.length;
  const { error: insertError } = await supabase.from("chat_messages").insert({ thread_id: body.threadId, user_id: userId, role: "user", content: userText, sequence });
  if (insertError) return new Response("Could not save your message. Please try again.", { status: 409 });
  if (thread.title === "New conversation") await supabase.from("chat_threads").update({ title: userText.slice(0, 54) }).eq("id", body.threadId);
  else await supabase.from("chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", body.threadId);
  const nvidia = createOpenAICompatible({ name: "nvidia", baseURL: "https://integrate.api.nvidia.com/v1", apiKey: nvidiaKey, transformRequestBody: (requestBody) => ({ ...requestBody, chat_template_kwargs: { enable_thinking: true } }) });
  const trustedMessages: UIMessage[] = [...history.map((row) => ({ id: `history-${row.sequence}`, role: row.role as "user" | "assistant", parts: [
    ...(row.reasoning ? [{ type: "reasoning" as const, text: row.reasoning }] : []),
    { type: "text" as const, text: row.content },
  ] })), { id: last.id, role: "user", parts: [{ type: "text", text: userText }] }];
  const result = streamText({ model: nvidia("nvidia/nemotron-3-ultra-550b-a55b"), system: "You are VK AI, a precise, thoughtful and friendly assistant created by Vinay Kushwaha. Answer in the user's language. Use clear Markdown. Be concise by default, but thorough when the task needs it.", messages: await convertToModelMessages(trustedMessages), temperature: 1, topP: 0.95, maxOutputTokens: 16384, maxRetries: 0, abortSignal: request.signal });
  return result.toUIMessageStreamResponse({ originalMessages: body.messages, sendReasoning: true, onError: (error) => { console.error("NVIDIA request failed", error); const message = error instanceof Error ? error.message : "Could not get a response."; return message; }, onFinish: async ({ responseMessage, isAborted }) => {
    const text = responseMessage.parts.filter((part) => part.type === "text").map((part) => part.text).join("");
    const reasoning = responseMessage.parts.filter((part) => part.type === "reasoning").map((part) => part.text).join("\n");
    if (!text && !reasoning) return;
    const { error } = await supabase.from("chat_messages").insert({ thread_id: body.threadId as string, user_id: userId, role: "assistant", content: text || (isAborted ? "Response stopped." : ""), reasoning: reasoning || null, sequence: sequence + 1 });
    if (error) console.error("Could not save assistant message", error.message);
  } });
} } } });