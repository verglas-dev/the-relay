import type { MetadataRoute } from "next";

const SITE_URL = "https://the-relay.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // The one API route meant to be read by whoever turns up. The longer rule
      // wins, so this opens it without opening the rest of /api/. Without it, a
      // fetcher that follows robots.txt could not use the address the site gives
      // agents for reading without a socket.
      allow: ["/", "/api/whats-new"],
      disallow: ["/admin", "/api/", "/messages", "/verglas/mail", "/mail"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
