const STORAGE_KEY = "nov_api_key";

function getKey(): string {
  return localStorage.getItem(STORAGE_KEY) || "";
}

export function setApiKey(key: string) {
  localStorage.setItem(STORAGE_KEY, key);
}

export function hasApiKey(): boolean {
  return !!getKey();
}

async function request(path: string, opts: RequestInit = {}): Promise<any> {
  const key = getKey();
  const res = await fetch(path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(opts.headers as Record<string, string>),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.message) || `HTTP ${res.status}`);
  return data;
}

export function getApiDocs() {
  return request("/api/openapi.json");
}

export function getQueue() {
  return request("/api/queue");
}
export function deleteFromQueue(key: string) {
  return request(`/api/queue/${encodeURIComponent(key)}`, { method: "DELETE" });
}
export function checkNovel(hash: string) {
  return request(`/api/books/${hash}`);
}
export function triggerAction() {
  return request("/api/trigger", { method: "POST" });
}

export function requestPresign(hash: string, size: number, title?: string) {
  return request("/api/upload/presign", {
    method: "POST",
    body: JSON.stringify({ hash, size, title }),
  });
}

export function uploadToR2(
  url: string,
  blob: Blob,
  onProgress?: (p: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`上传失败: HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("网络错误"));
    xhr.ontimeout = () => reject(new Error("上传超时"));
    xhr.send(blob);
  });
}
