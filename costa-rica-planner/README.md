# 🌺 Pura Vida Planner: Costa Rica, May 7–20, 2027

An interactive trip planner for 2 college travelers. It's plain HTML/CSS/JS with no build step, and Chart.js and Leaflet are copied into `lib/`, so the app runs offline. Only the OpenStreetMap tiles and Google Fonts need internet; without them the map switches to an SVG sketch.

## How to open it

Browsers block `fetch("data.json")` on pages opened straight from disk, so serve the folder:

```bash
cd costa-rica-planner
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

If you double-click `index.html` instead, the app asks you to pick `data.json` with a file picker, and then it works.

## What's inside

| File | What it does |
|---|---|
| `index.html` | Page layout and tabs |
| `style.css` | Tropical theme, responsive layout, print/PDF styles |
| `app.js` | Cost model, charts, map, expense splitter, checklists |
| `data.json` | **Every price, the itinerary, sources, hacks and checklists** |
| `lib/` | Local copies of Chart.js 4.4.1 and Leaflet 1.9.4 |

## Updating prices

All numbers live in `data.json`. Edit the file and reload the page.

- **Flights:** `flights.options[].pp` is the round-trip price per person. `flights.chosen` sets the default route.
- **Lodging:** `regions[].lodging.{dorm|private|hotel}.perNight` is the price per night **for 2**. The Budget / Mid / Comfy toggle switches between dorm, private and hotel.
- **Food:** `food.perPersonDay.{budget|mid|comfy}`. Nicer dinners are under `food.nicerDinner`.
- **Alcohol:** `alcohol.barBeer.price`, `alcohol.marketBeer.price`, `barShare` (the share of beers bought at bars), plus guaro and cocktails.
- **Moped:** `moped.dailyRate`, `insurancePerDay`, `gasPerDay`. `dayPriority` sets which days the slider fills first.
- **Activities:** `activities[].pp` is per person. `priority` sets the order the paid-activities slider turns them on. `day` sets which itinerary day each falls on.
- **Transport legs:** `legs[].modes.{bus|shuttle}.pp`. `tierMode` sets which mode each tier uses.
- **Extras:** `extras[]` (`per`: `"person"` or `"group"`). The emergency buffer is `bufferPct`.
- **Exchange rate:** `meta.exchangeRate.usdToCrc`. You can also change it live in the header; that setting is saved in your browser.
- **Sources:** add an entry to `sources[]` and reference its `id` in any `src` array. Set `"estimate": true` on any price you couldn't verify.

Your slider settings, logged expenses, traveler names and checklist ticks are saved in the browser's `localStorage`. Use **Reset to defaults** to clear the sliders.

## Printing

Click **🖨️ Print / PDF**. The print stylesheet stacks every tab into one document and shows each source URL.
