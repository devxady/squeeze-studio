import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const root = process.cwd();

function getBasePath(mode: string): string {
  const env = loadEnv(mode, root, "");
  const siteUrl = process.env.VITE_SITE_URL || env.VITE_SITE_URL;
  if (siteUrl) {
    const pathname = new URL(siteUrl).pathname.replace(/\/+$/, "");
    return (pathname || "") + "/";
  }

  const repository = (process.env.GITHUB_REPOSITORY || "").split("/");
  const owner = repository[0]?.toLowerCase();
  const name = repository[1]?.toLowerCase();
  if (owner && name) {
    return name === owner + ".github.io" ? "/" : "/" + name + "/";
  }
  return "/";
}

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: getBasePath(mode),
  build: {
    rollupOptions: {
      input: {
        home: resolve(root, "index.html"),
        faq: resolve(root, "faq.html"),
        privacy: resolve(root, "privacy.html"),
        terms: resolve(root, "terms.html"),
        contact: resolve(root, "contact.html"),
      },
    },
  },
}));