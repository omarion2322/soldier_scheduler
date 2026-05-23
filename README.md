# Soldier Scheduler

Mobile-friendly web app for soldiers to mark shift preferences (Prefer / Can't / Neutral) for each
day across 8 weeks (Tue **May 26 → Sat Jul 18, 2026**). Three shifts per day: Morning (06–14),
Afternoon (14–22), Night (22–06). The last week is partial (Tue Jul 14 – Sat Jul 18).

- **Frontend:** React + TypeScript + Vite + Tailwind, hosted on GitHub Pages.
  Two pages: `/` (soldier preferences form) and `/algo` (admin auto-scheduler).
- **Storage:** Google Apps Script Web App writing to a Google Sheet. Free, no auth headaches,
  and whoever schedules shifts gets a spreadsheet view of all responses for free.
- **Identity:** Phone number is the canonical UUID (the name is display only). Soldiers can edit
  a submission until **Sunday 00:00 Asia/Jerusalem** of the week in question.

## Local development

```bash
npm install
cp .env.example .env        # then paste your Apps Script /exec URL into VITE_API_URL
npm run dev
```

Other scripts:

- `npm run build` — typecheck + production build
- `npm run lint` — ESLint
- `npm test` — Vitest (date/shift logic)
- `npm run typecheck` — `tsc --noEmit`
- `npm run format` — Prettier

## Backend setup (Google Apps Script)

1. Create a Google Sheet and copy its ID (the long string in the URL).
2. Open [script.google.com](https://script.google.com) → **New project**.
3. Replace `Code.gs` contents with [`apps-script/Code.gs`](apps-script/Code.gs).
4. Set `SHEET_ID` at the top of the file.
5. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Authorize the script when prompted. Copy the `/exec` URL.
7. Put that URL in:
   - Local: `.env` as `VITE_API_URL=...`
   - CI: Repo **Settings → Secrets and variables → Actions → Variables**, name `VITE_API_URL`.

The sheet will be auto-populated with a `responses` tab on first write. Each submission upserts by
`(phone, weekStart)` — older rows for that pair are deleted before new ones are inserted.

## GitHub Pages deployment

1. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and deploys.
2. In **Settings → Pages**, set Source to **GitHub Actions**.
3. The site will be served at `https://<user>.github.io/soldier_scheduler/`.
   If you fork under a different repo name, set the `VITE_BASE` env to `/<repo-name>/` before build.

## Project layout

```
src/
  lib/
    schedule.ts        # pure date/week/shift logic (unit-tested)
    schedule.test.ts
    types.ts
    storage.ts         # localStorage helpers (identity + drafts)
    api.ts             # talk to Apps Script
  components/
    WeekNav.tsx
    WeekView.tsx
    DayCard.tsx
    ShiftButton.tsx
    IdentityForm.tsx
    SubmitBar.tsx
  App.tsx              # composition + state
  main.tsx
apps-script/
  Code.gs              # backend Web App source
.github/workflows/
  deploy.yml           # CI + GH Pages deploy
```

## Notes

- Soldiers see only their own answers (the backend only reveals submissions matching the phone).
- A draft is autosaved to `localStorage` per (phone, week) so a refresh doesn't lose progress.
- The deadline is enforced both client-side (read-only UI) and server-side (Apps Script).

## Auto-scheduler page (`/algo`)

Open at `https://<user>.github.io/soldier_scheduler/algo` (no auth required).

For the selected week the page:

1. Loads every soldier's latest submission via the Apps Script `weekSubmissions` endpoint.
2. Pre-fills the **previous Wednesday** assignments. For weeks 2+, this is read from the
   previous week's `Week N Shifts` tab; for the very first week of the schedule the operator
   enters them manually. Any value can be edited before running.
3. Runs a greedy constraint solver in the browser:
   - Per slot: 1 מפקד חמ״ל + 2 סמב״צ (1 + 1 at night).
   - At least 2 shifts of rest between any soldier's consecutive assignments.
   - Even balance via min-count tie-break.
   - **Hard constraints:** any name already in the table — whether typed in
     manually, loaded from the sheet, or produced by a previous run — is locked.
     The solver counts it toward composition demand, reserves its rest gap, and
     never displaces it.
   - Relaxations (in order, each adds a visible warning): drop the rest gap to 1 → swap a
     missing role with the other position → leave the slot under-filled.
4. Shows the resulting schedule (every cell is an editable dropdown — pick or
   clear names at any time) plus a per-soldier shift count. `⛔` next to a name
   in the dropdown means that person marked the slot as "can't" / "at home" —
   you can still hard-assign them.
5. **Save to sheet** writes the result into the right-side `שיבוץ` block of the
   matching `Week N Shifts` tab. **Clear** wipes the table back to empty.

The build also emits `dist/404.html` (a copy of `index.html`) so GitHub Pages serves the SPA
on a direct refresh of `/algo`.
