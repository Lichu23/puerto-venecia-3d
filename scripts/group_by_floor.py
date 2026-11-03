"""Group data/stores.json by floor and zone.

Usage: python -I scripts/group_by_floor.py data/stores.json data/stores-by-floor.json data/stores.csv

Some locations mix floor and zone in one string (e.g. "Parking Subterráneo - Planta -1"),
and outdoor areas (Boulevard, Paseo del Lago...) have no floor at all. Those get
floor "Exterior / sin planta" so they can be checked against the map screenshots.
"""
import csv
import json
import re
import sys

NO_FLOOR = "Exterior / sin planta"
FLOOR_ORDER = ["Planta -1", "Planta Baja", "Planta Alta", NO_FLOOR]


def normalise(store):
    floor, zone = store["floor"], store["zone"] or ""
    if not floor:
        if re.search(r"planta\s*-1|parking subterr", zone, re.I):
            floor = "Planta -1"
        elif re.search(r"planta alta", zone, re.I):
            floor = "Planta Alta"
        elif re.search(r"planta baja", zone, re.I):
            floor = "Planta Baja"
        else:
            floor = NO_FLOOR
        zone = re.sub(r"\s*-?\s*(Gallery\s+)?Planta\s+(Alta|Baja|-1)\s*$", r" \1", zone, flags=re.I).strip(" -")
        zone = re.sub(r"^POP-UP:\s*", "", zone).strip() or zone
    return {**store, "floor": floor, "zone": zone or None, "floor_inferred": store["floor"] is None}


def main(src, out_json, out_csv):
    stores = [normalise(s) for s in json.load(open(src, encoding="utf-8"))["stores"]]
    floors = {}
    for s in sorted(stores, key=lambda s: (FLOOR_ORDER.index(s["floor"]), s["zone"] or "", s["name"].lower())):
        floors.setdefault(s["floor"], {}).setdefault(s["zone"] or "?", []).append(s)
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(floors, f, ensure_ascii=False, indent=1)
    cols = ["floor", "zone", "name", "section", "categories", "phone", "hours", "location_raw", "floor_inferred", "logo", "url"]
    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:  # BOM so Excel shows accents
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore", delimiter=";")
        w.writeheader()
        for zones in floors.values():
            for rows in zones.values():
                for s in rows:
                    w.writerow({**s, "categories": ", ".join(s["categories"])})
    for floor, zones in floors.items():
        print(f"{floor}: {sum(map(len, zones.values()))}")
        for zone, rows in zones.items():
            print(f"   {zone}: {len(rows)}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
