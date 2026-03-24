import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/"],
      },
      {
        userAgent: "Googlebot-News",
        allow: "/",
        disallow: ["/api/"],
      },
    ],
    sitemap: [
      "https://regionalpulsenews.com/sitemap.xml",
      "https://regionalpulsenews.com/api/sitemap-news",
    ],
  };
}
