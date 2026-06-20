import type { Driver } from '../types';

export function sessionStorageDriver(): Driver {
  return {
    name: 'sessionStorage',

    available() {
      try {
        const key = '__atorage_test__';
        window.sessionStorage.setItem(key, '1');
        window.sessionStorage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },

    async get(key) {
      const raw = window.sessionStorage.getItem(key);
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    },

    async set(key, value) {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    },

    async del(key) {
      window.sessionStorage.removeItem(key);
    },

    async has(key) {
      return window.sessionStorage.getItem(key) !== null;
    },

    async keys(prefix?) {
      const result: string[] = [];
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
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
