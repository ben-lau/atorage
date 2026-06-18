import type { Driver } from '../types.js';

export function localStorageDriver(): Driver {
  return {
    name: 'localStorage',

    available() {
      try {
        const key = '__atorage_test__';
        window.localStorage.setItem(key, '1');
        window.localStorage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },

    async get(key) {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    },

    async set(key, value) {
      window.localStorage.setItem(key, JSON.stringify(value));
    },

    async del(key) {
      window.localStorage.removeItem(key);
    },

    async has(key) {
      return window.localStorage.getItem(key) !== null;
    },

    async keys(prefix?) {
      const result: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key !== null) {
          if (prefix === undefined || key.startsWith(prefix)) {
            result.push(key);
          }
        }
      }
      return result;
    },

    async dispose() {},
  };
}
