import React, { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { auth, db } from "./firebase-config.js";
import { createFirestoreStorage } from "./firebase-storage.js";
import App from "./App.jsx";

export default function AuthGate() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        window.storage = createFirestoreStorage(db, u.uid);
      }
      setUser(u);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError((err.message || "Something went wrong").replace("Firebase: ", ""));
    }
    setBusy(false);
  }

  if (authLoading) {
    return (
      <div style={styles.loadingWrap}>
        <span>Loading…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={styles.wrap}>
        <form style={styles.card} onSubmit={handleSubmit}>
          <h1 style={styles.title}>Synapse Notes</h1>
          <p style={styles.sub}>
            {mode === "signup" ? "Create an account to sync your notes across devices." : "Sign in to access your notes."}
          </p>
          <input
            style={styles.input}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            style={styles.input}
            type="password"
            placeholder="Password (6+ characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          {error && <div style={styles.error}>{error}</div>}
          <button style={styles.button} type="submit" disabled={busy}>
            {busy ? "…" : mode === "signup" ? "Create Account" : "Sign In"}
          </button>
          <button
            type="button"
            style={styles.link}
            onClick={() => {
              setMode(mode === "signup" ? "signin" : "signup");
              setError("");
            }}
          >
            {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={styles.appShell}>
      <div style={styles.topbar}>
        <span style={styles.email}>{user.email}</span>
        <button style={styles.signout} onClick={() => signOut(auth)}>
          Sign out
        </button>
      </div>
      <div style={styles.appBody}>
        <App />
      </div>
    </div>
  );
}

const styles = {
  loadingWrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
    color: "#888",
  },
  wrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    background: "#faf9f4",
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
  },
  card: {
    width: 320,
    maxWidth: "90vw",
    background: "#fff",
    border: "1px solid #e2ded0",
    borderRadius: 14,
    padding: "28px 26px",
    boxShadow: "0 20px 60px rgba(0,0,0,.08)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  title: { margin: 0, fontSize: 22, fontWeight: 700, color: "#161511" },
  sub: { margin: "0 0 10px 0", fontSize: 13, color: "#8c8a80", lineHeight: 1.5 },
  input: {
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 14,
    outline: "none",
    fontFamily: "inherit",
  },
  error: { color: "#c0392b", fontSize: 12.5, marginTop: -2 },
  button: {
    background: "#5b46d6",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "11px 14px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 4,
  },
  link: {
    background: "transparent",
    border: "none",
    color: "#5b46d6",
    fontSize: 12.5,
    cursor: "pointer",
    padding: 4,
  },
  appShell: { display: "flex", flexDirection: "column", height: "100vh" },
  topbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
    padding: "6px 16px",
    background: "#212127",
    flexShrink: 0,
  },
  email: { color: "#c7c6cc", fontSize: 12, fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" },
  signout: {
    background: "transparent",
    border: "1px solid #3a3843",
    color: "#c7c6cc",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 11.5,
    cursor: "pointer",
  },
  appBody: { flex: 1, minHeight: 0 },
};
