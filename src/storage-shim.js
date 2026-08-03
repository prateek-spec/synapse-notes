// The app was originally built as a Claude.ai "artifact", where
// window.storage is provided automatically. Outside of Claude.ai
// that API doesn't exist, so this shim recreates the same interface
// using the browser's built-in localStorage instead. Everything is
// saved on the device/browser you're using - it does not sync
// between devices or browsers.

function fullKey(key, shared) {
  // "shared" has no real meaning without a backend/server, so we
  // just namespace it separately to avoid collisions.
  return (shared ? "shared:" : "local:") + key;
}

window.storage = {
  async get(key, shared = false) {
    try {
      const raw = localStorage.getItem(fullKey(key, shared));
      if (raw === null) return null;
      return { key, value: raw, shared };
    } catch (e) {
      return null;
    }
  },

  async set(key, value, shared = false) {
    try {
      localStorage.setItem(fullKey(key, shared), value);
      return { key, value, shared };
    } catch (e) {
      return null;
    }
  },

  async delete(key, shared = false) {
    try {
      localStorage.removeItem(fullKey(key, shared));
      return { key, deleted: true, shared };
    } catch (e) {
      return null;
    }
  },

  async list(prefix = "", shared = false) {
    try {
      const wanted = fullKey(prefix, shared);
      const keys = Object.keys(localStorage)
        .filter((k) => k.startsWith(wanted))
        .map((k) => k.slice((shared ? "shared:" : "local:").length));
      return { keys, prefix, shared };
    } catch (e) {
      return null;
    }
  },
};
