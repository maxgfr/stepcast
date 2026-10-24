/**
 * Big demos travel as a secret GitHub Gist: the bundle goes up with your own
 * token (gist scope), and the link carries only the Gist id. Anyone with the
 * link can read it; nothing else lists it. The token is kept encrypted under a
 * non-extractable WebCrypto key, like the AI keys.
 */
const API = "https://api.github.com";
const FILE = "stepcast-demo.txt";
const DB = "stepcast-vault";

function idb<T>(fn: (s: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = fn(open.result.transaction("kv", mode).objectStore("kv"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}

async function cryptoKey(): Promise<CryptoKey> {
  const existing = await idb<CryptoKey | undefined>((s) => s.get("key"), "readonly");
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  await idb((s) => s.put(key, "key"), "readwrite");
  return key;
}

export async function saveGithubToken(token: string): Promise<void> {
  if (!token) {
    await idb((s) => s.delete("token"), "readwrite");
    return;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await cryptoKey(),
    new TextEncoder().encode(token),
  );
  await idb((s) => s.put({ iv, data }, "token"), "readwrite");
}

export async function loadGithubToken(): Promise<string> {
  try {
    const rec = await idb<{ iv: Uint8Array; data: ArrayBuffer } | undefined>(
      (s) => s.get("token"),
      "readonly",
    );
    if (!rec) return "";
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: rec.iv as BufferSource },
      await cryptoKey(),
      rec.data,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return "";
  }
}

async function failure(res: Response): Promise<Error> {
  let msg = `GitHub answered ${res.status}`;
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message) msg += `: ${body.message.slice(0, 200)}`;
  } catch {
    // No JSON body.
  }
  if (res.status === 401) msg += ". Check the token.";
  if (res.status === 403 || res.status === 404)
    msg += ". The token needs the gist scope (or Gists: read and write).";
  return new Error(msg);
}

export async function publishGist(token: string, bundle: string, title: string): Promise<string> {
  const res = await fetch(`${API}/gists`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      description: `stepcast demo: ${title}`,
      public: false,
      files: {
        [FILE]: { content: bundle },
        "README.md": {
          content: `# ${title}\n\nAn interactive demo made with [stepcast](https://maxgfr.github.io/stepcast/). Open it at the link you were given; this file holds the demo's data.\n`,
        },
      },
    }),
  });
  if (!res.ok) throw await failure(res);
  const gist = (await res.json()) as { id: string };
  return gist.id;
}

export async function fetchGist(id: string): Promise<string> {
  if (!/^[0-9a-f]{20,40}$/i.test(id)) throw new Error("This Gist id is not valid.");
  const res = await fetch(`${API}/gists/${id}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw await failure(res);
  const gist = (await res.json()) as {
    files: Record<string, { content?: string; truncated?: boolean; raw_url?: string }>;
  };
  const file = gist.files[FILE];
  if (!file) throw new Error("This Gist holds no stepcast demo.");
  if (!file.truncated && file.content) return file.content;
  if (!file.raw_url?.startsWith("https://gist.githubusercontent.com/"))
    throw new Error("This Gist cannot be read.");
  const raw = await fetch(file.raw_url);
  if (!raw.ok) throw await failure(raw);
  return raw.text();
}
