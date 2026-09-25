# NVIDIA AI Chat Assistant

## What will be built
- A refined, dark ChatGPT-style workspace branded “VK AI” and “Made by Vinay Kushwaha”.
- Email/password and Google sign-in so each person has private saved conversations.
- Multiple conversations with dedicated URLs, sidebar search, rename, delete, new-chat, and account controls.
- Streaming NVIDIA Nemotron responses with full conversation context, visible thinking status, Markdown, code blocks, copy, retry, stop, and suggested prompts.
- Responsive desktop and mobile layouts based on the uploaded chatbot, upgraded to a cleaner professional visual system.

## Technical details
- Keep `NVIDIA_API_KEY` only in secure server-side storage and call `nvidia/nemotron-3-ultra-550b-a55b` through NVIDIA’s OpenAI-compatible streaming endpoint.
- Store thread metadata and AI SDK-compatible message payloads in Lovable Cloud with user-scoped access rules.
- Use protected conversation pages and a separate authenticated streaming endpoint.
- Build the transcript and composer from AI Elements, including streamed Markdown and reasoning display.
- Add route-specific metadata and verify sign-in, two separate chats, reload persistence, mobile layout, stopping, and error states.
