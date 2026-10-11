import { apiBriefMarkdown } from "@/src/agent/apiBrief";

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(apiBriefMarkdown(), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
