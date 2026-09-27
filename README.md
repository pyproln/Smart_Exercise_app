# My Home Workout

A personal workout app for two profiles, backed by a Google Sheet. This version is split into two parts:

- **Backend** (`Code.gs`) — an Apps Script Web App that reads/writes your Google Sheet and answers as a JSON API.
- **Frontend** (`index.html` + `manifest.json` + `sw.js` + `icon.svg`) — a static, installable PWA hosted on GitHub Pages that calls that API.

This split is what makes it possible to host the app on GitHub (Apps Script alone can't be hosted there) and makes it installable to a phone's home screen.

## Features in this version

- Today's workout, full-screen exercise execution, full-screen rest timer (30s between sets, 15s between exercises, no rest after the final set), next-exercise preview
- Weight/waist progress logging with trend charts
- Workout history
- Personal records (best reps/hold time per exercise, from your actual logged sets)
- Dashboard (sessions this week, 6-week session trend, weight/waist charts, PRs)
- "Regenerate My Weekly Plan" — builds a fresh week of workouts from your goals/equipment (see `PROFILE_CONFIG` in `Code.gs`)
- Installable as a PWA (Add to Home Screen)
- Exercise demo video links (from your Exercises sheet's video column), if present
- Basic in-app notification reminder (works while the app is open; true background push isn't possible without a paid push-notification backend, which this doesn't use)

## Part 1: Deploy the backend (Apps Script)

1. Open your existing Google Sheet → **Extensions → Apps Script**.
2. Replace the contents of your script file with the new `Code.gs` provided here. (This is a full replacement — it includes everything your old file did, plus the new functions.)
3. Click **Deploy → New deployment**.
4. Click the gear icon next to "Select type" → choose **Web app**.
5. Settings:
   - **Execute as:** Me
   - **Who has access:** Anyone
6. Click **Deploy**, authorize the permissions it asks for, then **copy the Web App URL** (ends in `/exec`).

Keep that URL handy — you'll paste it into the frontend next.

> If you ever edit `Code.gs` again, you must go to **Deploy → Manage deployments → Edit (pencil) → New version → Deploy** for changes to take effect. Saving the script alone does not update the live API.

## Part 2: Configure the frontend

1. Open `index.html` in a text editor.
2. Find this line near the top of the `<script>` section:
   ```js
   const API_BASE_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";
   ```
3. Replace the placeholder with your actual `/exec` URL from Part 1.

## Part 3: Test locally

```bash
python3 -m http.server 8000
```
Open `http://localhost:8000` and try both profiles, a full workout, logging progress, and the dashboard.

## Part 4: Push to GitHub and go live

```bash
git init
git add .
git commit -m "My Home Workout app"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**.

Your live link: `https://YOUR-USERNAME.github.io/YOUR-REPO/`

That's what goes on your resume, alongside the repo link.

## Notes, limits, and what's next

- **Regenerate My Weekly Plan** uses the goals/equipment written into `PROFILE_CONFIG` at the top of `Code.gs` (since your Profiles sheet doesn't have goal columns). Edit that object directly to change goals, target muscle groups per day, or the number of exercises per day.
- It filters to exercises whose `Equipment` column matches what you own (dumbbells, pull-up bar, ab roller, resistance bands, bodyweight) — edit `OWNED_EQUIPMENT_KEYWORDS` in `Code.gs` if your equipment list changes.
- It does **not** yet use fine-grained goal tags (e.g. "posture", "stamina") because your `Exercises` sheet doesn't have that column — it currently matches on muscle group only. If you add a `Goal_Tags` column to `Exercises` (comma-separated values), tell me and I'll wire the generator to use it for sharper selection.
- Personal records are computed from whatever you log during a set (reps or seconds) — there's no "weight lifted" field yet. If you want PRs based on load (dumbbell/band weight used), that needs one more optional column in `Exercise_Log`.
- Android APK packaging (via PWABuilder or Bubblewrap) is a follow-up step once this is live and stable — say the word when you're ready for it.
