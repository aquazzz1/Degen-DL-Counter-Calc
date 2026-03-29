# Deadlock Counter Picker

Small local web app for ranking shared-value counter items against an enemy Deadlock team.

## How to run

1. Open `index.html` in a browser.
2. Left click heroes to mark up to six enemies.
3. Right click a hero to mark your own hero.
4. Choose a counter-data mode.
5. Read the ranked item list on the right.

Keep the `DLicons` folder next to `index.html` when you share the app, since the hero portraits load from that local project folder.

## Counter data modes

- `Your cheatsheet`: uses your local curated hero-to-item list.
- `Public WR% Analysis`: keeps your curated item list, but applies public-data-derived weights.
- `Public WR% Analysis + Discovery`: uses a public-data-derived list that can surface items outside your own cheatsheet.

The current public-data modes are bootstrapped from a local snapshot in `counter-data.js`. The app is now structured so those values can be replaced by a future refresh script or live ingest step.

## How ranking works

- Each enemy hero has a short list of recommended counter items in `counter-data.js`.
- Items that counter multiple enemy heroes rise to the top.
- The app shows team coverage as a percentage of selected enemy heroes.
- Optional `weight` values let stronger counters count a bit more.
- Optional `synergyByHero` values visually highlight items that fit your own hero especially well.

## Editing your cheatsheet

Replace the demo data in `counter-data.js` with your own notes.

Each hero entry looks like this:

```js
Lash: [
  { item: "Slowing Hex", weight: 1.0, notes: "Reliable way to blunt his movement patterns." },
  { item: "Knockdown", weight: 1.05, notes: "Excellent shared-value item into mobile divers." }
]
```

If you do not care about tuning weights yet, keep everything at `1.0`.

## Easy next upgrade ideas

- Add screenshot upload and OCR/fuzzy matching for hero names.
- Save your counter sheet in local storage or import/export JSON.
- Add richer self-hero synergy scoring.
- Add lane-phase vs late-game weighting.
