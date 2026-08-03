import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, query } from "firebase/firestore";

export function createFirestoreStorage(db, uid) {
  const col = collection(db, "users", uid, "storage");

  return {
    async get(key) {
      try {
        const snap = await getDoc(doc(col, key));
        if (!snap.exists()) return null;
        return { key, value: snap.data().value };
      } catch (e) {
        console.error("storage.get failed", e);
        return null;
      }
    },

    async set(key, value) {
      try {
        await setDoc(doc(col, key), { value, updatedAt: Date.now() });
        return { key, value };
      } catch (e) {
        console.error("storage.set failed", e);
        return null;
      }
    },

    async delete(key) {
      try {
        await deleteDoc(doc(col, key));
        return { key, deleted: true };
      } catch (e) {
        console.error("storage.delete failed", e);
        return null;
      }
    },

    async list(prefix = "") {
      try {
        const snaps = await getDocs(query(col));
        const keys = snaps.docs.map((d) => d.id).filter((k) => k.startsWith(prefix));
        return { keys, prefix };
      } catch (e) {
        console.error("storage.list failed", e);
        return null;
      }
    },
  };
}
