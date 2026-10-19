import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

const root = process.cwd();
const dist = path.join(root, "dist");
const pageDefinitions = [
  { file: "index.html", key: "home", route: "" },
  { file: "faq.html", key: "faq", route: "faq/" },
  { file: "privacy.html", key: "privacy", route: "privacy/" },
  { file: "terms.html", key: "terms", route: "terms/" },
  { file: "contact.html", key: "contact", route: "contact/" },
];

const faqEntries = [
  ["How many images can I upload?", "You can select up to 10 images per batch. Each file can be up to 20 MB. Clear the current batch to start another one."],
  ["Which image formats are supported?", "The tool accepts PNG, JPEG, WebP, AVIF, and JPEG XL images, subject to the Tinify API’s current support."],
  ["How does compression work?", "When you press Compress, the app sends each image to the Tinify API over HTTPS. The optimized image is returned to your browser."],
  ["Can I see how much space I saved?", "Each completed row shows the original size, optimized size, and percentage change. If the result is not smaller, it is labeled Optimized."],
  ["Can I download all images together?", "Yes. When at least two images are complete, choose Download all (.zip). You can also download each result separately."],
  ["Are my images stored by Squeeze Studio?", "This app does not save uploaded files to its own storage. Images are sent to Tinify for processing; Tinify’s service and policies apply."],
  ["Why does compression need a server endpoint?", "GitHub Pages hosts the static interface. The private Tinify API key needs a server-side endpoint, hosted separately or with a serverless platform."],
  ["What if the API limit is reached?", "The app shows the provider’s limit or rate-limit response. Wait for the account quota to reset or use an appropriate Tinify plan."],
];

function schemaFor(key, description) {
  if (key === "home") {
    return {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Squeeze Studio",
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Any modern web browser",
      description,
      isAccessibleForFree: true,
      image: "./fav.png",
      featureList: [
        "Compress up to 10 images per batch",
        "Supports PNG, JPEG, WebP, AVIF, and JPEG XL where supported by Tinify",
        "Compare original and optimized image sizes",
        "Download optimized images individually or as a ZIP",
      ],
    };
  }
  if (key === "faq") {
    return {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqEntries.map(([question, answer]) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: { "@type": "Answer", text: answer },
      })),
    };
  }
  const names = {
    privacy: "Privacy Policy | Squeeze Studio Image Compressor",
    terms: "Terms of Use | Squeeze Studio",
    contact: "Contact Squeeze Studio | Image Compressor Help",
  };
  return {
    "@context": "https://schema.org",
    "@type": key === "contact" ? "ContactPage" : "WebPage",
    name: names[key],
    description,
  };
}

function resolveSiteBase() {
  let value = process.env.VITE_SITE_URL?.trim();
  if (!value) {
    const [owner, repository] = (process.env.GITHUB_REPOSITORY || "").split("/");
    if (owner && repository) {
      const ownerSlug = owner.toLowerCase();
      const repoSlug = repository.toLowerCase();
      value = repoSlug === ownerSlug + ".github.io"
        ? "https://" + ownerSlug + ".github.io/"
        : "https://" + ownerSlug + ".github.io/" + repoSlug + "/";
    }
  }
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("VITE_SITE_URL must use HTTPS.");
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") + "/";
  return url;
}

function escapeAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function upsertMeta(html, attribute, name, content) {
  const pattern = new RegExp("<meta\\s+(?=[^>]*\\b" + attribute + "=[\"']" + name + "[\"'])[^>]*>", "i");
  const tag = '<meta ' + attribute + '="' + escapeAttribute(name) + '" content="' + escapeAttribute(content) + '" />';
  if (pattern.test(html)) return html.replace(pattern, tag);
  return html.replace("</head>", "  " + tag + "\n  </head>");
}

function upsertCanonical(html, href) {
  const tag = '<link rel="canonical" href="' + escapeAttribute(href) + '" />';
  const pattern = /<link\s+rel=["']canonical["'][^>]*>/i;
  if (pattern.test(html)) return html.replace(pattern, tag);
  return html.replace("</head>", "  " + tag + "\n  </head>");
}

function legacyRedirect(target) {
  const escaped = escapeAttribute(target);
  const scriptTarget = JSON.stringify(target);
  return '<!doctype html>\n<html lang="en"><head><meta charset="UTF-8" />' +
    '<meta name="robots" content="noindex,follow" />' +
    '<link rel="canonical" href="' + escaped + '" />' +
    '<meta http-equiv="refresh" content="0;url=' + escaped + '" />' +
    '<title>Page moved | Squeeze Studio</title></head>' +
    '<body><p>This page moved. <a href="' + escaped + '">Open the clean URL</a>.</p>' +
    '<script>window.location.replace(' + scriptTarget + ' + window.location.hash);</script>' +
    '</body></html>\n';
}

const server = await createServer({
  configFile: path.join(root, "vite.config.ts"),
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

try {
  const { default: App } = await server.ssrLoadModule("/src/App.tsx");
  const siteBase = resolveSiteBase();
  const sitemapUrls = [];

  for (const page of pageDefinitions) {
    const sourcePath = path.join(dist, page.file);
    let html = await readFile(sourcePath, "utf8");
    const rootTag = '<div id="root" data-page="' + page.key + '"></div>';
    if (!html.includes(rootTag)) throw new Error("Root element not found in " + page.file);

    const markup = renderToString(createElement(App, { initialPage: page.key }));
    html = html.replace(rootTag, '<div id="root" data-page="' + page.key + '">' + markup + "</div>");

    const description = html.match(/<meta name="description" content="([^"]*)"\s*\/>/i)?.[1] || "";
    const schema = schemaFor(page.key, description);
    const schemaTag = '<script type="application/ld+json" id="page-schema">' + JSON.stringify(schema) + "</script>";
    html = html.replace("</head>", "  " + schemaTag + "\n  </head>");

    const cleanTarget = siteBase
      ? (page.route ? new URL(page.route, siteBase).href : siteBase.href)
      : (page.route ? "/" + page.route : "/");

    if (page.key === "home") {
      const homePath = siteBase?.pathname || "/";
      const indexPath = new URL("index.html", siteBase || "http://localhost/").pathname;
      const homeRedirect = "<script>if(window.location.pathname===" + JSON.stringify(indexPath) +
        "){window.location.replace(" + JSON.stringify(homePath) +
        "+window.location.search+window.location.hash);}</script>";
      html = html.replace("</head>", "  " + homeRedirect + "\n  </head>");
    }

    if (siteBase) {
      const image = new URL("fav.png", siteBase).href;
      html = upsertCanonical(html, cleanTarget);
      html = upsertMeta(html, "property", "og:url", cleanTarget);
      html = upsertMeta(html, "property", "og:image", image);
      html = upsertMeta(html, "name", "twitter:image", image);
      schema.url = cleanTarget;
      if (schema.image) schema.image = image;
      html = html.replace(schemaTag, '<script type="application/ld+json" id="page-schema">' + JSON.stringify(schema) + "</script>");
      sitemapUrls.push(cleanTarget);
    }

    const destination = page.route
      ? path.join(dist, page.route, "index.html")
      : sourcePath;
    if (page.route) await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, html);

    if (page.route) {
      await writeFile(sourcePath, legacyRedirect(cleanTarget));
    }
  }

  const robots = ["User-agent: *", "Allow: /", "Disallow: /api/"];
  if (siteBase) {
    const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      sitemapUrls.map((url) => "  <url><loc>" + url.replaceAll("&", "&amp;") + "</loc></url>").join("\n") +
      "\n</urlset>\n";
    await writeFile(path.join(dist, "sitemap.xml"), sitemap);
    robots.push("Sitemap: " + new URL("sitemap.xml", siteBase).href);
    console.log("[seo] Generated sitemap and canonical URLs for " + siteBase.href);
  } else {
    console.warn("[seo] Public URL unknown; set VITE_SITE_URL for production canonical URLs and sitemap.xml.");
  }
  await writeFile(path.join(dist, "robots.txt"), robots.join("\n") + "\n");
  console.log("[routes] Built clean routes: /faq/, /privacy/, /terms/, /contact/");
} finally {
  await server.close();
}
