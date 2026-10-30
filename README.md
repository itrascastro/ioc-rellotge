# ioc-rellotge

A classroom clock and board to project during exams, events and sessions. One offline HTML file, no dependencies,
and the whole screen is configured from a single JSON template.

**Live:** <https://itrascastro.github.io/ioc/ioc-rellotge/> — on the first visit it opens already configured for the collection exams (proves de compleció); a saved setup is never replaced.

The interface is in Catalan. What you write on the screen is never translated or changed.

## What it does

- **A clock for any situation**: day milestones with a countdown to the next one, countdown to a time, timer,
  stopwatch, or the current time. Each mode can be switched off, and the milestones are optional.
- **A message zone** next to it: sections of text, lists, tables, images and big notices that rotate on their own.
  Per-phase messages appear under the clock while each phase lasts.
- **Flexible layout**: more clock, more messages, only the clock or only the messages (keys `1`–`5`, or drag the divider).
- **Google-style look**: light, dark or system theme, accent colours, background colours, your own logo.
- **Long texts never break the layout**: every free text has a line limit, and a stress test checks it.
- **Everything is configurable from one JSON file**, so a person or an agent only changes values (see below).

## Use it

Open `index.html` in a browser (or the live URL). Press `E` for the settings, `F` for full screen.
The configuration is saved in the browser (`localStorage`); nothing is sent anywhere.

### One JSON for the whole configuration

A template holds every setting (46 keys): texts, schedule, sections, clock mode, appearance, logo, timings.

```json
{ "app": "Rellotge-IOC-Plantilla", "version": 2, "name": "My session", "data": { "title": "Exam", "clockMode": "timer", "timerMinutes": 80 } }
```

- Any key you leave out is not touched; an invalid value falls back to its default.
- Import it from **Desar → Plantilles → Importa una plantilla**, or open the app with `?plantilla=presets/your-file.json`
  (same-site `.json` paths only; it asks before replacing a saved setup).
- A deployment can ship a default for first-time visitors with `<meta name="rellotge-plantilla" content="presets/your-file.json">`
  in `index.html`. This repository points it at the collection-exam template; remove the tag for a blank start.
  Give the template a top-level `"revision"` number: when you raise it, returning visitors are asked once whether to apply
  the new version (declining keeps their setup, and nothing is ever replaced without asking).
- `presets/exemple-complet.json` lists every key with its default (generated from the code: `npm run example`).
- `presets/proves-compleccio.json` is a real session: schedule, per-phase messages and sections for a collection exam.
- The full reference of keys and allowed values is in [`doc/plantilla-json.md`](doc/plantilla-json.md).

## Tests

No dependencies: Node ≥ 22 and Chrome. A hand-written DevTools client drives a real browser.

```bash
npm test          # functional battery (168 tests)
npm run stress    # every text at its maximum length, three screen sizes
```

Set `CHROME=/path/to/chrome` if Chrome is not in a standard location.

## Layout

```
index.html            the whole app
presets/              templates (a real session and the full example)
doc/plantilla-json.md reference of the JSON template
test/                 browser driver, battery and stress audit
```
