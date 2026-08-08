'use strict';

const DB_NAME = 'suivi-sport';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const store = db.createObjectStore('sessions', { keyPath: 'id' });
        store.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('machines')) {
        const store = db.createObjectStore('machines', { keyPath: 'id' });
        store.createIndex('type', 'type');
      }
      if (!db.objectStoreNames.contains('weights')) {
        const store = db.createObjectStore('weights', { keyPath: 'id' });
        store.createIndex('date', 'date');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  async getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return reqToPromise(store.getAll());
  },

  async get(storeName, id) {
    const store = await tx(storeName, 'readonly');
    return reqToPromise(store.get(id));
  },

  async put(storeName, value) {
    const store = await tx(storeName, 'readwrite');
    await reqToPromise(store.put(value));
    return value;
  },

  async delete(storeName, id) {
    const store = await tx(storeName, 'readwrite');
    return reqToPromise(store.delete(id));
  },

  async clear(storeName) {
    const store = await tx(storeName, 'readwrite');
    return reqToPromise(store.clear());
  },

  async bulkPut(storeName, values) {
    const store = await tx(storeName, 'readwrite');
    for (const value of values) {
      store.put(value);
    }
    return new Promise((resolve, reject) => {
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () => reject(store.transaction.error);
    });
  },

  uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  },
};

window.DB = DB;
