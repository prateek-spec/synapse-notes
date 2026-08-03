import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBWNxKShRTi3vEppHiKlKFujv7a2TpAnlw",
  authDomain: "synapse-notes-77167.firebaseapp.com",
  projectId: "synapse-notes-77167",
  storageBucket: "synapse-notes-77167.firebasestorage.app",
  messagingSenderId: "36774475957",
  appId: "1:36774475957:web:569e7dff84f5c3c386a6fc",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
