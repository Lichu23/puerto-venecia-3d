"""Collect the public store directory of puertovenecia.com.

Usage: python -I scripts/scrape_stores.py data/raw/sitemap-urls.txt data/stores.json

Reads store/restaurant page URLs (from the site's public sitemap), fetches each
page politely (one at a time, with a pause) and extracts the listed details.
"""
import html
import json
import re
import sys
import time
import urllib.request

BASE = "https://www.puertovenecia.com"
HEADERS = {"User-Agent": "Mozilla/5.0 (personal store-directory research)"}
DELAY_S = 0.7


def clean(fragment):
    """Strip tags and collapse whitespace."""
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragment)).split())


def field_block(page, name):
    """Return the HTML of the first Drupal field block with this machine name."""
    m = re.search(r'field--name-field-(?:sh|rest)-%s\b' % re.escape(name), page)
    if not m:
        return ""
    start = page.rfind("<div", 0, m.start())
    end = page.find('<div class="block block-', m.end())
    return page[start:end if end != -1 else len(page)]


def icon_labels(block):
    """Services / extra options are lists of taxonomy terms, each with a name field."""
    names = re.findall(r'field--name-name\b[^>]*>(.*?)</div>', block, re.S)
    return list(dict.fromkeys(clean(n) for n in names if clean(n)))


def field_items(block):
    items = [clean(x) for x in re.findall(r'class="field__item"[^>]*>(.*?)</div>', block, re.S)]
    if not items:  # single-value fields put field__item on the outer div
        m = re.search(r'field__item[^>]*>(.*?)</div>', block, re.S)
        items = [clean(m.group(1))] if m else []
    return [x for x in items if x and x != "Imagen"]


def parse(page, url):
    section = url.split("/")[3]  # tiendas | restaurantes | ocio
    title = re.search(r'field--name-title[^>]*>\s*<h1>(.*?)</h1>', page, re.S)
    if not title:
        return None
    location = field_items(field_block(page, "location"))
    phone = (field_items(field_block(page, "phone-number")) or [None])[0]
    logo = re.search(r'src="([^"]+)"', field_block(page, "logo"))
    intro = re.search(r'field--name-field-entradilla[^>]*>(.*?)</div>', page, re.S)
    loc_text = location[0] if location else None
    floor = zone = None
    if loc_text:
        m = re.match(r"(.*?)\s*·\s*Zona:\s*(.*)", loc_text)
        floor, zone = (m.group(1), m.group(2)) if m else (None, loc_text)
    return {
        "name": clean(title.group(1)),
        "section": section,
        "floor": floor,
        "zone": zone,
        "location_raw": loc_text,
        "categories": field_items(field_block(page, "type")),
        "food_types": field_items(field_block(page, "type-of-food")),
        "services": icon_labels(field_block(page, "services")),
        "extra_options": icon_labels(field_block(page, "extra-options")),
        "hours": clean(field_block(page, "openning-hours")) or None,
        "phone": phone,
        "logo": (BASE + logo.group(1)) if logo and logo.group(1).startswith("/") else (logo.group(1) if logo else None),
        "description": clean(intro.group(1)) if intro else None,
        "url": url,
    }


def main(urls_file, out_file):
    urls = [u.strip() for u in open(urls_file, encoding="utf-8") if u.strip()]
    rows, skipped, errors = [], [], []
    for i, url in enumerate(urls, 1):
        fetch_url = url.replace("://puertovenecia.com", "://www.puertovenecia.com")
        try:
            req = urllib.request.Request(fetch_url, headers=HEADERS)
            page = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "replace")
            row = parse(page, url)
            (rows.append(row) if row else skipped.append(url))
        except Exception as exc:  # keep going; report at the end
            errors.append({"url": url, "error": str(exc)})
        if i % 25 == 0:
            print(f"{i}/{len(urls)} pages", flush=True)
        time.sleep(DELAY_S)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump({"stores": rows, "skipped_non_store_pages": skipped, "errors": errors}, f, ensure_ascii=False, indent=1)
    print(f"done: {len(rows)} stores, {len(skipped)} non-store pages, {len(errors)} errors")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
