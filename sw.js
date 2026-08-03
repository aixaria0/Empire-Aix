/* Empire PWA — cache + Background Sync outbox */
const CACHE = "empire-pwa-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg",
  "./sw.js"
];

const DB_NAME = "empire-sync-db";
const STORE = "outbox";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllPending() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function deletePending(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function processOutbox() {
  const items = await getAllPending();
  for (const item of items) {
    try {
      // Demo delay — replace with real API:
      // await fetch("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
      await new Promise((r) => setTimeout(r, 200));
      await deletePending(item.id);

      const clientsList = await self.clients.matchAll({ type: "window" });
      for (const client of clientsList) {
        client.postMessage({ type: "SYNC_ITEM_DONE", id: item.id, payload: item });
      }
    } catch (err) {
      console.error("sync item failed", err);
      throw err; // keep item; browser retries later
    }
  }

  const clientsList = await self.clients.matchAll({ type: "window" });
  for (const client of clientsList) {
    client.postMessage({ type: "SYNC_COMPLETE", remaining: 0 });
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetched = fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});

// Background Sync event
self.addEventListener("sync", (event) => {
  if (event.tag === "empire-outbox-sync") {
    event.waitUntil(processOutbox());
  }
});

// Immediate flush from the page
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "PROCESS_OUTBOX_NOW") {
    event.waitUntil(processOutbox());
  }
});
