# Flarestamina

**Ignite Your Endurance.** Build better habits. Achieve bigger goals.

A complete, production-ready IELTS study platform built with **pure vanilla HTML / CSS / JS** (no build step, no frameworks) and backed by **Firebase v10** (Auth + Firestore) loaded over CDN. Deploys as a static site to GitHub Pages.

## What's inside

| Page | Path | Description |
|------|------|-------------|
| Landing | `index.html` | Hero + tools grid (40‑Day Challenge is live, the rest are "Coming Soon"). |
| Student Tracker | `challenge/index.html` | Google sign‑in, 40‑day plan with per‑task checkboxes, progress ring, streak heatmap, and class leaderboard. Real‑time sync across devices. PWA‑installable. |
| Teacher Dashboard | `teacher/index.html` | Gated to the teacher email. Students table with per‑student detail, Plan Manager (add/remove days), and a leaderboard. |

## Tech

- **Firebase v10 modular SDK** via `https://www.gstatic.com/firebasejs/10.12.2/...` (`<script type="module">`).
- **Firestore** data model: `plan/{idx}`, `users/{uid}`, `users/{uid}/progress/{taskId}`, `leaderboard/{uid}`.
- **PWA**: `manifest.json` + `sw.js` (network‑first; never caches Firebase/Google API traffic).
- **Brand**: emerald flame logo, dark default theme with a persisted light toggle, Plus Jakarta Sans + Space Mono.

## The 40‑day plan

The plan (38 active days, **265 tasks**, 5 Jun → 12 Jul 2026) is generated client‑side by `buildPlanDays()` in `challenge/index.html`. On the **first** load with an empty `plan` collection it auto‑seeds Firestore via `seedPlan()`. After that, the teacher can add/remove days from the dashboard.

## Setup

### 1. Firestore security rules

Paste the contents of [`firestore.rules`](firestore.rules) into **Firebase Console → Firestore → Rules → Publish**. They replace any earlier rules. (The teacher is identified by the email baked into the rules.)

### 2. Run locally

Google sign‑in popups require `http(s)` on an authorized domain — `localhost` is authorized by Firebase by default. **Do not** open the files via `file://`.

```bash
cd flarestamina
python3 -m http.server 8000
# open http://localhost:8000
```

First sign‑in seeds the plan; ticking a task saves to Firestore and survives refresh.

## Deploy (GitHub Pages)

1. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and deploys automatically.
2. In the repo: **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Pages → Custom domain:** `flarestamina.com` → Save → wait for the DNS check → **Enforce HTTPS**.

### DNS (Cloudflare, `flarestamina.com`)

Set **Proxy = DNS only (grey cloud)** for the apex `A` records:

```
A     @     185.199.108.153
A     @     185.199.109.153
A     @     185.199.110.153
A     @     185.199.111.153
CNAME www   maqsudjon-cell.github.io
```

## Notes

- The Firebase config is **public by design** — access is governed entirely by the Firestore security rules.
- `CNAME` pins the custom domain for GitHub Pages.

---

Built with passion · Flarestamina © 2026
