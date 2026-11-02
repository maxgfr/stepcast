import { sealedStore } from "llm-connect";

/**
 * Big demos travel as a secret GitHub Gist: the bundle goes up with your own
 * token (gist scope), and the link carries only the Gist id. Anyone with the
 * link can read it; nothing else lists it. The token is sealed under a
 * non-extractable WebCrypto key (llm-connect's sealedStore), like the AI keys.
 */
const API = "https://api.github.com";
const FILE = "stepcast-demo.txt";
const TOKEN = "github-token";
/** Before the sealed store: the key ("key") and the token sealed with it ("token"), store "kv". */
const LEGACY_DB = "stepcast-vault";

const secrets = sealedStore({ dbName: "stepcast-sealed" });
/** The token when the browser could not store it (storage full or blocked): this page only. */
let pageToken: string | null = null;

/** The legacy database, or null when there is none (opening it does not create it). */
function openLegacy(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let fresh = false;
    const open = indexedDB.open(LEGACY_DB);
    open.onupgradeneeded = () => {
      fresh = true;
      open.transaction?.abort();
    };
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      if (fresh || !open.result.objectStoreNames.contains("kv")) {
        open.result.close();
        resolve(null);
      } else resolve(open.result);
    };
  });
}

function dropLegacy(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(LEGACY_DB);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

/**
 * A token saved before the sealed store: opened with its old key, sealed in the new store,
 * and the old database removed only once the new copy is stored.
 */
async function migrateLegacy(): Promise<string | null> {
  const db = await openLegacy();
  if (!db) return null;
  const rec = await new Promise<{ key?: unknown; token?: { iv: Uint8Array; data: ArrayBuffer } }>(
    (resolve) => {
      try {
        const store = db.transaction("kv").objectStore("kv");
        const key = store.get("key");
        const token = store.get("token");
        store.transaction.oncomplete = () => resolve({ key: key.result, token: token.result });
        store.transaction.onerror = store.transaction.onabort = () => resolve({});
      } catch {
        resolve({});
      }
    },
  );
  db.close();
  if (!(rec.key instanceof CryptoKey) || !rec.token) return null;
  let token: string;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: rec.token.iv as BufferSource },
      rec.key,
      rec.token.data,
    );
    token = new TextDecoder().decode(plain);
  } catch {
    return null;
  }
  if (await secrets.set(TOKEN, token)) await dropLegacy();
  else pageToken = token;
  return token;
}

/** False when the browser could not store it (storage full or blocked): kept for this page only. */
export async function saveGithubToken(token: string): Promise<boolean> {
  if (!token) {
    await forgetGithubToken();
    return true;
  }
  if ((await secrets.get(TOKEN)) === token || (await secrets.set(TOKEN, token))) {
    pageToken = null;
    await dropLegacy();
    return true;
  }
  pageToken = token;
  return false;
}

export async function loadGithubToken(): Promise<string> {
  if (pageToken !== null) return pageToken;
  try {
    return (await secrets.get(TOKEN)) ?? (await migrateLegacy()) ?? "";
  } catch {
    return "";
  }
}

/** Removes the token from this device: the sealed copy, any older copy, and the page's. */
export async function forgetGithubToken(): Promise<void> {
  pageToken = null;
  await Promise.all([secrets.delete(TOKEN).catch(() => {}), dropLegacy()]);
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
