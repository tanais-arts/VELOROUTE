"""
Re-géocode les photos avec GPS mais sans city dans photos.json.
Utilise zoom=14 et une chaîne de fallback étendue.
"""
import json, urllib.request, ssl, time

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

with open('/Users/tom/Documents/DEV/VELOROUTE/docs/photos.json', encoding='utf-8') as f:
    photos = json.load(f)

todo = [p for p in photos if not p.get('city') and p.get('lat') is not None and p.get('lon') is not None]
print(f'{len(todo)} photos à géocoder')

cache = {}
updated = 0

for i, p in enumerate(todo):
    lat, lon = round(p['lat'], 2), round(p['lon'], 2)
    key = f'{lat},{lon}'
    if key not in cache:
        url = f'https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json&zoom=14&accept-language=fr'
        req = urllib.request.Request(url, headers={'User-Agent': 'VELOROUTE-geocode/1.0'})
        try:
            data = json.loads(urllib.request.urlopen(req, context=ctx, timeout=10).read())
            a = data.get('address', {})
            place = (a.get('city') or a.get('town') or a.get('village') or
                     a.get('hamlet') or a.get('city_district') or
                     a.get('municipality') or a.get('county') or '')
            cache[key] = place
            print(f'  [{i+1}/{len(todo)}] ({lat},{lon}) => {place!r}')
        except Exception as e:
            cache[key] = ''
            print(f'  [{i+1}/{len(todo)}] ERREUR: {e}')
        if i < len(todo) - 1:
            time.sleep(1.2)
    else:
        print(f'  [{i+1}/{len(todo)}] cache => {cache[key]!r}')

    place = cache[key]
    if place:
        p['city'] = place
        updated += 1

print(f'\n{updated} photos mises à jour')

with open('/Users/tom/Documents/DEV/VELOROUTE/docs/photos.json', 'w', encoding='utf-8') as f:
    json.dump(photos, f, ensure_ascii=False, indent=2)

print('photos.json sauvegardé')
