# Puerto Venecia 3D Map – Plan & Status

Goal: a walkable 3D map of Puerto Venecia (Zaragoza) in the browser, built from our own
layout and the public store directory of puertovenecia.com.

_Last updated: 2026-11-03_

---

## What we have so far

### Store data (done)
Collected from the public pages listed in `puertovenecia.com/sitemap.xml` (allowed by `robots.txt`).

- **209 businesses**: 168 shops + 41 restaurants, 0 errors
- Fields per business: name, floor, zone, categories, phone (183), opening hours
  (41 restaurants), logo (209), description, services, extra options, page URL

### Stores per floor

| Floor | Count | Zones |
|---|---|---|
| Planta -1 (underground parking) | 4 | Parking Subterráneo (2), Parking subterráneo – El Corte Inglés (2) |
| Planta Baja (ground floor) | 88 | Gallery (63), Terrazas (19), Parking Exterior (5), Plaza de las Palmeras Gallery (1) |
| Planta Alta (upper floor) | 71 | Gallery (48), Terrazas (13), Distrito Ocio (10) |
| Exterior / sin planta (no floor given) | 46 | Boulevard (31), Paseo del Lago (9), Distrito Ocio (3), El Mirador (1), Plaza de Ocio (1), Puerto Venecia (1) |

- "Boulevard" is the outdoor retail park (IKEA, Leroy Merlin, Media Markt, Conforama,
  Toys"R"Us, Kiabi…), so these are probably standalone single-level buildings at ground level.
- Stores whose floor was inferred from the zone name (not stated by the site) are marked
  `floor_inferred: true`.

### Files

| Path | What it is |
|---|---|
| `data/stores.json` | All details per business (raw output of the scraper) |
| `data/stores-by-floor.json` | Same data grouped floor → zone → stores (input for the 3D map) |
| `data/stores.csv` | Spreadsheet version (`;` separated, opens in Excel) |
| `data/raw/sitemap-urls.txt` | Store/restaurant URLs taken from the sitemap |
| `scripts/scrape_stores.py` | Re-collects the store data |
| `scripts/group_by_floor.py` | Rebuilds the grouped JSON and CSV |

Refresh the data:

```bash
python -I scripts/scrape_stores.py data/raw/sitemap-urls.txt data/stores.json
python -I scripts/group_by_floor.py data/stores.json data/stores-by-floor.json data/stores.csv
```

(To refresh the URL list, download `https://www.puertovenecia.com/sitemap.xml` again and keep
the `/tiendas/`, `/restaurantes/` and `/ocio/` URLs.)

### Run the 3D prototype

The page loads ES modules, so open it through a local server (not by double-clicking the file):

```bash
python -m http.server 8765 --bind 127.0.0.1
```

Then open http://127.0.0.1:8765. Code lives in `index.html` and `src/`
(`mall.js` = building, `player.js` = walking and collision, `touch.js` = phone pad and
finger look, `main.js` = setup and render loop).

To try it on a phone on the same Wi-Fi, start the server with `--bind 0.0.0.0` and open
`http://<this PC's IP>:8765` on the phone (Windows may ask to allow Python through the firewall).
Three.js r186 is loaded from the jsDelivr CDN with a pinned version.

### What we know about the current official map
- `puertovenecia.com/mapa` embeds **Mappedin Web**, a commercial indoor-map service
  (venue `cbre-puerto-venecia`, licensed to the mall operator CBRE).
- Under the hood it uses **Three.js** (r178) for 3D, **MapLibre GL** for the base map and
  **React** for the UI.
- **We do not use their map data or their key.** Their map is only looked at (screenshots)
  to understand where each store is.

---

## Decisions

1. Build our **own** layout and 3D model. Screenshots are a reference for store
   positions only, not copied or traced.
2. First deliverable: a **walkable 3D prototype** in the browser.
3. Tech: **Three.js**, a single web page, with no install needed (works on desktop and phone).
4. Start with an **approximate, generated layout** (zones as corridors, stores along them),
   then move stores to their real positions later. The rest of the code stays the same.

---

## Next steps

- [ ] **1. Leisure venues**: add Cinesa, bowling alley (bolera), Pause & Play, arcade, boats.
      Their pages have a different layout, so add them by hand or adapt the scraper.
- [ ] **2. Screenshots**: take top-down screenshots of each floor of the official map
      (same zoom per floor, landmarks visible: entrances, escalators, toilets, parking access).
- [ ] **3. Check floors**: confirm the 46 "no floor" stores (probably ground level / outdoor)
      and the `floor_inferred` ones against the screenshots.
- [ ] **4. Store positions**: write each store's approximate position (floor, zone, x/y) into
      a layout file, e.g. `data/layout.json`.
- [ ] **5. 3D prototype (v1)**:
  - [x] Step 1: walkable mall shell (2 floors, atrium, columns, railings, skylight),
        WASD + mouse, Shift to run, keys 1/2 to change floor (temporary)
  - [x] Touch: joystick pad (bottom left), drag to look, Alta/Baja floor buttons, pause button
  - [ ] Floors and zones as simple 3D geometry
  - [ ] Shopfronts with name signs, coloured by category (logos optional)
  - [ ] First-person walking: WASD + mouse on desktop, on-screen joystick on mobile
  - [ ] Switching floors (escalators or floor buttons)
  - [ ] Search for a store, then jump to it or show a path
  - [ ] Click a shopfront to show its info (category, phone, hours, link)
  - [ ] 2D minimap
- [ ] **6. Real layout (v2)**: replace the generated layout with the positions from step 4.
- [ ] **7. Optional**: make this folder a git repository with a remote (for backups and
      Engram project memory).

## Later ideas (not decided)
- Photo-real sections scanned with a phone (Scaniverse/Polycam), only with the mall's permission
- 360° photo tour points
- If the project is done with the mall: ask CBRE/Mappedin for an official map export (MVF)
