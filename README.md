# Mind's Eye Lab

A free mental-imagery assessment and training app that doubles as a research instrument.
Participants enrol with an ID, answer demographics, and everything they do is stored on a server
you control. They can always see their own scores, on any device, by entering their ID and recovery code.

```
mindseye/
  web/index.html          the whole app (one file; set api-base to your server)
  server/server.js        Express + SQLite backend, admin dashboard, CSV/JSON export
  server/admin.html       researcher dashboard at /admin
  server/default-config.json  study config: consent text, arms, gating
  capacitor.config.json   iOS wrapper for the App Store
```

## 1. Run the server

```bash
cd server
npm install
cp .env.example .env        # set ADMIN_TOKEN to a long random string
npm start                   # http://localhost:3000  — admin at /admin
```

Deploy anywhere Node runs (Render, Fly.io, Railway, a Duke VM). SQLite lives in `server/data/`;
back that folder up. Put it behind HTTPS (the App Store requires it; most hosts do this for you).

## 2. Point the app at the server

In `web/index.html`, set:

```html
<meta name="api-base" content="https://your-server.example.edu">
```

With `SERVE_WEB=1` the same server also hosts the web version at `/`, so one URL serves both.
Leave `api-base` empty for a local-only build (nothing leaves the phone).

## 3. Build for iOS (App Store)

```bash
npm install
npx cap add ios
npx cap sync ios
npx cap open ios          # opens Xcode: set your team, bundle ID, icons, then Archive → Distribute
```

The app is a Capacitor shell around `web/`. Each time you edit `web/index.html`, run `npx cap sync ios`.
App Store notes: pick the "Health & Fitness" or "Education" category; the review team will ask for the
privacy policy URL and what data is collected (answers: questionnaire responses, task performance,
demographics, device model; no name, email or location). Research use needs IRB approval before release.

## 4. Configure the study (no code)

Open `/admin`, paste your admin token, and edit the config JSON:

| Field | Meaning |
| --- | --- |
| `status` | `required` (listed first), `optional`, `blocked` (shown as unavailable), `hidden` (not shown) |
| `requires` | keys that must be complete before this one unlocks, e.g. `["vviq"]` |
| `arms` | which study arms see it; omit for all. Arms in the top-level `arms` list are assigned server-side, balanced by count |
| `notBefore` | ISO date the item opens (e.g. a follow-up wave) |
| `consentText`, `studyInfo`, `consentVersion` | shown on the consent screen; bump the version when the wording changes |

Changes apply at each participant's next launch.

## 5. Data model

* `participants` — pid, hashed recovery code, arm, demographics, consent, device, latest snapshot.
* `events` — append-only log. One row per thing that happened, with the full payload (trial-level logs included):
  `enrol`, `screener`, `questionnaire`, `memory`, `task`, `strategy`, `checkin`, `training`, `experiment`.

Export from `/admin`: long-format CSV (one row per event, payload flattened) or everything as JSON.
In R: `jsonlite::fromJSON(df$log[i])` unpacks a trial log.

## 6. Privacy and consent

* Participants are identified only by the ID they enter or generate. Nothing links it to a name unless your study does.
* The recovery code is hashed on the server; it is never stored in the snapshot.
* Participants who decline research consent get a `LOCAL-` ID and nothing is uploaded.
* "Erase from this device" clears the phone; withdrawal is the admin's Delete button, which hard-deletes all rows.
* The questionnaire items are original paraphrases. Swap in the licensed VVIQ / Psi-Q / OSIVQ items before publishing results.

## What's inside the app

**Assessments:** single-item screener (asked before any framing), VVIQ-style vividness (16), multisensory (7 senses × 3),
object vs. spatial (8), memory & counterfactual (two timed writing prompts with ratings).

**Objective tasks:** mental rotation (16 trials at 45/90/135/180°, trial confidence, RT slope in ms/°, metacognitive
tracking), pattern span (adaptive), imagery colour match; post-task strategy rating after each.

**Multi-part tests:** imagery & perception (imagined colour vs. faint patch detection: facilitation/Perky interference,
false alarms), scene memory in two sessions a day apart (object recognition vs. location placement), imagery & feeling
(four scenes, arousal/valence/vividness, surprise detail memory), holding an image (vividness decay over 90 s with drift reports).

**Daily check-in** (vividness item + 6 rotation trials + confidence) and four **training games** with levels.

## 7. Getting it on phones fast

| Route | When it works | Notes |
| --- | --- | --- |
| **Web link** (`SERVE_WEB=1`, HTTPS host) | within the hour | Any phone, Safari "Add to Home Screen". Same data pipeline. Best for lab testing tomorrow. |
| **TestFlight, internal** | same day | Up to 100 testers on your App Store Connect team; no Apple review. Needs the archive uploaded from Xcode. |
| **TestFlight, external** | usually < 24 h | Public TestFlight link, up to 10,000 testers; a light "beta review" by Apple. |
| **App Store, public** | typically 1–3 days, first submission sometimes longer | Needs screenshots, privacy policy URL, App Privacy answers, age rating, and (because it collects research data) the consent screen you already have. |

Submit to the App Store today and use the web link or TestFlight tomorrow; both feed the same server.

## 8. Data dictionary (event payloads)

Every event row carries `pid, arm, type, day, client_time, server_time` plus the payload. Every payload carries
`ms` (duration of the activity in milliseconds), `tod` (hour of day, decimal), `dow` (0 = Sunday), and for
questionnaires/tasks/experiments `attempt` (1 = first time). `app` events log launch / foreground / background with the active panel.

| type | key fields |
| --- | --- |
| `enrol` | demographics, arm, consent (version, time), device (model string, screen, DPR, touch, platform, locale, timezone, appVersion) |
| `screener` | `v` single-item vividness (1–5), asked before any framing |
| `questionnaire` | `kind` (vviq / multi / spatial), `answers[]`, `itemRT[]` ms per item, `result` (total or per-modality means) |
| `memory` | recall and counterfactual: text, word count, vividness / detail / emotion / plausibility (1–7) |
| `state` | pre-task `alert` (1–5), `mood` (1–5), `env` (quiet / people / transit) |
| `task` kind=rot | `acc`, `rt`, `slope` ms/°, `meta` (accuracy sure − guessing), `log[]` per trial: angle, mirror, ok, rt, sure |
| `task` kind=span | `span`, `wins`, `log[]` per pattern: n, ok |
| `task` kind=col | `acc`, `log[]`: pair, ok, rt |
| `strategy` | task, strategy (visual / verbal / spatial / sensorimotor / mixed) |
| `checkin` | item, `viv` (1–5), `acc`, `rt`, `conf` (1–5), one per day |
| `training` | game, level, passed, score fields |
| `practice` | k (scene / object / senses / future / replay / sleep), `pre`, `post`, `ease` (1–7) |
| `experiment` kind=interference | hitCong, hitIncong, fa, effect, `log[]`: cond, imagined, shown, resp, seenCol, rt |
| `experiment` kind=scene | part 1 and 2: objAcc, locAcc, viv, recognition and placement logs, scene layout |
| `experiment` kind=emotion | arEmo, arNeu, valEmo, valNeu, viv, memAcc, per-passage log |
| `experiment` kind=decay | ratings at 0/15/30/60/90 s, drift count |
| `experiment` kind=draw | objects, lures, strokes, points, drawMs, detail, viv, `strokeData` (normalised x,y per stroke), tagged objects |
| `experiment` kind=rivalry | priming %, mixed, baseline, `log[]`: imagined, seen |
| `experiment` kind=pupil | viewBright/viewDark/imBright/imDark (iris ÷ eye width), perceptionEffect, imageryEffect, `series[]` (t, trial, phase, iris) |
| `sport` | pre/post conf, anx, viv, ctrl; perspective; ms; steps completed |
| `game` | phase pre (conf, anx, ready, focus) and post (perf 1–10, outcome, skill, setback, recover, match, note), sessionDone |
| `sport_tool` | reset, timing (imagined vs real seconds, ratio), siq profile (cs, cg, ms, mga, mgm) |
| `withdraw` | consent withdrawn (events stop); deletion removes all rows |

## 9. Analyses the data supports

**Primary (confirmatory, pre-register):**
1. *Does gamified training change vividness?* VVIQ at enrolment vs. retake after ≥ 14 training sessions (`attempt` = 2), controlling for `attempt` effects with the no-training arm.
2. *Metacognition vs. strength.* Rotation `meta` (confidence tracking) and `slope` across training sessions; prediction from Rademaker & Pearson: `meta` rises, accuracy and VVIQ do not.
3. *Objective sensory imagery by band.* Interference `effect`, rivalry `priming`, pupil `imageryEffect` by VVIQ band; aphantasia predicted at zero on all three while rotation accuracy is unchanged.

**Interactions worth modelling (mixed models, participant as random effect):**
- VVIQ band × task-type on accuracy (object-type tasks: colour match, scene objects, draw; spatial-type: rotation, span, scene locations). Predicted crossover: aphantasia drops on object, not spatial.
- Strategy (visual / spatial / verbal) × band on accuracy and RT slope: do aphantasics using spatial strategies match imagers on rotation but with a steeper slope?
- Vividness × emotional-content on arousal (emotion experiment): the arousal gap (emotional − neutral) should scale with vividness.
- Day-1 vs. day-2 × objects vs. locations × band (scene memory): the object deficit should widen overnight for low imagers.
- Within-person check-in vividness × daily rotation accuracy, vs. between-person: tests Kay et al.'s claim that vividness is a relative, not absolute, scale.
- `state.alert` and `tod` as moderators of every imagery measure: is imagery weaker when sleepy or late at night, and does that explain part of the VVIQ–objective gap?
- `itemRT` by item and band: aphantasics may answer vividness items faster (nothing to inspect) — a candidate implicit marker.
- Multisensory profile clusters (Psi-Q vectors) × behavioural measures: is "multisensory aphantasia" one cluster, and do auditory-strong aphantasics do better on Sound Echo?
- Athletes: pre-game confidence × visualization done → performance rating; SIQ profile × confidence change per session; rehearsal timing ratio × skill execution.
- Practice choice × modality strength: do people gravitate to the practice matching their strongest sense, and does cross-modal practice transfer?

**Power note.** With the app public, plan for N ≈ 1,000 enrolled, ≈ 40 in the aphantasia band (3.9%), ≈ 25 hyperphantasic; two-session experiments typically retain 30–50%. Oversample aphantasia via community recruitment but record `source` so you can report recruitment bias.
