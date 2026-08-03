# Synapse Notes

A block-based notes app (pages, backlinks, daily notes, todos, slash
commands, etc.) that runs entirely in your browser. No server, no
account, no backend — your notes are saved in the browser's
`localStorage` on whichever device/browser you use it in.

## Put it live on GitHub Pages (step by step)

### 1. Create a GitHub account (skip if you have one)
Go to https://github.com and sign up.

### 2. Create a new repository
- Click the **+** in the top right → **New repository**
- Name it anything, e.g. `synapse-notes`
- Keep it **Public**
- Don't add a README/gitignore (we already have them)
- Click **Create repository**

### 3. Match the repo name in the config
Open `vite.config.js` in this folder and make sure the `base` matches
your repo name exactly, including the slashes:

```js
base: "/synapse-notes/",
```

If you named your repo something else, e.g. `my-notes`, change it to
`base: "/my-notes/"`.

### 4. Upload this project to your new repo
The easiest way if you don't already use git: on your new repo's
GitHub page, click **uploading an existing file** and drag in every
file/folder from this project (keep the folder structure, including
the hidden `.github` folder — you may need to show hidden files, or
just use git as below).

Or, from a terminal, with git installed:

```bash
cd synapse-notes
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/synapse-notes.git
git push -u origin main
```

### 5. Turn on GitHub Pages
- In your repo, go to **Settings → Pages**
- Under **Build and deployment → Source**, choose **GitHub Actions**

That's it — the workflow in `.github/workflows/deploy.yml` will
build and publish the site automatically. Check the **Actions** tab
to watch it run (takes ~1-2 minutes).

### 6. Visit your live site
Once the Action finishes, your app is live at:

```
https://YOUR-USERNAME.github.io/synapse-notes/
```

This works in any browser, and on mobile too — Safari on iPhone,
Chrome on Android, etc. Since it's a real website (not a Claude
artifact), you can share this URL with anyone.

Every time you push new changes to `main`, it redeploys
automatically.

## Using it on mobile

Once it's live, open the link in your phone's browser and add it to
your home screen (Share → **Add to Home Screen** on iOS, or the
browser menu → **Add to Home screen** on Android) so it opens like a
regular app.

## Important: where your notes live

This app saves notes in the browser's `localStorage`, scoped to that
exact URL + browser combo. That means:

- Notes made in Chrome on your laptop won't show up in Safari on
  your phone — each browser/device has its own separate storage.
- Clearing your browser's site data/cache for this URL will erase
  your notes.
- There's no login and no cloud sync in this version — it's fully
  local/offline.

If you want your notes to sync across devices, that would need a
real backend (e.g. Firebase, Supabase) added — let me know if you'd
like help with that next.

## Local development

```bash
npm install
npm run dev
```

Opens a local dev server (usually http://localhost:5173) so you can
test changes before pushing.

## Alternative: even simpler hosting (no GitHub Pages config needed)

If the GitHub Pages `base` path setup above feels fiddly, two
services let you skip it entirely and are arguably easier for a
project like this:

- **Vercel** (https://vercel.com) — sign in with GitHub, "Import
  Project", pick this repo, click Deploy. No config file changes
  needed.
- **Netlify** (https://netlify.com) — same idea, drag-and-drop the
  `dist` folder after running `npm run build`, or connect the GitHub
  repo for auto-deploys.

Both give you a live `https://...` URL just like GitHub Pages.
