import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { BrainCircuit, Check, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [
    { title: "Sign in — ShâVì Ai" },
    { name: "description", content: "Sign in to your private ShâVì Ai conversations." },
    { property: "og:title", content: "Sign in — ShâVì Ai" },
    { property: "og:description", content: "Sign in to your private ShâVì Ai conversations." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    const result = mode === "signin"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (result.error) { toast.error(result.error.message); return; }
    if (mode === "signup" && !result.data.session) { toast.success("Check your email to confirm your account."); return; }
    void navigate({ to: "/chat" });
  }

  async function googleSignIn() {
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) toast.error(result.error.message);
    else if (!result.redirected) void navigate({ to: "/chat" });
  }

  return <main className="grid min-h-screen bg-background lg:grid-cols-[1.1fr_0.9fr]">
    <section className="relative hidden overflow-hidden border-r border-border bg-sidebar p-12 lg:flex lg:flex-col lg:justify-between">
      <div className="absolute inset-x-0 top-0 h-1 bg-primary" />
      <Brand />
      <div className="max-w-xl animate-rise-in">
        <p className="mb-5 text-sm font-semibold uppercase text-primary">Private AI workspace</p>
        <h1 className="font-display text-5xl font-semibold leading-tight">A sharper space for your best thinking.</h1>
        <p className="mt-6 max-w-lg text-lg leading-8 text-muted-foreground">Powered by NVIDIA Nemotron. Built for long conversations, focused answers, and work worth saving.</p>
        <div className="mt-10 grid gap-4 text-sm text-muted-foreground sm:grid-cols-2">
          {["Private saved conversations", "Streaming answers", "Deep reasoning mode", "Markdown & code support"].map((item) => <div className="flex items-center gap-3" key={item}><Check className="size-4 text-primary" />{item}</div>)}
        </div>
      </div>
      <div className="space-y-1 text-sm text-muted-foreground"><p>© 2026 VK Tech Learn. All rights reserved.</p><p>By: <span className="font-semibold text-foreground">Vìñâý Kúshwâhå</span> · <a className="underline-offset-4 hover:text-foreground hover:underline" href="https://www.instagram.com/mr__vinay__kushwaha" rel="noreferrer" target="_blank">Follow on Instagram ◉ @mr__vinay__kushwaha</a></p></div>
    </section>
    <section className="flex items-center justify-center p-6 sm:p-10">
      <div className="w-full max-w-md animate-rise-in">
        <div className="mb-10 lg:hidden"><Brand /></div>
        <p className="text-sm font-semibold text-primary">{mode === "signin" ? "Welcome back" : "Create your account"}</p>
        <h2 className="mt-2 font-display text-3xl font-semibold">{mode === "signin" ? "Continue to ShâVì Ai" : "Start thinking with ShâVì Ai"}</h2>
        <p className="mt-2 text-sm text-muted-foreground">Your conversations stay private to your account.</p>
        <Button className="mt-8 h-11 w-full" variant="outline" onClick={googleSignIn}>Continue with Google</Button>
        <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />OR CONTINUE WITH EMAIL<span className="h-px flex-1 bg-border" /></div>
        <form className="space-y-4" onSubmit={submit}>
          <Input aria-label="Email address" className="h-11" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <div className="relative"><Input aria-label="Password" className="h-11 pr-11" type={visible ? "text" : "password"} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /><Button aria-label={visible ? "Hide password" : "Show password"} className="absolute right-1.5 top-1.5" size="icon-sm" type="button" variant="ghost" onClick={() => setVisible(!visible)}>{visible ? <EyeOff /> : <Eye />}</Button></div>
          <Button className="h-11 w-full" disabled={busy} type="submit">{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</Button>
        </form>
        <Button className="mx-auto mt-6 flex text-sm text-muted-foreground hover:text-foreground" variant="link" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>{mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}</Button>
        <div className="mt-12 space-y-1 text-center text-xs text-muted-foreground lg:hidden"><p>© 2026 VK Tech Learn. All rights reserved.</p><p>By: <span className="font-semibold text-foreground">Vìñâý Kúshwâhå</span> · <a className="underline-offset-4 hover:text-foreground hover:underline" href="https://www.instagram.com/mr__vinay__kushwaha" rel="noreferrer" target="_blank">Follow on Instagram ◉ @mr__vinay__kushwaha</a></p></div>
      </div>
    </section>
  </main>;
}

function Brand() { return <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground"><BrainCircuit className="size-5" /></div><div><p className="font-display text-lg font-bold">ShâVì Ai</p><p className="text-xs text-muted-foreground">Nemotron intelligence</p></div></div>; }