export type CompressionResult = {
  blob: Blob;
  compressedSize: number;
  compressionCount: string | null;
};

export async function compressImage(file: File): Promise<CompressionResult> {
  const apiBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "");
  const endpoint = (apiBase || "") + "/api/compress";
  const body = new FormData();
  body.append("image", file, file.name);

  let response: Response;
  try {
    response = await fetch(endpoint, { method: "POST", body });
  } catch {
    throw new Error("The compression service is not connected. Configure the API endpoint and try again.");
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message || "Compression failed. Check the API connection and try again.");
  }

  const blob = await response.blob();
  return {
    blob,
    compressedSize: blob.size,
    compressionCount: response.headers.get("X-Compression-Count"),
  };
}
