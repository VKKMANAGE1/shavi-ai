import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const threadIdSchema = z.object({ threadId: z.string().uuid() });

export const listThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("chat_threads").select("id,title,updated_at").order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  });

export const createThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("chat_threads").insert({ user_id: context.userId }).select("id,title,updated_at").single();
    if (error) throw new Error(error.message);
    return data;
  });

export const getThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => threadIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: thread, error: threadError } = await context.supabase.from("chat_threads").select("id,title,updated_at").eq("id", data.threadId).single();
    if (threadError) throw new Error("Conversation not found");
    const { data: rows, error } = await context.supabase.from("chat_messages").select("id,role,content,reasoning,sequence").eq("thread_id", data.threadId).order("sequence");
    if (error) throw new Error(error.message);
    return { thread, messages: rows.map((row) => ({ id: row.id, role: row.role as "user" | "assistant", parts: [
      ...(row.reasoning ? [{ type: "reasoning" as const, text: row.reasoning }] : []),
      { type: "text" as const, text: row.content },
    ] })) };
  });

export const renameThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ threadId: z.string().uuid(), title: z.string().trim().min(1).max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("chat_threads").update({ title: data.title }).eq("id", data.threadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => threadIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("chat_threads").delete().eq("id", data.threadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });