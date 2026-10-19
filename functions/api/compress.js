const API_URL = "https://api.tinify.com/shrink";
const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "avif", "jxl"]);

function json(message, status, cors = {}) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...cors,
    },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return {};

  const requestOrigin = new URL(request.url).origin;
  const allowedOrigins = (env.ALLOWED_ORIGINS || "")
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const allowed = origin === requestOrigin || allowedOrigins.includes(origin);
  if (!allowed) return null;

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "X-Compression-Count",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function parseKeys(value) {
  return (value || "")
    .split(/[,\n]/)
    .map((key) => key.trim())
    .filter(Boolean);
}

function apiErrorMessage(payload, fallback) {
  return payload && typeof payload.message === "string"
    ? payload.message
    : fallback;
}

export async function onRequestOptions({ request, env }) {
  const cors = corsHeaders(request, env);
  if (cors === null) return json("This website is not allowed to use the API.", 403);
  return new Response(null, { status: 204, headers: cors });
}

export async function onRequestPost({ request, env }) {
  const cors = corsHeaders(request, env);
  if (cors === null) return json("This website is not allowed to use the API.", 403);

  const keys = parseKeys(env.TINIFY_API_KEYS);
  if (keys.length === 0) {
    return json("The compression service is not configured yet.", 503, cors);
  }

  const maxUploadMb = Math.max(1, Number(env.MAX_UPLOAD_MB) || 20);
  let form;
  try {
    form = await request.formData();
  } catch {
    return json("Please upload one supported image file.", 400, cors);
  }

  const file = form.get("image");
  if (!file || typeof file.arrayBuffer !== "function") {
    return json("Please choose an image to compress.", 400, cors);
  }

  if (file.size === 0) return json("The selected file is empty.", 400, cors);
  if (file.size > maxUploadMb * 1024 * 1024) {
    return json("This image is larger than the " + maxUploadMb + " MB per-file limit.", 413, cors);
  }

  const extension = (file.name.split(".").pop() || "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return json("Use a PNG, JPEG, WebP, AVIF, or JPEG XL image.", 415, cors);
  }

  const imageBytes = await file.arrayBuffer();
  let shrinkResponse;
  let usedKey = null;

  // Additional keys can recover from an explicitly invalid credential. Monthly
  // quota and rate-limit responses are returned to the user, never bypassed.
  for (const key of keys) {
    const authorization = "Basic " + btoa("api:" + key);
    try {
      shrinkResponse = await fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": file.type || "application/octet-stream",
        },
        body: imageBytes,
      });
    } catch {
      return json("Tinify could not be reached. Please try again in a moment.", 502, cors);
    }

    if (shrinkResponse.status === 401) {
      const authPayload = await shrinkResponse.clone().json().catch(() => null);
      const authMessage = (authPayload?.message || "").toLowerCase();
      if (authMessage.includes("credentials are invalid")) continue;
      return json(
        apiErrorMessage(authPayload, "Tinify rejected the API credentials."),
        502,
        cors,
      );
    }

    usedKey = key;
    break;
  }

  if (!usedKey || !shrinkResponse) {
    return json("No configured Tinify API key was accepted.", 502, cors);
  }

  if (!shrinkResponse.ok) {
    const payload = await shrinkResponse.json().catch(() => null);
    if (shrinkResponse.status === 429) {
      return json(
        "Tinify has temporarily limited this request or the account quota is exhausted. Please wait or review the API plan.",
        429,
        cors,
      );
    }
    if (shrinkResponse.status === 400) {
      return json(apiErrorMessage(payload, "Tinify could not process this image."), 422, cors);
    }
    if (shrinkResponse.status >= 500) {
      return json("Tinify is temporarily unavailable. Please try again later.", 502, cors);
    }
    return json(apiErrorMessage(payload, "Tinify could not compress this image."), 502, cors);
  }

  const outputUrl = shrinkResponse.headers.get("Location");
  if (!outputUrl) {
    return json("Tinify did not return the compressed image.", 502, cors);
  }

  let outputResponse;
  try {
    outputResponse = await fetch(outputUrl, {
      headers: { Authorization: "Basic " + btoa("api:" + usedKey) },
    });
  } catch {
    return json("The compressed image could not be downloaded from Tinify.", 502, cors);
  }

  if (!outputResponse.ok) {
    return json("The compressed image could not be downloaded from Tinify.", 502, cors);
  }

  const headers = {
    "Content-Type":
      outputResponse.headers.get("Content-Type") ||
      file.type ||
      "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Original-Size": String(file.size),
  };
  const compressedSize = outputResponse.headers.get("Content-Length");
  if (compressedSize) headers["X-Compressed-Size"] = compressedSize;

  const compressionCount = shrinkResponse.headers.get("Compression-Count");
  if (compressionCount) headers["X-Compression-Count"] = compressionCount;
  Object.assign(headers, cors);

  return new Response(outputResponse.body, { status: 200, headers });
}
