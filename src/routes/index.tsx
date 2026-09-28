import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VK AI — NVIDIA-powered assistant" },
      { name: "description", content: "Think, create, and solve with VK AI by Vinay Kushwaha." },
      { property: "og:title", content: "VK AI — NVIDIA-powered assistant" },
      { property: "og:description", content: "Think, create, and solve with VK AI by Vinay Kushwaha." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      void navigate({ to: data.session ? "/chat" : "/auth", replace: true });
    });
  }, [navigate]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-muted-foreground">
        <div className="size-3 animate-pulse rounded-sm bg-primary" />
        <span className="text-sm">Opening VK AI…</span>
      </div>
    </div>
  );
}
