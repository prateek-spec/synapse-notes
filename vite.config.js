import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// IMPORTANT: change "synapse-notes" below to your GitHub repo name.
// Example: if your repo is github.com/yourname/my-notes-app,
// this should be base: "/my-notes-app/"
export default defineConfig({
  plugins: [react()],
  base: "/synapse-notes/",
});
