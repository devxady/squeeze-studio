import { useEffect, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import JSZip from "jszip";
import { compressImage } from "./lib/compression";

const MAX_FILES = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const EXTENSIONS = ["png", "jpg", "jpeg", "webp", "avif", "jxl"];
const PAGES = ["home", "faq", "privacy", "terms", "contact"] as const;
type Page = (typeof PAGES)[number];
type Status = "queued" | "compressing" | "done" | "error";
type Item = {
  id: string;
  file: File;
  preview: string;
  status: Status;
  output?: Blob;
  outputUrl?: string;
  error?: string;
};

const titles: Record<Page, string> = {
  home: "Online Image Compressor for JPG, PNG & WebP | Squeeze Studio",
  faq: "Image Compressor FAQ | Squeeze Studio",
  privacy: "Privacy Policy | Squeeze Studio Image Compressor",
  terms: "Terms of Use | Squeeze Studio",
  contact: "Contact Squeeze Studio | Image Compressor Help",
};

const descriptions: Record<Page, string> = {
  home: "Compress up to 10 PNG, JPG, WebP, AVIF, or JPEG XL images online. Compare original and optimized sizes, then download individual files or a ZIP.",
  faq: "Answers about batch image compression, supported formats, the 20 MB upload limit, privacy, and downloads with Squeeze Studio.",
  privacy: "Read the Squeeze Studio image compressor privacy policy: how selected images are sent to Tinify, browser previews are handled, and what this app stores.",
  terms: "Review the terms for using Squeeze Studio’s online image compressor, including API availability, upload rights, file limits, and acceptable use.",
  contact: "Contact Squeeze Studio for help with the online image compressor, supported image formats, downloads, or bug reports.",
};

function readPage(): Page {
  const name = document.getElementById("root")?.dataset.page || "home";
  return PAGES.includes(name as Page) ? (name as Page) : "home";
}

function pageHref(page: Page): string {
  return page === "home" ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + page + "/";
}

function bytes(size: number): string {
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
  return (size / (1024 * 1024)).toFixed(2) + " MB";
}

function savings(original: number, result: number): number {
  return original > 0 ? Math.max(0, Math.round((1 - result / original) * 100)) : 0;
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const props = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const, "aria-hidden": true as const,
  };
  if (name === "image") return <svg {...props}><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>;
  if (name === "upload") return <svg {...props}><path d="M12 16V4m-5 5 5-5 5 5M5 20h14" /></svg>;
  if (name === "download") return <svg {...props}><path d="M12 4v12m-5-5 5 5 5-5M5 20h14" /></svg>;
  if (name === "check") return <svg {...props}><path d="m5 12 4 4L19 6" /></svg>;
  if (name === "close") return <svg {...props}><path d="m18 6-12 12M6 6l12 12" /></svg>;
  if (name === "shield") return <svg {...props}><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></svg>;
  return <svg {...props}><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" /><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" /></svg>;
}

function BrandMark() {
  return <img className="brand-logo" src={import.meta.env.BASE_URL + "logo.webp"} alt="Squeeze Studio" />;
}

function App({ initialPage }: { initialPage?: Page } = {}) {
  const [page] = useState<Page>(() => initialPage ?? readPage());
  const [queue, setQueue] = useState<Item[]>([]);
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [run, setRun] = useState({ finished: 0, total: 0, current: "" });
  const [zipProgress, setZipProgress] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const queueRef = useRef(queue);

  useEffect(() => { queueRef.current = queue; }, [queue]);

  useEffect(() => {
    document.title = titles[page];
    const description = descriptions[page];
    const descriptionTag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (descriptionTag) descriptionTag.content = description;
    const socialMetadata: Array<[string, string]> = [
      ["og:title", titles[page]],
      ["og:description", description],
      ["twitter:title", titles[page]],
      ["twitter:description", description],
    ];
    for (const [name, content] of socialMetadata) {
      const tag = document.querySelector<HTMLMetaElement>(`meta[property="${name}"], meta[name="${name}"]`);
      if (tag) tag.content = content;
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [page]);
  useEffect(() => () => queueRef.current.forEach((item) => {
    URL.revokeObjectURL(item.preview);
    if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
  }), []);

  const busy = compressing || zipping;
  const doneCount = queue.filter((item) => item.status === "done").length;
  const errorCount = queue.filter((item) => item.status === "error").length;
  const pendingCount = queue.filter((item) => item.status === "queued").length;
  const runPercent = run.total ? Math.round(run.finished / run.total * 100) : 0;

  function addFiles(list: FileList | File[]) {
    const available = Math.max(0, MAX_FILES - queueRef.current.length);
    const accepted: Item[] = [];
    const skipped: string[] = [];
    for (const file of Array.from(list)) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (!EXTENSIONS.includes(ext)) { skipped.push(file.name + " is not a supported image."); continue; }
      if (file.size > MAX_FILE_BYTES) { skipped.push(file.name + " is larger than 20 MB."); continue; }
      accepted.push({
        id: file.name + "-" + Date.now() + "-" + Math.random().toString(36).slice(2),
        file, preview: URL.createObjectURL(file), status: "queued",
      });
    }
    const batch = accepted.slice(0, available);
    accepted.slice(batch.length).forEach((item) => URL.revokeObjectURL(item.preview));
    setQueue((current) => [...current, ...batch]);
    if (accepted.length > batch.length) skipped.push("A batch can contain up to 10 images.");
    setNotice(skipped.length ? skipped[0] + (skipped.length > 1 ? " Some files were skipped." : "") : "");
  }

  function removeItem(id: string) {
    if (busy) return;
    const item = queueRef.current.find((entry) => entry.id === id);
    if (item) {
      URL.revokeObjectURL(item.preview);
      if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
    }
    setQueue((current) => current.filter((entry) => entry.id !== id));
  }

  function clearQueue() {
    if (busy) return;
    queueRef.current.forEach((item) => {
      URL.revokeObjectURL(item.preview);
      if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
    });
    setQueue([]);
    setNotice("");
    setRun({ finished: 0, total: 0, current: "" });
  }

  async function runCompression(retry = false) {
    const targets = queueRef.current.filter((item) => retry ? item.status === "error" : item.status === "queued");
    if (!targets.length || busy) return;
    setCompressing(true);
    setNotice("");
    setRun({ finished: 0, total: targets.length, current: "" });
    for (let index = 0; index < targets.length; index += 1) {
      const item = targets[index];
      setRun({ finished: index, total: targets.length, current: item.file.name });
      setQueue((current) => current.map((entry) =>
        entry.id === item.id ? { ...entry, status: "compressing", error: undefined } : entry));
      try {
        const result = await compressImage(item.file);
        const outputUrl = URL.createObjectURL(result.blob);
        setQueue((current) => current.map((entry) => {
          if (entry.id !== item.id) return entry;
          if (entry.outputUrl) URL.revokeObjectURL(entry.outputUrl);
          return { ...entry, status: "done", output: result.blob, outputUrl, error: undefined };
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "This image could not be compressed.";
        setQueue((current) => current.map((entry) => entry.id === item.id
          ? { ...entry, status: "error", error: message } : entry));
      }
      setRun({ finished: index + 1, total: targets.length, current: "" });
    }
    setCompressing(false);
  }

  function downloadItem(item: Item) {
    if (!item.outputUrl) return;
    const link = document.createElement("a");
    link.href = item.outputUrl;
    link.download = item.file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function downloadAll() {
    const ready = queue.filter((item) => item.status === "done" && item.output);
    if (ready.length < 2 || busy) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      const names = new Map<string, number>();
      ready.forEach((item) => {
        const count = names.get(item.file.name) || 0;
        names.set(item.file.name, count + 1);
        const dot = item.file.name.lastIndexOf(".");
        const base = dot > 0 ? item.file.name.slice(0, dot) : item.file.name;
        const ext = dot > 0 ? item.file.name.slice(dot) : "";
        zip.file(count ? base + " (" + (count + 1) + ")" + ext : item.file.name, item.output!);
      });
      const blob = await zip.generateAsync({ type: "blob" }, (meta) => setZipProgress(Math.round(meta.percent)));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "squeeze-studio-compressed-images.zip";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setNotice("The ZIP could not be created. Download the images one at a time.");
    } finally { setZipping(false); setZipProgress(0); }
  }

  function goToTool(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (page !== "home") {
      window.location.href = import.meta.env.BASE_URL + "#tool";
      return;
    }
    document.getElementById("tool")?.scrollIntoView({ behavior: "smooth" });
  }

  const links: { label: string; page: Page }[] = [
    { label: "Home", page: "home" }, { label: "FAQ", page: "faq" },
    { label: "Privacy", page: "privacy" }, { label: "Terms", page: "terms" },
    { label: "Contact", page: "contact" },
  ];

  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href={import.meta.env.BASE_URL} aria-label="Squeeze Studio home">
            <BrandMark />
          </a>
          <button className="menu-toggle" type="button" aria-label="Toggle navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            <span /><span /><span />
          </button>
          <nav className={menuOpen ? "main-nav is-open" : "main-nav"} aria-label="Main navigation">
            {links.map((link) => <a key={link.page} className={page === link.page ? "nav-link active" : "nav-link"} href={pageHref(link.page)} onClick={() => setMenuOpen(false)}>{link.label}</a>)}
            <a className="nav-cta" href={import.meta.env.BASE_URL} onClick={goToTool}>Compress images <Icon name="arrow" size={16} /></a>
            <a className="coffee-button header-coffee" href="https://buymeacoffee.com/devxaditya" target="_blank" rel="noreferrer"><span aria-hidden="true">&#9749;</span> Buy me a coffee</a>
          </nav>
        </div>
      </header>

      {page === "home" && (
        <main>
          <section className="hero">
            <div className="hero-orbit hero-orbit-one" /><div className="hero-orbit hero-orbit-two" />
            <div className="hero-inner">
              <div className="hero-copy">
                <span className="eyebrow light"><Icon name="sparkle" size={15} /> IMAGE OPTIMIZATION, MADE SIMPLE</span>
                <h1>Smaller images.<br /><span>Same big impact.</span></h1>
                <p>Shrink your image files in a few clicks. Add up to 10 images, watch each one finish, then download them individually or together.</p>
                <div className="hero-points">
                  <span><Icon name="check" size={16} /> Batch up to 10 images</span>
                  <span><Icon name="check" size={16} /> See the size saved</span>
                  <span><Icon name="check" size={16} /> Download a ZIP</span>
                </div>
                <div className="powered-pill"><i /> Compression powered by <a href="https://tinypng.com/" target="_blank" rel="noreferrer">TinyPNG API</a></div>
              </div>

              <div className="upload-card">
                <div className="upload-card-top"><span className="upload-card-label">YOUR IMAGE WORKSPACE</span><span className="limit-pill">{queue.length}/{MAX_FILES} images</span></div>
                <button
                  className={dragging ? "dropzone is-dragging" : "dropzone"}
                  type="button"
                  onClick={() => !busy && input.current?.click()}
                  onDragEnter={(event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); if (!busy) setDragging(true); }}
                  onDragOver={(event: DragEvent<HTMLButtonElement>) => event.preventDefault()}
                  onDragLeave={(event: DragEvent<HTMLButtonElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
                  onDrop={(event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); setDragging(false); if (!busy) addFiles(event.dataTransfer.files); }}
                  disabled={busy}
                >
                  <span className="upload-icon-wrap"><Icon name="upload" size={27} /></span>
                  <strong className="drop-title">{dragging ? "Drop them right here" : "Drop your images here"}</strong>
                  <span className="drop-subtitle">or <b>browse files</b> from your device</span>
                  <span className="format-note">PNG · JPG · WebP · AVIF · JXL <i /> Up to 20 MB each</span>
                </button>
                <input
                  ref={input}
                  className="visually-hidden"
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.avif,.jxl,image/png,image/jpeg,image/webp,image/avif,image/jxl"
                  multiple
                  onChange={(event) => { if (event.currentTarget.files) addFiles(event.currentTarget.files); event.currentTarget.value = ""; }}
                />
                <div className="upload-footnote"><Icon name="shield" size={17} /><span>Images are sent to Tinify for compression. <a href={pageHref("privacy")}>Privacy details</a></span></div>
              </div>
            </div>
            <div className="hero-bottom-glow" />
          </section>

          <section className="tool-section" id="tool">
            <div className="section-heading">
              <div><span className="eyebrow"><i className="eyebrow-dot" /> BATCH COMPRESSOR</span><h2>Your images, <em>all in one place.</em></h2><p>Queue your files, start compression, and keep an eye on every result.</p></div>
              <div className="secure-note"><Icon name="shield" size={18} /><span>Secure transfer<br /><small>Processed by Tinify</small></span></div>
            </div>
            {notice && <div className="notice" role="alert"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}><Icon name="close" size={16} /></button></div>}

            {queue.length === 0 ? (
              <div className="empty-state">
                <span className="empty-illustration"><Icon name="image" size={27} /></span>
                <h3>Your image list is waiting</h3>
                <p>Choose files above to see their previews and compression results here.</p>
                <a href={import.meta.env.BASE_URL} onClick={goToTool}>Add images <Icon name="arrow" size={15} /></a>
              </div>
            ) : (
              <div className="queue-panel">
                <div className="queue-toolbar">
                  <div className="queue-title"><span className="queue-title-icon"><Icon name="image" size={18} /></span><span><strong>Your batch</strong><small>{queue.length} of {MAX_FILES} images selected</small></span></div>
                  <div className="queue-toolbar-actions">
                    {errorCount > 0 && !busy && <button className="text-button retry-button" type="button" onClick={() => void runCompression(true)}>Retry {errorCount} failed</button>}
                    <button className="text-button" type="button" onClick={clearQueue} disabled={busy}>Clear all</button>
                  </div>
                </div>
                {compressing && (
                  <div className="progress-card" aria-live="polite">
                    <div className="progress-heading">
                      <div><span className="progress-state"><i className="spinner" /> Optimizing your images</span><p>{run.finished} of {run.total} complete{run.current ? " · Now: " + run.current : ""}</p></div>
                      <strong>{runPercent}%</strong>
                    </div>
                    <div className="progress-track"><span style={{ width: String(runPercent) + "%" }} /></div>
                  </div>
                )}
                {zipping && <div className="zip-progress" aria-live="polite"><i className="spinner small" /> Building your ZIP file · {zipProgress}%</div>}

                <div className="file-list">
                  {queue.map((item) => {
                    const originalSize = item.file.size;
                    const resultSize = item.output?.size;
                    const saved = resultSize === undefined ? 0 : savings(originalSize, resultSize);
                    return (
                      <article className={"file-row status-" + item.status} key={item.id}>
                        <div className="file-thumb">
                          <img src={item.preview} alt="" onError={(event) => { event.currentTarget.style.opacity = "0"; }} />
                          <span>{item.file.name.split(".").pop()?.toUpperCase() || "IMG"}</span>
                        </div>
                        <div className="file-main">
                          <div className="file-name-line">
                            <strong title={item.file.name}>{item.file.name}</strong>
                            <span className={"status-label " + item.status}>
                              {item.status === "queued" && "Ready"}
                              {item.status === "compressing" && <><i className="mini-spinner" /> Optimizing</>}
                              {item.status === "done" && <><Icon name="check" size={14} /> Complete</>}
                              {item.status === "error" && "Needs attention"}
                            </span>
                          </div>
                          <div className="file-meta">
                            <span>{bytes(originalSize)}</span>
                            {resultSize !== undefined && <><span className="meta-arrow">→</span><strong>{bytes(resultSize)}</strong><span className={saved > 0 ? "saved-pill" : "same-pill"}>{saved > 0 ? saved + "% smaller" : "Optimized"}</span></>}
                          </div>
                          {item.status === "compressing" && <div className="file-indeterminate"><span /></div>}
                          {item.status === "error" && <p className="file-error">{item.error}</p>}
                        </div>
                        <div className="file-actions">
                          {item.status === "done" && <button className="download-button" type="button" onClick={() => downloadItem(item)}><Icon name="download" size={16} /><span>Download</span></button>}
                          {item.status === "queued" && !busy && <span className="queued-dot-label"><i /> In queue</span>}
                          {!busy && item.status !== "compressing" && <button className="remove-button" type="button" onClick={() => removeItem(item.id)} aria-label={"Remove " + item.file.name}><Icon name="close" size={16} /></button>}
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className="queue-footer">
                  <div className="queue-summary"><span><strong>{doneCount}</strong> compressed</span>{errorCount > 0 && <span className="summary-error"><strong>{errorCount}</strong> need attention</span>}</div>
                  <div className="queue-buttons">
                    <button className="secondary-button" type="button" onClick={() => input.current?.click()} disabled={busy || queue.length >= MAX_FILES}><Icon name="upload" size={17} /> Add images</button>
                    {doneCount > 1 && <button className="secondary-button" type="button" onClick={() => void downloadAll()} disabled={busy}><Icon name="download" size={17} /> Download all (.zip)</button>}
                    <button className="primary-button" type="button" onClick={() => void runCompression()} disabled={busy || pendingCount === 0}>
                      {compressing ? <><i className="spinner small light-spinner" /> Working...</> : <><Icon name="sparkle" size={17} /> Compress {pendingCount || ""} {pendingCount === 1 ? "image" : "images"}</>}
                    </button>
                  </div>
                </div>
              </div>
            )}
            <p className="batch-hint"><Icon name="shield" size={15} /> Images are processed by Tinify and returned for download. This app does not keep image files.</p>
          </section>
          <section className="info-section">
            <div className="info-grid">
              <div className="info-copy">
                <span className="eyebrow"><i className="eyebrow-dot" /> LIGHTER FILES, FASTER PAGES</span>
                <h2>Image compression that fits your workflow.</h2>
                <p>Large image files can slow down websites, take longer to share, and use more storage. Squeeze Studio helps you optimize a small batch at once, compare the results, and save the versions you need.</p>
                <p>Add up to 10 supported images, start the batch, then download each optimized file or bundle completed results into a ZIP archive.</p>
                <a className="inline-link" href={pageHref("faq")}>How it works <Icon name="arrow" size={16} /></a>
              </div>
              <div className="steps-card">
                <div className="step-item"><span className="step-number">01</span><div><strong>Select a batch</strong><p>Choose up to 10 PNG, JPEG, WebP, AVIF, or JPEG XL images.</p></div></div>
                <div className="step-item"><span className="step-number">02</span><div><strong>Let Tinify optimize</strong><p>Each image is sent securely to Tinify and processed in sequence.</p></div></div>
                <div className="step-item"><span className="step-number">03</span><div><strong>Compare and save</strong><p>Review the final file size, then download one image or a ZIP.</p></div></div>
              </div>
            </div>
          </section>

          <section className="format-section">
            <div className="format-inner">
              <div><span className="eyebrow light"><Icon name="sparkle" size={14} /> SUPPORTED FORMATS</span><h2>Bring your images.<br /><span>We’ll handle the shrinking.</span></h2></div>
              <div className="format-list"><span>PNG</span><span>JPEG</span><span>WebP</span><span>AVIF</span><span>JPEG XL</span><p>Format support is provided by the Tinify API. Results depend on provider support.</p><a className="coffee-button format-coffee" href="https://buymeacoffee.com/devxaditya" target="_blank" rel="noreferrer"><span aria-hidden="true">&#9749;</span> Buy me a coffee</a></div>
            </div>
          </section>

          <section className="home-faq">
            <div className="section-heading compact-heading">
              <div><span className="eyebrow"><i className="eyebrow-dot" /> QUICK ANSWERS</span><h2>A few things to <em>know.</em></h2></div>
              <a className="inline-link" href={pageHref("faq")}>View all FAQs <Icon name="arrow" size={16} /></a>
            </div>
            <div className="faq-preview-grid">
              <article><h3>How many images can I compress?</h3><p>You can select up to 10 images in one batch. Add more after the current batch is cleared.</p></article>
              <article><h3>Where do my images go?</h3><p>When you start compression, each selected file is sent to Tinify’s API. See the privacy page for details.</p></article>
              <article><h3>Can I save all results together?</h3><p>Yes. After at least two images finish, use Download all to create one ZIP archive.</p></article>
            </div>
          </section>
        </main>
      )}

      {page !== "home" && (
        <main className="content-page">
          <div className="content-hero">
            <span className="eyebrow"><i className="eyebrow-dot" /> SQUEEZE STUDIO</span>
            <h1>{page === "faq" ? "Frequently asked questions" : page === "privacy" ? "Privacy, in plain language." : page === "terms" ? "Terms of use" : "We’re here to help."}</h1>
            <p>{page === "faq" ? "Answers about formats, compression, downloads, and your files." : page === "privacy" ? "What happens to your images when you use this tool." : page === "terms" ? "A few simple terms for using this independent image compressor." : "Have a question about the tool? Send us a note."}</p>
          </div>
          <div className="prose-card">
            {page === "faq" && <FaqPage />}
            {page === "privacy" && <PrivacyPage />}
            {page === "terms" && <TermsPage />}
            {page === "contact" && <ContactPage />}
          </div>
        </main>
      )}
      <footer className="site-footer">
        <div className="footer-main">
          <div className="footer-brand"><a className="brand" href={import.meta.env.BASE_URL} aria-label="Squeeze Studio home"><BrandMark /></a><p>A simple workspace for smaller, optimized images.</p></div>
          <nav className="footer-links" aria-label="Footer navigation"><span className="footer-label">Explore</span><div className="footer-link-list">{links.map((link) => <a key={link.page} href={pageHref(link.page)}>{link.label}</a>)}</div></nav>
          <div className="footer-credit"><span>Powered by</span><a href="https://tinypng.com/" target="_blank" rel="noreferrer">TinyPNG API <Icon name="arrow" size={13} /></a><a className="coffee-button footer-coffee" href="https://buymeacoffee.com/devxaditya" target="_blank" rel="noreferrer"><span aria-hidden="true">&#9749;</span> Buy me a coffee</a></div>
        </div>
        <div className="footer-bottom"><span>© {new Date().getFullYear()} Squeeze Studio</span><span>Independent project · Not affiliated with TinyPNG or Tinify</span></div>
      </footer>
    </div>
  );
}

function FaqPage() {
  const entries = [
    ["How many images can I upload?", "You can select up to 10 images per batch. Each file can be up to 20 MB. Clear the current batch to start another one."],
    ["Which image formats are supported?", "The tool accepts PNG, JPEG, WebP, AVIF, and JPEG XL images, subject to the Tinify API’s current support."],
    ["How does compression work?", "When you press Compress, the app sends each image to the Tinify API over HTTPS. The optimized image is returned to your browser."],
    ["Can I see how much space I saved?", "Each completed row shows the original size, optimized size, and percentage change. If the result is not smaller, it is labeled Optimized."],
    ["Can I download all images together?", "Yes. When at least two images are complete, choose Download all (.zip). You can also download each result separately."],
    ["Are my images stored by Squeeze Studio?", "This app does not save uploaded files to its own storage. Images are sent to Tinify for processing; Tinify’s service and policies apply."],
    ["Why does compression need a server endpoint?", "GitHub Pages hosts the static interface. The private Tinify API key needs a server-side endpoint, hosted separately or with a serverless platform."],
    ["What if the API limit is reached?", "The app shows the provider’s limit or rate-limit response. Wait for the account quota to reset or use an appropriate Tinify plan."],
  ];
  return <div className="faq-list">{entries.map(([question, answer], index) => <details key={question} open={index === 0}><summary><span>{question}</span><i /></summary><p>{answer}</p></details>)}</div>;
}

function PrivacyPage() {
  return (
    <div className="legal-copy">
      <p className="updated">Last updated: October 16, 2026</p>
      <h2>Images you choose</h2>
      <p>Images remain in your browser until you start compression. When you do, each selected image is sent over HTTPS to Tinify’s API, which processes it and returns an optimized image. This app does not save image files to its own storage.</p>
      <h2>Provider processing</h2>
      <p>Compression is provided by Tinify. The provider’s own service terms and privacy practices apply to files submitted for compression. Review Tinify’s current documentation and terms before uploading sensitive or confidential images.</p>
      <h2>Information collected by this app</h2>
      <p>This app does not include user accounts, an analytics tracker, or an image database. Selected files and previews are managed in the browser session. The hosting provider may process standard technical request logs.</p>
      <h2>Your choices</h2>
      <p>You choose which files to select and when to start. Remove files from the queue or close the page to clear the current session’s previews. Do not upload content you do not have permission to process.</p>
      <h2>Questions</h2>
      <p>For questions about this website, email <a href="mailto:aditya07acc@gmail.com">aditya07acc@gmail.com</a>. For questions about Tinify’s processing, contact Tinify directly.</p>
    </div>
  );
}
function TermsPage() {
  return (
    <div className="legal-copy">
      <p className="updated">Last updated: October 16, 2026</p>
      <h2>Using the tool</h2>
      <p>You may use Squeeze Studio to submit supported images for compression, subject to the Tinify API’s availability, limits, and applicable terms. You are responsible for having the rights and permissions needed to upload each image.</p>
      <h2>Third-party service</h2>
      <p>Compression is performed by Tinify. This independent project is not operated by or affiliated with TinyPNG or Tinify. The “powered by Tinify” credit identifies the compression provider and does not imply endorsement.</p>
      <h2>Availability and results</h2>
      <p>The service is provided as available. Compression results, supported formats, response times, and usage limits can depend on the provider and your configured API account. Keep your original files until you have checked the downloaded results.</p>
      <h2>Acceptable use</h2>
      <p>Do not use the tool to upload unlawful content, infringe another person’s rights, interfere with the service, or bypass provider limits. API credentials must be configured server-side and kept private.</p>
      <h2>Changes and contact</h2>
      <p>These terms may change as the project evolves. Questions can be sent to <a href="mailto:aditya07acc@gmail.com">aditya07acc@gmail.com</a>.</p>
    </div>
  );
}

function ContactPage() {
  return (
    <div className="contact-card">
      <span className="contact-icon"><Icon name="image" size={24} /></span>
      <h2>Questions, ideas, or a bug to report?</h2>
      <p>We’d love to hear what you think. Email is the best way to reach us—there’s no contact form, and you stay in control of what you share.</p>
      <a className="email-link" href="mailto:aditya07acc@gmail.com">aditya07acc@gmail.com <Icon name="arrow" size={17} /></a>
      <p className="contact-note">For API account, billing, or Tinify processing questions, please contact Tinify support directly.</p>
    </div>
  );
}

export default App;





