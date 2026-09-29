import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: [
    { title: "New conversation — VK AI" },
    { name: "description", content: "Start a private conversation with VK AI." },
    { property: "og:title", content: "New conversation — VK AI" },
    { property: "og:description", content: "Start a private conversation with VK AI." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }), component: () => <Outlet />,
});