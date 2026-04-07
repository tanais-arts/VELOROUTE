"""Interpolation GPS pour photos sans coordonnées dans photos.json."""
import json
from datetime import datetime, timezone

MAX_MS = 6 * 3600 * 1000  # 6h en ms

with open('/Users/tom/Documents/DEV/VELOROUTE/docs/photos.json', encoding='utf-8') as f:
    photos = json.load(f)

anchors = sorted(
    [p for p in photos if p.get('lat') is not None and p.get('photoMs') is not None],
    key=lambda p: p['photoMs']
)

todo = [p for p in photos if p.get('lat') is None and p.get('photoMs') is not None]
print(f'{len(todo)} photos sans GPS, {len(anchors)} ancres disponibles')
print()

updated = 0
for p in todo:
    ms = p['photoMs']
    name = p['src'].split('/')[-1]
    prev = next_p = None
    for a in reversed(anchors):
        if a['photoMs'] <= ms: prev = a; break
    for a in anchors:
        if a['photoMs'] >= ms: next_p = a; break
    prev_ok = prev and (ms - prev['photoMs']) <= MAX_MS
    next_ok = next_p and (next_p['photoMs'] - ms) <= MAX_MS
    if not prev_ok and not next_ok:
        print(f'  ✗ {name} — trop loin de tout voisin GPS')
        continue
    if prev_ok and next_ok:
        span = next_p['photoMs'] - prev['photoMs']
        t = (ms - prev['photoMs']) / span if span > 0 else 0
        lat = prev['lat'] + t * (next_p['lat'] - prev['lat'])
        lon = prev['lon'] + t * (next_p['lon'] - prev['lon'])
        method = f'lerp {t:.2f} entre {prev["src"].split("/")[-1]} et {next_p["src"].split("/")[-1]}'
    else:
        ref = next_p if next_ok else prev
        lat, lon = ref['lat'], ref['lon']
        method = f'copie de {ref["src"].split("/")[-1]}'
    p['lat'] = round(lat, 6)
    p['lon'] = round(lon, 6)
    updated += 1
    print(f'  ✓ {name}: ({p["lat"]}, {p["lon"]}) — {method}')

print(f'\n{updated}/{len(todo)} photos mises à jour')

with open('/Users/tom/Documents/DEV/VELOROUTE/docs/photos.json', 'w', encoding='utf-8') as f:
    json.dump(photos, f, ensure_ascii=False, indent=2)
print('photos.json sauvegardé')
