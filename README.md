# Puerto Venecia 3D

A walkable 3D map of the **Puerto Venecia** shopping centre (Zaragoza, Spain) that runs in the
browser. You can walk through the mall in first person, switch floors, search for a store and
click a shopfront to see its details.

> Status: early stage. The store data is collected; the 3D prototype is next.

## The idea

Finding a store in a large mall from a flat map is hard. This project builds an interactive 3D
version of Puerto Venecia that you can explore like a game:

- **Walk around** in first person (WASD + mouse on desktop, on-screen joystick on mobile)
- **Switch floors** using escalators or floor buttons
- **Search** for a store and jump to it or see the path
- **Click a shopfront** to see its category, phone, opening hours and website
- **2D minimap** to keep track of where you are

It runs on a single web page with **Three.js**, with nothing to install, on desktop and phone.

## What's done

Store data for **209 businesses** (168 shops + 41 restaurants), collected from the public store
pages listed in `puertovenecia.com/sitemap.xml` (allowed by `robots.txt`).

| Floor | Stores |
|---|---|
| Planta -1 (underground parking) | 4 |
| Planta Baja (ground floor) | 88 |
| Planta Alta (upper floor) | 71 |
| Exterior / no floor given (Boulevard retail park, Paseo del Lago…) | 46 |

Each business has: name, floor, zone, categories, phone, opening hours, logo, description,
services and page URL. Floors inferred from the zone name are marked `floor_inferred: true`.

## Project structure

| Path | What it is |
|---|---|
| `data/stores.json` | All details per business |
| `data/stores-by-floor.json` | Same data grouped floor → zone → stores (input for the 3D map) |
| `data/stores.csv` | Spreadsheet version (`;` separated) |
| `data/raw/sitemap-urls.txt` | Store and restaurant URLs from the sitemap |
| `scripts/scrape_stores.py` | Re-collects the store data |
| `scripts/group_by_floor.py` | Rebuilds the grouped JSON and CSV |
| `PLAN.md` | Detailed plan, decisions and status |

### Refresh the data

```bash
python -I scripts/scrape_stores.py data/raw/sitemap-urls.txt data/stores.json
python -I scripts/group_by_floor.py data/stores.json data/stores-by-floor.json data/stores.csv
```

## Approach

1. **Our own layout and 3D model.** The official mall map (Mappedin) is only used as a visual
   reference for store positions. Its map data and API key are not used, copied or traced.
2. **Generated layout first:** zones as corridors with stores along them, so the 3D viewer can be
   built right away.
3. **Real layout later:** each store's approximate position goes into `data/layout.json` and
   replaces the generated layout. The rest of the code stays the same.

## Roadmap

- [ ] Add leisure venues (cinema, bowling, arcade, boats)
- [ ] Check the floor of stores with no floor or an inferred floor
- [ ] Write approximate store positions to `data/layout.json`
- [ ] 3D prototype v1: floors, shopfronts coloured by category, first-person walking,
      floor switching, search, store info, minimap
- [ ] v2: real store positions

### Later ideas
- 360° photo tour points
- Photo-real sections scanned with a phone (only with the mall's permission)

## Disclaimer

This is an independent project and is not affiliated with Puerto Venecia, CBRE or Mappedin.
Store information comes from the mall's public website and may be out of date.
