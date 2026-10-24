/**
 * Projects in IndexedDB. A project's JSON (the demo, the captured frames) is
 * small and rewritten on every edit; its images and the recording are Blobs,
 * written once under `<projectId>:<key>` and never copied again.
 */
import type { Box, Demo } from "./demo";

export interface Frame {
  id: string;
  /** Blob key of the full-resolution screenshot. */
  asset: string;
  /** Seconds into the recording. */
  time: number;
  /** Region that changed since the previous frame, normalized. */
  diff: Box | null;
  /** Taken by hand (Snap step) rather than detected. */
  pinned: boolean;
  width: number;
  height: number;
}

export interface Project {
  id: string;
  /** The demo; `step.image` is a blob key, `demo.images` stays empty here. */
  demo: Demo;
  frames: Frame[];
  /** Blob key of the recording, when there is one. */
  recording: string | null;
  createdAt: number;
  updatedAt: number;
}

const DB_NAME = "stepcast";
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("projects"))
        db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("IndexedDB is not available"));
    };
  });
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(
  name: "projects" | "blobs",
  mode: IDBTransactionMode,
): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export async function listProjects(): Promise<Project[]> {
  const all = (await done((await store("projects", "readonly")).getAll())) as Project[];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<Project | null> {
  return (
    ((await done((await store("projects", "readonly")).get(id))) as Project | undefined) ?? null
  );
}

export async function saveProject(project: Project): Promise<void> {
  await done((await store("projects", "readwrite")).put({ ...project, updatedAt: Date.now() }));
}

export async function putBlob(projectId: string, key: string, blob: Blob): Promise<void> {
  await done((await store("blobs", "readwrite")).put(blob, `${projectId}:${key}`));
}

export async function getBlob(projectId: string, key: string): Promise<Blob | null> {
  return (
    ((await done((await store("blobs", "readonly")).get(`${projectId}:${key}`))) as
      | Blob
      | undefined) ?? null
  );
}

export async function deleteProject(id: string): Promise<void> {
  await done((await store("projects", "readwrite")).delete(id));
  await done((await store("blobs", "readwrite")).delete(IDBKeyRange.bound(`${id}:`, `${id}:￿`)));
}
