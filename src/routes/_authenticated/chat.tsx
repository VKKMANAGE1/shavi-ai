import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: [
    { title: "New conversation — ShâVì Ai" },
    { name: "description", content: "Start a private conversation with ShâVì Ai." },
    { property: "og:title", content: "New conversation — ShâVì Ai" },
    { property: "og:description", content: "Start a private conversation with ShâVì Ai." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }), component: () => <Outlet />,
});