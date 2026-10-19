# Squeeze Studio

A five-page, responsive image compression website. The home page includes the upload tool, an image queue, per-file status, before/after sizes, individual downloads, and a ZIP download.

## Stack

- Vite, React, TypeScript, and CSS for the static website.
- Cloudflare Pages Function at functions/api/compress.js for the Tinify API.
- Tinify API credentials are read only by the server-side function.

## Run locally

1. Install dependencies with npm install.
2. Copy .dev.vars.example to .dev.vars.
3. Put authorized Tinify API key(s) into TINIFY_API_KEYS in .dev.vars.
4. Run npm run dev:pages. The local Pages server serves both the site and /api/compress.

npm run dev starts only the Vite interface. For API development, use npm run dev:pages.

## API key handling

The server accepts TINIFY_API_KEYS as a comma- or newline-separated server-side secret. If Tinify explicitly rejects a credential as invalid, the function can try the next configured key. Rate-limit or monthly-quota responses are shown to the user; the app does not rotate keys to bypass provider limits. Tinify documents that its API keys must be kept secret and that quota limits should be handled by waiting for reset or choosing an appropriate plan.

Never add real API keys to React code, published environment files, or the GitHub repository. For Cloudflare Pages, set TINIFY_API_KEYS in the project’s server-side environment settings. Keep .dev.vars private on your computer.

## GitHub Pages

The included GitHub Actions workflow builds and deploys the static interface. GitHub Pages cannot run the Tinify function. To make compression work from that site, host the API separately and set VITE_API_BASE_URL to the API origin as a GitHub Actions repository variable. Add the GitHub Pages origin to the API’s ALLOWED_ORIGINS setting.

Without a hosted API endpoint, the site interface can be opened, but the Compress action will report that the service is not connected.

## Full site and API on Cloudflare Pages

Connect this repository to Cloudflare Pages, use npm run build as the build command and dist as the output directory. Configure TINIFY_API_KEYS as a secret in the Cloudflare project. The Pages Function will then be available on the same origin as the site. The deploy:cloudflare command can also deploy a previously created Pages project named squeeze-studio.

## Site pages

The app includes Home, FAQ, Privacy, Terms, and Contact pages. The public page URLs are clean directory routes: `/`, `/faq/`, `/privacy/`, `/terms/`, and `/contact/`. The build prerenders those pages as static HTML so GitHub Pages and Cloudflare Pages can serve them directly. Existing `.html` paths redirect to the clean routes. The Contact page links to aditya07acc@gmail.com and has no form. The footer credits the TinyPNG API in plain text and states that the project is independent.

For a custom domain or a non-default public URL, set `VITE_SITE_URL` as a GitHub Actions repository variable. The default GitHub Pages URL is inferred from the repository name.

Before opening a public API endpoint, configure platform-level abuse protection and review the Tinify API plan, applicable terms, and privacy practices.

