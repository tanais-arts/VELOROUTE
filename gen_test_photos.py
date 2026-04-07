"""
Génère 10 JPEGs avec EXIF GPS et DateTimeOriginal.
Lieux : Séoul, Hiroshima, Osaka, Nara, Kyoto, Tokyo, Nikko, Tokyo, Hakone, Tokyo
Dates : 1–10 mai 2026, à 12h00
"""
from PIL import Image, ImageDraw, ImageFont
import piexif, os, math

DEST = os.path.expanduser('~/Desktop/JAPON_TEST_PHOTOS')
os.makedirs(DEST, exist_ok=True)

LIEUX = [
    ('Seoul',      37.5665,  126.9780),
    ('Hiroshima',  34.3853,  132.4553),
    ('Osaka',      34.6937,  135.5023),
    ('Nara',       34.6851,  135.8048),
    ('Kyoto',      35.0116,  135.7681),
    ('Tokyo',      35.6762,  139.6503),
    ('Nikko',      36.7198,  139.6983),
    ('Tokyo',      35.6762,  139.6503),
    ('Hakone',     35.2322,  139.1069),
    ('Tokyo',      35.6762,  139.6503),
]

COULEURS = [
    '#1a2a6c', '#b21f1f', '#fdbb2d', '#2d6a4f',
    '#6a0572', '#0077b6', '#d62828', '#023e8a',
    '#588157', '#212529',
]

def to_dms_rational(deg):
    """Convertit degrés décimaux en (D, M, S) en entiers rationnels piexif."""
    d = int(abs(deg))
    m_frac = (abs(deg) - d) * 60
    m = int(m_frac)
    s = round((m_frac - m) * 60 * 1000)
    return [(d, 1), (m, 1), (s, 1000)]

for i, (lieu, lat, lon) in enumerate(LIEUX):
    day = i + 1
    date_str = f'2026:05:{day:02d} 12:00:00'
    fname = f'IMG_2026050{day}_{lieu}.jpg' if day < 10 else f'IMG_202605{day}_{lieu}.jpg'

    # ── Image : fond coloré + texte ──────────────────────────────────
    img = Image.new('RGB', (1280, 960), color=COULEURS[i])
    draw = ImageDraw.Draw(img)

    # Dégradé rapide : rectangles semi-transparents
    for y in range(0, 960, 6):
        alpha = int(60 * math.sin(math.pi * y / 960))
        draw.rectangle([(0, y), (1280, y + 5)], fill=tuple(
            max(0, min(255, c + alpha))
            for c in Image.new('RGB', (1, 1), COULEURS[i]).getpixel((0, 0))
        ))

    # Texte lieu + date
    draw.text((60, 80),  lieu,                      fill='white')
    draw.text((60, 160), f'1 mai 2026 + {i} j',    fill='rgba(255,255,255,180)')
    draw.text((60, 220), f'{lat:.4f}°N {lon:.4f}°E', fill='rgba(255,255,190,200)')

    # ── EXIF ────────────────────────────────────────────────────────
    lat_ref = b'N' if lat >= 0 else b'S'
    lon_ref = b'E' if lon >= 0 else b'W'
    gps_ifd = {
        piexif.GPSIFD.GPSLatitudeRef:  lat_ref,
        piexif.GPSIFD.GPSLatitude:     to_dms_rational(lat),
        piexif.GPSIFD.GPSLongitudeRef: lon_ref,
        piexif.GPSIFD.GPSLongitude:    to_dms_rational(lon),
        piexif.GPSIFD.GPSDateStamp:    f'2026:05:{day:02d}'.encode(),
    }
    exif_ifd = {
        piexif.ExifIFD.DateTimeOriginal:  date_str.encode(),
        piexif.ExifIFD.DateTimeDigitized: date_str.encode(),
    }
    zeroth_ifd = {
        piexif.ImageIFD.DateTime: date_str.encode(),
        piexif.ImageIFD.Make:     b'VELOROUTE',
        piexif.ImageIFD.Model:    b'TestGen',
    }
    exif_bytes = piexif.dump({'0th': zeroth_ifd, 'Exif': exif_ifd, 'GPS': gps_ifd})

    path = os.path.join(DEST, fname)
    img.save(path, 'JPEG', quality=88, exif=exif_bytes)
    print(f'✓ {fname}  {lat:+.4f} {lon:+.4f}  {date_str}')

print(f'\n10 fichiers générés dans : {DEST}')
