import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

// ─── Web Tools ────────────────────────────────────────────────────────────────

export function buildWebTools() {
  const webSearch = new DynamicStructuredTool({
    name: "web_search",
    description:
      "Search the web for current information. Use this for recent news, facts, prices, or anything that requires up-to-date data.",
    schema: z.object({
      query: z.string().describe("Search query"),
    }),
    func: async ({ query }) => {
      try {
        const apiKey = process.env.TAVILY_API_KEY || process.env.BRAVE_API_KEY;
        if (!apiKey) {
          // Fallback: use DuckDuckGo instant answer API (no key required)
          const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1`;
          const res = await fetch(url);
          const data: any = await res.json();
          const results: string[] = [];
          if (data.AbstractText) results.push(data.AbstractText);
          if (data.RelatedTopics?.length) {
            for (const t of data.RelatedTopics.slice(0, 5)) {
              if (t.Text) results.push(t.Text);
            }
          }
          return results.length
            ? results.join("\n\n")
            : "No results found. Consider setting TAVILY_API_KEY for better search.";
        }

        // Tavily search (preferred)
        if (process.env.TAVILY_API_KEY) {
          const res = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: apiKey,
              query,
              search_depth: "basic",
              max_results: 5,
            }),
          });
          const data: any = await res.json();
          const results = data.results
            ?.map((r: any) => `${r.title}\n${r.content}`)
            .join("\n\n---\n\n");
          return results || "No results found.";
        }

        // Brave search fallback
        const res = await fetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
          {
            headers: {
              "X-Subscription-Token": apiKey,
              Accept: "application/json",
            },
          },
        );
        const data: any = await res.json();
        const results = data.web?.results
          ?.map((r: any) => `${r.title}\n${r.description}`)
          .join("\n\n---\n\n");
        return results || "No results found.";
      } catch (e: any) {
        return `Search failed: ${e.message}`;
      }
    },
  });

  const readUrl = new DynamicStructuredTool({
    name: "read_url",
    description:
      "Fetch and read the text content of a URL. Use this to read articles, docs, or web pages.",
    schema: z.object({
      url: z.string().describe("Full URL to fetch"),
    }),
    func: async ({ url }) => {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "blockbot/0.1.0 (AI agent)" },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok)
          return `Failed to fetch URL: ${res.status} ${res.statusText}`;
        const html = await res.text();
        // Basic HTML stripping — remove tags, scripts, styles
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s{2,}/g, " ")
          .trim()
          .slice(0, 4000); // Cap at 4000 chars
        return text || "No readable content found.";
      } catch (e: any) {
        return `Failed to read URL: ${e.message}`;
      }
    },
  });

  return [webSearch, readUrl];
}
