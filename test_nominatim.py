import urllib.request, json, time, ssl
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

coords = [
    ('IMG_20250501_151631', 49.3027, -0.3136),
    ('IMG_20250501_173457', 49.3422, -0.5853),
    ('IMG_2124-2136 sample', 49.0985, -1.6136),
    ('IMG_20250502_141908', 49.3953, -0.9440),
]

for name, lat, lon in coords:
    url = f'https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json&zoom=10&accept-language=fr'
    req = urllib.request.Request(url, headers={'User-Agent': 'VELOROUTE-audit/1.0'})
    data = json.loads(urllib.request.urlopen(req, context=ctx).read())
    addr = data.get('address', {})
    place = (addr.get('city') or addr.get('town') or addr.get('village') or
             addr.get('hamlet') or addr.get('municipality') or addr.get('county') or
             addr.get('state') or '???')
    print(f'{name}: => {place!r}')
    print(f'  address: {dict(addr)}')
    print()
    time.sleep(1.2)
