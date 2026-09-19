const DATABASE_NAME = "ai-life-health-offline";
const STORE_NAME = "requests";

function openDatabase(indexedDB) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("createdAt", "createdAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function completeRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function serializeBody(body) {
  if (body instanceof FormData) {
    return {
      bodyKind: "form",
      entries: Array.from(body.entries()).map(([name, value]) => value instanceof Blob
        ? { name, kind: "blob", value, fileName: value.name || "upload.bin" }
        : { name, kind: "text", value })
    };
  }
  return { bodyKind: "text", bodyText: body === undefined || body === null ? "" : String(body) };
}

function buildRequest(record) {
  const headers = new Headers(record.headers);
  if (record.bodyKind === "form") {
    headers.delete("Content-Type");
    const body = new FormData();
    record.entries.forEach((entry) => {
      if (entry.kind === "blob") body.append(entry.name, entry.value, entry.fileName);
      else body.append(entry.name, entry.value);
    });
    return { headers, body };
  }
  return { headers, body: record.bodyText };
}

export function isNetworkFailure(error) {
  return error instanceof TypeError && /fetch|network|load/i.test(error.message);
}

export function createHealthOfflineQueue({ indexedDB = globalThis.indexedDB, fetchImpl = globalThis.fetch } = {}) {
  if (!indexedDB) throw new Error("此浏览器不支持离线队列。");

  async function withStore(mode, callback) {
    const database = await openDatabase(indexedDB);
    try { return await callback(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME)); }
    finally { database.close(); }
  }

  async function enqueue({ path, method, headers, body }) {
    const record = { id: globalThis.crypto?.randomUUID?.() || `offline_${Date.now()}_${Math.random().toString(16).slice(2)}`, path, method, headers: Array.from(new Headers(headers).entries()), createdAt: Date.now(), ...serializeBody(body) };
    await withStore("readwrite", (store) => completeRequest(store.add(record)));
    return record.id;
  }

  async function count() {
    return withStore("readonly", (store) => completeRequest(store.count()));
  }

  async function records() {
    return withStore("readonly", (store) => new Promise((resolve, reject) => {
      const values = [];
      const cursor = store.index("createdAt").openCursor();
      cursor.onsuccess = () => { const item = cursor.result; if (!item) { resolve(values); return; } values.push(item.value); item.continue(); };
      cursor.onerror = () => reject(cursor.error);
    }));
  }

  async function remove(id) {
    await withStore("readwrite", (store) => completeRequest(store.delete(id)));
  }

  async function replay(apiRoot) {
    let completed = 0;
    for (const record of await records()) {
      try {
        const { headers, body } = buildRequest(record);
        const response = await fetchImpl(`${apiRoot}${record.path}`, { method: record.method, headers, body, credentials: "same-origin" });
        if (!response.ok) break;
        await remove(record.id);
        completed += 1;
      } catch {
        break;
      }
    }
    return completed;
  }

  return { enqueue, count, replay };
}
