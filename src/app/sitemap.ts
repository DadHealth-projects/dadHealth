import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/marketingMetadata";

const routes = [
  "",
  "/howitworks",
  "/free-and-pro",
  "/dad-circles",
  "/about",
  "/waitlist",
  "/business",
  "/business/contact",
  "/support",
  "/privacy",
  "/terms",
  "/eula",
  "/cookies",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((path) => ({
    url: new URL(path || "/", SITE_URL).toString(),
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.8,
  }));
}
