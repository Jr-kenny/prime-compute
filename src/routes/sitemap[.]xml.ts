import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const BASE_URL = "";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const paths = [
          { p: "/", c: "weekly", pr: "1.0" },
          { p: "/marketplace", c: "daily", pr: "0.9" },
          { p: "/dashboard", c: "weekly", pr: "0.7" },
          { p: "/provider", c: "weekly", pr: "0.7" },
          { p: "/register", c: "monthly", pr: "0.6" },
          { p: "/docs", c: "monthly", pr: "0.6" },
        ];
        const urls = paths.map(
          (e) => `  <url>\n    <loc>${BASE_URL}${e.p}</loc>\n    <changefreq>${e.c}</changefreq>\n    <priority>${e.pr}</priority>\n  </url>`,
        );
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
        return new Response(xml, {
          headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});