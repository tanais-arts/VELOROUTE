// VÉLOROUTE — interactive travel journal
'use strict';

const MONTHS_FR  = ['','janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
const ACCENT     = '#f0c060';
const DOT_COLOR  = '#f0c060';
const DOT_RADIUS = 4;
const DOT_ACTIVE = 8;
const TZ_OFFSET  = 2; // CEST (UTC+2)

// ── Tiles ────────────────────────────────────────────────────────────
const TILE_DARK  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

function fmtCaption(e) {
  return `${e.day} ${MONTHS_FR[e.month]} · ${e.hour}h${String(e.minute).padStart(2,'0')}`;
}

// ── State ────────────────────────────────────────────────────────────
const state = {
  entries:        [],
  photos:         [],
  cities:         [],
  visited:        [],
  escales:        [],
  activeIdx:      null,
  ringMarker:     null,
  markers:        [],
  lbPhotos:       [],
  lbIdx:          0,
  thumbEls:       [],
  activePhotoIdx: null,
  lightTile:      false,
  polylines:      [],
  lastT:          -1,
};

// Year of travel — set during init from data
let travelYear = new Date().getFullYear();

// If set, use this fixed terminator opacity for all timeline previews
let fixedTermOp = null;

// ── Map ──────────────────────────────────────────────────────────────
const map = L.map('map', { zoomControl: false, attributionControl: true })
  .setView([46.5, 3], 6); // France

let tileLayer = L.tileLayer(TILE_LIGHT, {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
  maxZoom: 19, subdomains: 'abcd',
}).addTo(map);

// ── Inline terminator (day/night shadow) ─────────────────────────────
function _termJulian(date) { return date.valueOf() / 86400000 + 2440587.5; }
function _termCompute(date) {
  const pts = [];
  if (window.SunCalc) {
    for (let lngDeg = -180; lngDeg <= 180; lngDeg += 2) {
      let bracketFound = false;
      let prevLat = -80;
      let prevAlt = SunCalc.getPosition(date, prevLat, lngDeg).altitude;
      for (let lat = -72; lat <= 80; lat += 8) {
        const alt = SunCalc.getPosition(date, lat, lngDeg).altitude;
        if (prevAlt === 0) { pts.push([prevLat, lngDeg]); bracketFound = true; break; }
        if (prevAlt * alt <= 0) {
          let found = false;
          for (let rlat = prevLat; rlat <= lat; rlat += 1) {
            const ralt = SunCalc.getPosition(date, rlat, lngDeg).altitude;
            if (ralt === 0) { pts.push([rlat, lngDeg]); found = true; break; }
            if (ralt * prevAlt <= 0) {
              const t = Math.abs(prevAlt) / (Math.abs(prevAlt) + Math.abs(ralt));
              const root = prevLat + t * (rlat - prevLat);
              pts.push([root, lngDeg]);
              found = true; break;
            }
            prevAlt = ralt; prevLat = rlat;
          }
          if (!found) pts.push([prevLat, lngDeg]);
          bracketFound = true; break;
        }
        prevAlt = alt; prevLat = lat;
      }
      if (!bracketFound) {
        pts.push([prevAlt > 0 ? 80 : -80, lngDeg]);
      }
    }
    const northAlt = SunCalc.getPosition(date, 90, 0).altitude;
    const pole = northAlt > 0 ? -90 : 90;
    return [[pole, -180], ...pts, [pole, 180]];
  }
  const jd = _termJulian(date), D = jd - 2451545.0;
  const g  = (357.529 + 0.98560028 * D) * Math.PI / 180;
  const q  = 280.459 + 0.98564736 * D;
  const Lr = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * Math.PI / 180;
  const e  = (23.439 - 0.0000004 * D) * Math.PI / 180;
  const dec = Math.asin(Math.sin(e) * Math.sin(Lr));
  const RA  = Math.atan2(Math.cos(e) * Math.sin(Lr), Math.cos(Lr));
  const GMST = ((6.697375 + 0.0657098242 * D + (D % 1) * 24) % 24 + 24) % 24;
  const lngSun = (-(GMST / 24 * 360) * Math.PI / 180 + RA);
  for (let lngDeg = -180; lngDeg <= 180; lngDeg += 2) {
    const lhr = lngDeg * Math.PI / 180 - lngSun;
    const lat = Math.atan(-Math.cos(lhr) / Math.tan(dec)) * 180 / Math.PI;
    pts.push([lat, lngDeg]);
  }
  const pole = dec > 0 ? -90 : 90;
  return [[pole, -180], ...pts, [pole, 180]];
}

let _termDate = null;
let terminator = null;

let _termPendingDate = null;
let _termRafId = null;
function scheduleTerminatorUpdate(date) {
  _termPendingDate = date;
  if (_termRafId) return;
  _termRafId = requestAnimationFrame(() => {
    if (_termPendingDate) {
      terminator.setTime(_termPendingDate);
    }
    _termPendingDate = null;
    _termRafId = null;
  });
}

L.control.zoom({ position: 'bottomleft' }).addTo(map);

map.createPane('shadePane');
map.getPane('shadePane').style.zIndex = 250;
map.getPane('shadePane').style.pointerEvents = 'none';
map.getPane('shadePane').style.mixBlendMode = 'multiply';
map.createPane('labelsPane');
map.getPane('labelsPane').style.zIndex = 700;
map.getPane('labelsPane').style.pointerEvents = 'none';
map.createPane('terminatorPane');
map.getPane('terminatorPane').style.zIndex = 680;
map.getPane('terminatorPane').style.pointerEvents = 'none';
map.getPane('terminatorPane').style.mixBlendMode = 'multiply';
map.createPane('routePane');
map.getPane('routePane').style.zIndex = 690;
map.createPane('ringPane');
map.getPane('ringPane').style.zIndex = 710;
map.getPane('ringPane').style.pointerEvents = 'none';

function ensureTerminatorFilter() {
  if (document.getElementById('nk-blur-defs')) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true'); svg.style.position = 'absolute';
  svg.style.left = '0'; svg.style.top = '0'; svg.id = 'nk-blur-defs';
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.setAttribute('id', 'nk-blur'); filter.setAttribute('x', '-50%'); filter.setAttribute('y', '-50%');
  filter.setAttribute('width', '200%'); filter.setAttribute('height', '200%');
  const fe = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
  fe.setAttribute('stdDeviation', '14'); fe.setAttribute('result', 'b');
  filter.appendChild(fe);
  defs.appendChild(filter);
  svg.appendChild(defs);
  document.body.appendChild(svg);
}

terminator = L.polygon([[0,0],[0,0.01],[0.01,0.01],[0.01,0]], {
  pane: 'terminatorPane',
  fillColor: '#001026', fillOpacity: 0.7,
  stroke: true, color: 'rgba(40,110,200,0.6)', weight: 1,
  interactive: false,
}).addTo(map);
try { ensureTerminatorFilter(); const el = terminator.getElement && terminator.getElement(); if (el) el.classList.add('nk-terminator'); } catch (e) { /* ignore */ }
terminator.bringToFront();
terminator.setTime = function(date) {
  if (_termDate && Math.abs(date - _termDate) < 30000) return;
  _termDate = date;
  this.setLatLngs(_termCompute(date));
};

const hillshade = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
  {
    pane: 'shadePane', opacity: 0.25,
    attribution: 'Hillshade &copy; Esri',
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
  }
).addTo(map);

// ── DOM refs ──────────────────────────────────────────────────────────
const dateDay      = document.getElementById('date-day');
const dateMonth    = document.getElementById('date-month');
const dateTime     = document.getElementById('date-time');
const tlInput      = document.getElementById('timeline-input');
const tlThumbLabel = document.getElementById('timeline-thumb-label');
const tlCitiesRow  = document.getElementById('timeline-cities-row');
const lightbox     = document.getElementById('lightbox');
const lbImg        = document.getElementById('lightbox-img');

// ── Son persistant ───────────────────────────────────────────────────
let soundOn = false;

const _SVG_SOUND_ON  = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden="true"><path d="M2 5H.5v5H2l4 2.5V2.5L2 5z"/><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M9 4.5a3.5 3.5 0 0 1 0 6"/><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M11.5 2.5a6 6 0 0 1 0 10"/></svg>';
const _SVG_SOUND_OFF = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden="true"><path d="M2 5H.5v5H2l4 2.5V2.5L2 5z"/><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M10 5.5l4 4m0-4-4 4"/></svg>';

function syncAllSoundBtns() {
  const btn = document.getElementById('sound-toggle');
  if (!btn) return;
  btn.innerHTML = soundOn ? _SVG_SOUND_ON : _SVG_SOUND_OFF;
  btn.title = soundOn ? 'Couper le son' : 'Activer le son';
  btn.classList.toggle('is-muted', !soundOn);
}

function setSoundOn(val) {
  soundOn = val;
  if (window._ambienceSetMuted) window._ambienceSetMuted(!soundOn);
  syncAllSoundBtns();
}

document.getElementById('sound-toggle').addEventListener('click', () => setSoundOn(!soundOn));
syncAllSoundBtns();

// ── Ambiance sonore ───────────────────────────────────────────────────
{
  const TRACKS = [
    // Ajouter ici les URLs des pistes d'ambiance
    // ex: 'https://votre-cdn.com/sounds/ambient-japan.mp3',
  ];
  const FADE_MS  = 2000;
  const SWAP_MS  = 60000;

  const elA = document.getElementById('amb-a');
  const elB = document.getElementById('amb-b');
  let current = elA, next = elB;
  let lastIdx = -1;
  let swapTimer = null;
  let ambStarted = false;

  function pickRandom() {
    let idx;
    do { idx = Math.floor(Math.random() * TRACKS.length); }
    while (idx === lastIdx && TRACKS.length > 1);
    lastIdx = idx;
    return TRACKS[idx];
  }

  function fadeTo(el, targetVol, durationMs, onDone) {
    const startVol = el.volume;
    const startTime = performance.now();
    function step(now) {
      const t = Math.min(1, (now - startTime) / durationMs);
      el.volume = startVol + (targetVol - startVol) * t;
      if (t < 1) requestAnimationFrame(step);
      else if (onDone) onDone();
    }
    requestAnimationFrame(step);
  }

  function loadAndPlay(el, vol, onPlaying) {
    el.volume = vol;
    const onCanPlay = () => {
      el.removeEventListener('canplay', onCanPlay);
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
      if (onPlaying) onPlaying();
    };
    el.addEventListener('canplay', onCanPlay);
    el.load();
  }

  function crossfade() {
    if (!TRACKS.length) return;
    const outEl = current;
    const inEl  = next;
    inEl.src = pickRandom();
    loadAndPlay(inEl, 0, () => fadeTo(inEl, 1, FADE_MS));
    fadeTo(outEl, 0, FADE_MS, () => {
      outEl.pause();
      outEl.removeAttribute('src');
    });
    current = inEl;
    next    = outEl;
    swapTimer = setTimeout(crossfade, SWAP_MS);
  }

  function startAmbience() {
    if (ambStarted || !TRACKS.length) return;
    ambStarted = true;
    const startEl = current;
    startEl.src = pickRandom();
    loadAndPlay(startEl, 0, () => fadeTo(startEl, 1, FADE_MS));
    swapTimer = setTimeout(crossfade, SWAP_MS);
  }

  window._ambienceSetMuted = (muted) => {
    if (!TRACKS.length) return;
    if (!muted) {
      if (!ambStarted) { startAmbience(); return; }
      if (current.paused) {
        const p = current.play();
        if (p && p.catch) p.catch(() => {});
        fadeTo(current, 1, FADE_MS);
      }
      if (!swapTimer) swapTimer = setTimeout(crossfade, SWAP_MS);
    } else {
      clearTimeout(swapTimer);
      swapTimer = null;
      fadeTo(current, 0, 500, () => { current.pause(); });
      if (next && !next.paused) fadeTo(next, 0, 500, () => { next.pause(); });
    }
  };
}

// ── Daylight theme ─────────────────────────────────────────────────────
function sunElevationDeg(lat, lon, day, month, hour, minute) {
  const utcMin = ((hour - TZ_OFFSET + 24) % 24) * 60 + minute;
  const days = [0,31,28,31,30,31,30,31,31,30,31,30,31];
  let doy = day;
  for (let m = 1; m < month; m++) doy += days[m];
  const decl = -23.45 * Math.cos(2 * Math.PI * (doy + 10) / 365) * Math.PI / 180;
  const solarNoon = 720 - 4 * lon;
  const H = (utcMin - solarNoon) * (Math.PI / 720);
  const φ = lat * Math.PI / 180;
  return Math.asin(Math.sin(φ)*Math.sin(decl) + Math.cos(φ)*Math.cos(decl)*Math.cos(H)) * 180/Math.PI;
}

function applyDaylight(elev) {
  const NO_DARK_thresh = -3;
  const FULL_NIGHT_thresh = -12;
  const computeTermOpacity = (e) => {
    let tt;
    if (e >= NO_DARK_thresh) tt = 0;
    else if (e <= FULL_NIGHT_thresh) tt = 1;
    else tt = (NO_DARK_thresh - e) / (NO_DARK_thresh - FULL_NIGHT_thresh);
    tt = tt * tt * (3 - 2 * tt);
    return Math.max(0, Math.min(0.8, 0.20 + tt * 0.60));
  };
  const termOp = (fixedTermOp !== null) ? fixedTermOp : computeTermOpacity(elev);
  if (terminator) {
    terminator.setStyle({ fillOpacity: termOp, fillColor: '#000412' });
    try { terminator.bringToFront(); } catch (e) { /* ignore */ }
  }
}

const P_NIGHT = {
  bg:       [8,12,20,1],      chrome:   [4,6,14,0.92],    panel:    [6,9,18,0.97],
  border:   [255,255,255,0.07], borderF: [255,255,255,0.05],
  text1:    [240,240,240,1],  text2:    [255,255,255,0.70],
  text3:    [255,255,255,0.45], text4:  [255,255,255,0.35],
  text5:    [255,255,255,0.30], accentT:[240,192,96,1],
  tlTrack:  [255,255,255,0.12], tlEdge: [255,255,255,0.30],
  cityC:    [255,255,255,0.85], tickC:  [255,255,255,0.60],
  zoomBg:   [8,12,20,0.85],   zoomC:   [170,170,170,1],
  route:    [240,192,96,1],   routeOp: 0.65,
};
const P_DAY = {
  bg:       [230,245,255,1],  chrome:   [220,240,250,0.93], panel:  [255,255,255,0.98],
  border:   [6,30,40,0.08],   borderF:  [6,30,40,0.05],
  text1:    [8,18,28,1],      text2:    [8,18,28,0.75],
  text3:    [8,18,28,0.50],   text4:    [8,18,28,0.38],
  text5:    [8,18,28,0.30],   accentT:  [40,130,200,1],
  tlTrack:  [8,18,28,0.12],   tlEdge:   [8,18,28,0.30],
  cityC:    [8,18,28,0.88],   tickC:    [8,18,28,0.55],
  zoomBg:   [255,255,255,0.92], zoomC:  [30,90,140,1],
  route:    [10,110,200,1],   routeOp: 0.88,
};

(function applyFixedDayPalette() {
  const root = document.documentElement;
  const toRgba = (a) => `rgba(${a[0]},${a[1]},${a[2]},${a[3]})`;
  root.style.setProperty('--bg',      toRgba(P_DAY.bg));
  root.style.setProperty('--chrome',  toRgba(P_DAY.chrome));
  root.style.setProperty('--panel',   toRgba(P_DAY.panel));
  root.style.setProperty('--border',  toRgba(P_DAY.border));
  root.style.setProperty('--borderf', toRgba(P_DAY.borderF || P_DAY.border));
  root.style.setProperty('--text1',   toRgba(P_DAY.text1));
  root.style.setProperty('--text2',   toRgba(P_DAY.text2));
  root.style.setProperty('--text3',   toRgba(P_DAY.text3));
  root.style.setProperty('--text4',   toRgba(P_DAY.text4));
  root.style.setProperty('--text5',   toRgba(P_DAY.text5));
  root.style.setProperty('--accT',    toRgba(P_DAY.accentT));
  root.style.setProperty('--tltrack', toRgba(P_DAY.tlTrack));
  root.style.setProperty('--tledge',  toRgba(P_DAY.tlEdge));
  root.style.setProperty('--cityc',   toRgba(P_DAY.cityC));
  root.style.setProperty('--tickc',   toRgba(P_DAY.tickC));
  root.style.setProperty('--zoombg',  toRgba(P_DAY.zoomBg));
  root.style.setProperty('--zoomc',   toRgba(P_DAY.zoomC));
  tileLayer.setUrl(TILE_LIGHT);
  terminator.setStyle({ fillOpacity: 0.85, fillColor: '#001026' });
})();

// ── Location helpers (lightbox) ─────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestNamedPlace(lat, lon) {
  const pool = [
    ...(state.cities  || []),
    ...(state.visited || []),
    ...(state.escales || []),
  ].filter(c => (c.city || c.name) && c.lat != null && c.lon != null)
   .map(c => ({ name: c.city || c.name, lat: c.lat, lon: c.lon }));
  if (!pool.length) return null;
  let best = null, bestD = Infinity;
  pool.forEach(c => {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestD) { bestD = d; best = { name: c.name, km: Math.round(d) }; }
  });
  return bestD < 10 ? best : null;
}

const lbLocCache = {};
let lbLocReqId = 0;

async function updateLbLocation(item) {
  const counter = document.getElementById('lb-counter');
  if (!counter) return;
  counter.removeAttribute('hidden');
  if (item.entryIdx == null || !state.entries || !state.entries.length) {
    counter.textContent = '';
    return;
  }
  const entry = state.entries[item.entryIdx];
  if (!entry || entry.lat == null || entry.lon == null) { counter.textContent = ''; return; }
  const { lat, lon } = entry;
  const key = `${Math.round(lat * 100) / 100},${Math.round(lon * 100) / 100}`;
  if (lbLocCache[key]) { counter.textContent = `\u{1F4CD} ${lbLocCache[key]}`; return; }
  const local = nearestNamedPlace(lat, lon);
  if (local) counter.textContent = `\u{1F4CD} ${local.name}`;
  const reqId = ++lbLocReqId;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`;
    const r = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
    if (reqId !== lbLocReqId) return;
    const data = await r.json();
    const place = data.address?.city || data.address?.town || data.address?.village ||
                  data.address?.county || (data.display_name || '').split(',')[0].trim();
    if (place) {
      lbLocCache[key] = place;
      if (reqId === lbLocReqId) counter.textContent = `\u{1F4CD} ${place}`;
    }
  } catch { /* keep local result */ }
}

// ── Ring marker ───────────────────────────────────────────────────────
function showRing(latlng) {
  if (state.ringMarker) map.removeLayer(state.ringMarker);
  state.ringMarker = L.marker(latlng, {
    icon: L.divIcon({ className: 'nk-active-ring', iconSize: [14,14], iconAnchor: [7,7] }),
    interactive: false, pane: 'ringPane',
  }).addTo(map);
}

// ── Lightbox ──────────────────────────────────────────────────────────
function openLightbox(photos, startIdx) {
  state.lbPhotos = photos;
  state.lbIdx    = startIdx;
  lbShowCurrent();
  lightbox.hidden = false;
}
function closeLightbox() { lightbox.hidden = true; }
function lbShowCurrent() {
  const item = state.lbPhotos[state.lbIdx];
  if (!item) return;
  const prog = document.getElementById('lb-progress');
  prog.classList.add('active');
  const srcs = [item.webp, item.src, item.thumb].filter(Boolean);
  let si = 0;
  const tryNext = () => {
    if (si >= srcs.length) { prog.classList.remove('active'); return; }
    const src = srcs[si++];
    lbImg.onload  = () => prog.classList.remove('active');
    lbImg.onerror = tryNext;
    lbImg.src = src;
  };
  tryNext();
  document.getElementById('lightbox-prev').style.visibility = state.lbIdx > 0 ? '' : 'hidden';
  document.getElementById('lightbox-next').style.visibility = state.lbIdx < state.lbPhotos.length - 1 ? '' : 'hidden';
  updateLbLocation(item);
  const dlBtn = document.getElementById('lb-download');
  const srcUrl = item.src_orig || (item.src || item.thumb).replace('/Photos/', '/Sources/');
  dlBtn.onclick = () => {
    const a = document.createElement('a');
    a.href = srcUrl;
    a.download = srcUrl.split('/').pop();
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
  };
}

document.getElementById('lightbox-backdrop').addEventListener('click', closeLightbox);
document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
document.getElementById('lightbox-prev').addEventListener('click', () => { if (state.lbIdx > 0) { state.lbIdx--; lbShowCurrent(); } });
document.getElementById('lightbox-next').addEventListener('click', () => { if (state.lbIdx < state.lbPhotos.length - 1) { state.lbIdx++; lbShowCurrent(); } });

// ── Timeline ───────────────────────────────────────────────────────────
function updateTimelineThumb(idx) {
  let pct = 0;
  if (state.segMap) {
    pct = state.segMap.totalUnits > 1
      ? indexToVisualUnits(idx, state.segMap) / (state.segMap.totalUnits - 1)
      : 0;
  } else if (state.entryTimes && state.entryTimes.length > 1) {
    const t = state.entryTimes[idx];
    const span = state.entryTimeMax - state.entryTimeMin;
    if (span > 0) pct = (t - state.entryTimeMin) / span;
    else pct = state.entries.length > 1 ? idx / (state.entries.length - 1) : 0;
  } else {
    const total = state.entries.length - 1;
    pct = total > 0 ? idx / total : 0;
  }
  const wrapW  = document.getElementById('timeline-slider-wrap').offsetWidth;
  const offset = pct * (wrapW - 14) + 7;
  tlThumbLabel.style.left = `${offset}px`;
  const e = state.entries[idx];
  if (e) tlThumbLabel.textContent = `${e.day} ${MONTHS_FR[e.month]} · ${e.hour}h${String(e.minute).padStart(2,'0')}`;
}

function updateTimelineThumbForTime(t) {
  if (state.segMap) {
    return updateTimelineThumb(timeToIndex(t));
  }
  if (!state.entryTimes || state.entryTimes.length < 2) {
    return updateTimelineThumb(0);
  }
  const span = state.entryTimeMax - state.entryTimeMin;
  const pct  = span > 0 ? (t - state.entryTimeMin) / span : 0;
  const wrapW  = document.getElementById('timeline-slider-wrap').offsetWidth;
  const offset = Math.max(7, Math.min(wrapW - 7, pct * (wrapW - 14) + 7));
  tlThumbLabel.style.left = `${offset}px`;
  const localDate = new Date(t + TZ_OFFSET * 3600000);
  const day    = localDate.getUTCDate();
  const month  = MONTHS_FR[localDate.getUTCMonth() + 1];
  const hour   = localDate.getUTCHours();
  const minute = String(localDate.getUTCMinutes()).padStart(2, '0');
  tlThumbLabel.textContent = `${day} ${month} · ${hour}h${minute}`;
}

function buildTimelineCities(cities, totalEntries) {
  if (!tlCitiesRow) {
    console.warn('buildTimelineCities: `timeline-cities-row` not found in DOM');
    return;
  }
  tlCitiesRow.innerHTML = '';
  let escaleCities = [];
  let escaleTicked = new Set();
  if (window.escales && Array.isArray(window.escales)) {
    escaleCities = window.escales.map(e => (e.city || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, ''));
  }
  cities.filter(c => c.entryIdx != null).forEach(c => {
    const cname = (c.name || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    if (escaleCities.includes(cname)) return;
    let pct = 0;
    if (state.segMap) {
      pct = state.segMap.totalUnits > 1
        ? indexToVisualUnits(c.entryIdx, state.segMap) / (state.segMap.totalUnits - 1) * 100
        : 0;
    } else if (state.entryTimes && state.entryTimes.length > 1) {
      const t = state.entryTimes[c.entryIdx];
      const span = state.entryTimeMax - state.entryTimeMin;
      pct = span > 0 ? ((t - state.entryTimeMin) / span) * 100 : (c.entryIdx / (totalEntries - 1)) * 100;
    } else {
      pct = (c.entryIdx / (totalEntries - 1)) * 100;
    }
    const div = document.createElement('div');
    div.className = 'tl-city-tick';
    div.style.left = `${pct}%`;
    div.innerHTML = `<div class="tick-line"></div><div class="tick-name">${c.name}</div>`;
    tlCitiesRow.appendChild(div);
  });
  if (window.escales && Array.isArray(window.escales) && state.entryTimes && state.entryTimes.length > 1) {
    const span = state.entryTimeMax - state.entryTimeMin;
    window.escales.forEach(e => {
      const escaleNameNorm = (e.city || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
      if (escaleTicked.has(escaleNameNorm)) return;
      escaleTicked.add(escaleNameNorm);
      function parseLocalToUTC(str) {
        const d = new Date(str + 'Z');
        d.setUTCHours(d.getUTCHours() - TZ_OFFSET);
        return d.getTime();
      }
      const t0 = parseLocalToUTC(e.start);
      const t1 = parseLocalToUTC(e.end);
      let pct0 = span > 0 ? ((t0 - state.entryTimeMin) / span) : 0;
      let pct1 = span > 0 ? ((t1 - state.entryTimeMin) / span) : 0;
      pct0 = Math.max(0, Math.min(1, pct0));
      pct1 = Math.max(0, Math.min(1, pct1));
      const pct = ((pct0 + pct1) / 2) * 100;
      const div = document.createElement('div');
      div.className = 'tl-city-tick tl-escale-city-tick';
      div.style.left = `${pct}%`;
      div.innerHTML = `<div class="tick-line"></div><div class="tick-name">${e.city}</div>`;
      tlCitiesRow.appendChild(div);
    });
  }
}

// ── Non-linear segment timeline ──────────────────────────────────────
const SEG_GAP_THRESHOLD_MS  = 7 * 24 * 3600 * 1000; // 1 week
const SEG_GAP_VISUAL_UNITS  = 30;                   // width of a gap in units

function buildSegmentMap(entries, times) {
  if (!entries || entries.length === 0 || !times || times.length < 2) return null;
  const segments = [];
  let segStart = 0;
  for (let i = 1; i < entries.length; i++) {
    if (times[i] - times[i - 1] > SEG_GAP_THRESHOLD_MS) {
      segments.push({ startIdx: segStart, endIdx: i - 1, points: i - segStart, isGap: false });
      segments.push({ startIdx: i - 1,   endIdx: i,     points: 0,             isGap: true  });
      segStart = i;
    }
  }
  segments.push({ startIdx: segStart, endIdx: entries.length - 1, points: entries.length - segStart, isGap: false });
  let cumul = 0;
  segments.forEach(seg => {
    seg.cumulStart = cumul;
    cumul += seg.isGap ? SEG_GAP_VISUAL_UNITS : seg.points;
    seg.cumulEnd = cumul;
  });
  return { segments, totalUnits: cumul };
}

function indexToVisualUnits(idx, segMap) {
  for (const seg of segMap.segments) {
    if (seg.isGap) continue;
    if (idx >= seg.startIdx && idx <= seg.endIdx)
      return seg.cumulStart + (idx - seg.startIdx);
  }
  return segMap.totalUnits - 1;
}

function visualUnitsToIndex(units, segMap) {
  for (const seg of segMap.segments) {
    if (seg.isGap) {
      if (units >= seg.cumulStart && units < seg.cumulEnd) return seg.endIdx;
      continue;
    }
    if (units >= seg.cumulStart && units <= seg.cumulEnd)
      return Math.min(seg.endIdx, seg.startIdx + Math.round(units - seg.cumulStart));
  }
  return state.entries.length - 1;
}

function buildSegmentTrack(segMap) {
  const wrap = document.getElementById('timeline-slider-wrap');
  if (!wrap || !segMap) return;
  wrap.classList.add('tl-segmented');
  let layer = wrap.querySelector('#tl-segment-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'tl-segment-layer';
    wrap.appendChild(layer);
  }
  layer.innerHTML = '';
  const total = segMap.totalUnits - 1 || 1;
  segMap.segments.forEach(seg => {
    const units = seg.isGap ? SEG_GAP_VISUAL_UNITS : seg.points;
    const div   = document.createElement('div');
    div.style.width = `${(units / (segMap.totalUnits) * 100).toFixed(3)}%`;
    div.className   = seg.isGap ? 'tl-seg-gap' : 'tl-seg-active';
    layer.appendChild(div);
  });
}

// ── Carousel ───────────────────────────────────────────────────────────
const THUMB_STEP = 124;

function nearestPhotoIdx(entryIdx) {
  const photos = state.photos;
  let lo = 0, hi = photos.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (photos[mid].entryIdx < entryIdx) lo = mid + 1;
    else hi = mid;
  }
  const a = lo > 0 ? lo - 1 : 0;
  const b = lo < photos.length ? lo : photos.length - 1;
  return Math.abs(photos[a].entryIdx - entryIdx) <= Math.abs(photos[b].entryIdx - entryIdx) ? a : b;
}

function timeToIndex(t) {
  const times = state.entryTimes;
  if (!times || times.length === 0) return 0;
  let lo = 0, hi = times.length - 1;
  if (t <= times[0]) return 0;
  if (t >= times[hi]) return hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] === t) return mid;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid - 1;
  }
  const a = Math.max(0, hi);
  const b = Math.min(times.length - 1, lo);
  return (Math.abs(times[a] - t) <= Math.abs(times[b] - t)) ? a : b;
}

function interpolatePosition(t) {
  const times   = state.entryTimes;
  const entries = state.entries;
  if (!times || times.length === 0) return null;
  if (t <= times[0]) return { lat: entries[0].lat, lon: entries[0].lon, idx: 0 };
  const n = times.length - 1;
  if (t >= times[n]) return { lat: entries[n].lat, lon: entries[n].lon, idx: n };
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  const a = Math.max(0, lo - 1);
  const b = lo;
  const ta = times[a], tb = times[b];
  const frac = tb === ta ? 0 : (t - ta) / (tb - ta);
  const lat = entries[a].lat + frac * (entries[b].lat - entries[a].lat);
  const lon = entries[a].lon + frac * (entries[b].lon - entries[a].lon);
  return { lat, lon, a, b, frac };
}

function previewAtTime(t) {
  const ip = interpolatePosition(t);
  if (!ip) return;
  try { showRing([ip.lat, ip.lon]); } catch (e) { /* ignore */ }
  scheduleTerminatorUpdate(new Date(t));
  let elev = 0;
  if (window.SunCalc) {
    const pos = SunCalc.getPosition(new Date(t), ip.lat, ip.lon);
    elev = pos.altitude * 180 / Math.PI;
  } else {
    const localDate = new Date(t + TZ_OFFSET * 3600000);
    elev = sunElevationDeg(ip.lat, ip.lon, localDate.getUTCDate(), localDate.getUTCMonth() + 1, localDate.getUTCHours(), localDate.getUTCMinutes());
  }
  applyDaylight(elev);
  updateTimelineThumbForTime(t);
}

function scrollCarouselTo(pi, smooth = false) {
  if (pi === state.activePhotoIdx) return;
  const carousel = document.getElementById('photo-carousel');
  carousel.scrollTo({ left: pi * THUMB_STEP + THUMB_STEP / 2, behavior: smooth ? 'smooth' : 'instant' });
  const prev = state.thumbEls[state.activePhotoIdx];
  if (prev) { prev.classList.remove('active'); prev.fetchPriority = 'low'; }
  const next = state.thumbEls[pi];
  if (next) {
    next.classList.add('active');
    next.fetchPriority = 'high';
    if (next.dataset.src && !next.src) {
      next.src = next.dataset.src;
      delete next.dataset.src;
    }
  }
  state.activePhotoIdx = pi;
}

// ── Select entry ──────────────────────────────────────────────────────
function selectEntry(idx) {
  const entries = state.entries;
  if (idx < 0 || idx >= entries.length) return;
  const e = entries[idx];
  state.activeIdx = idx;

  showRing([e.lat, e.lon]);
  scheduleTerminatorUpdate(new Date(Date.UTC(travelYear, e.month - 1, e.day, e.hour - TZ_OFFSET, e.minute)));
  applyDaylight(sunElevationDeg(e.lat, e.lon, e.day, e.month, e.hour, e.minute));
  scrollCarouselTo(nearestPhotoIdx(idx), true);
  if (!map.getBounds().contains([e.lat, e.lon])) {
    map.panTo([e.lat, e.lon], { animate: true, duration: 0.4 });
  }

  if (dateDay)   dateDay.textContent   = e.day;
  if (dateMonth) dateMonth.textContent = MONTHS_FR[e.month];
  if (dateTime)  dateTime.textContent  = `${e.hour}h${String(e.minute).padStart(2, '0')}`;

  if (state.entryTimes && state.entryTimes[idx] != null) tlInput.value = state.entryTimes[idx];
  else tlInput.value = idx;
  updateTimelineThumb(idx);
}

// ── Init ───────────────────────────────────────────────────────────────
const _GH_API = 'https://api.github.com/repos/tanais-arts/VELOROUTE/contents/docs';
async function fetchRepoJson(filename, fallback) {
  try {
    const r = await fetch(`${_GH_API}/${filename}`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    const bytes = Uint8Array.from(atob(j.content.replace(/\n/g, '')), c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    if (fallback !== undefined) return fallback;
    throw new Error(`Impossible de charger ${filename}`);
  }
}

async function init() {
  let entries, photos, cities, visited, escales, gapRoutes;
  try {
    [entries, photos, cities, visited, escales, gapRoutes] = await Promise.all([
      fetchRepoJson('travel.json'),
      fetchRepoJson('photos.json',    []),
      fetchRepoJson('cities.json',    []),
      fetchRepoJson('visited.json',   []),
      fetchRepoJson('escales.json',   []),
      fetchRepoJson('gap_routes.json',[]),
    ]);
    window.escales = escales;
  } catch (err) {
    console.error('Impossible de charger les données', err);
    return;
  }
  if (!entries.length) return;

  // ── Timeline Base Line ──
  function renderTimelineBaseLine() {
    const wrap = document.getElementById('timeline-slider-wrap');
    if (!wrap) return;
    let base = wrap.querySelector('.tl-base-line');
    if (!base) {
      base = document.createElement('div');
      base.className = 'tl-base-line';
      wrap.insertBefore(base, wrap.firstChild);
    }
    base.style.position   = 'absolute';
    base.style.left       = '0';
    base.style.width      = '100%';
    base.style.top        = '50%';
    base.style.height     = '2px';
    base.style.transform  = 'translateY(-50%)';
    base.style.background = 'rgba(240,192,96,0.75)';
    base.style.zIndex     = '0';
    base.style.pointerEvents = 'none';
  }

  // ── Timeline Escale Highlights ──
  function renderTimelineEscales(escales, entryTimes, entryTimeMin, entryTimeMax) {
    const wrap = document.getElementById('timeline-slider-wrap');
    if (!wrap || !escales || !entryTimes || entryTimes.length < 2) return;
    Array.from(wrap.querySelectorAll('.tl-escale-bar, .tl-escale-cover')).forEach(el => el.remove());
    const span = entryTimeMax - entryTimeMin;
    escales.forEach(e => {
      function parseLocalToUTC(str) {
        const d = new Date(str + 'Z');
        d.setUTCHours(d.getUTCHours() - TZ_OFFSET);
        return d.getTime();
      }
      const t0 = parseLocalToUTC(e.start);
      const t1 = parseLocalToUTC(e.end);
      if (isNaN(t0) || isNaN(t1)) return;
      let pct0 = (t0 - entryTimeMin) / span;
      let pct1 = (t1 - entryTimeMin) / span;
      pct0 = Math.max(0, Math.min(1, pct0));
      pct1 = Math.max(0, Math.min(1, pct1));
      if (pct1 <= pct0) return;

      const cover = document.createElement('div');
      cover.className = 'tl-escale-cover';
      cover.style.cssText = `position:absolute;left:${pct0*100}%;width:${(pct1-pct0)*100}%;top:50%;height:6px;margin-top:-2px;transform:translateY(-16%);background:rgba(240,192,96,1);z-index:1;pointer-events:none`;
      wrap.appendChild(cover);

      const bar = document.createElement('div');
      bar.className = 'tl-escale-bar';
      bar.title = `${e.city} — ${e.duration_h}h`;
      bar.style.cssText = `position:absolute;left:${pct0*100}%;width:${(pct1-pct0)*100}%;top:50%;height:6px;margin-top:-2px;transform:translateY(-16%);background:rgba(240,192,96,1);border-radius:3px;z-index:2;box-shadow:0 0 2px 0 rgba(240,192,96,0.10);cursor:pointer`;
      bar.onclick = () => {
        if (!entryTimes || entryTimes.length === 0) return;
        let idx = 0;
        let minDt = Infinity;
        const tRef = t1;
        for (let i = 0; i < entryTimes.length; i++) {
          const dt = entryTimes[i] - tRef;
          if (dt < 0) continue;
          if (dt < minDt) { minDt = dt; idx = i; }
        }
        if (minDt === Infinity) {
          let bestPast = null, bestPastDt = Infinity;
          for (let i = 0; i < entryTimes.length; i++) {
            const dt = tRef - entryTimes[i];
            if (dt < 0) continue;
            if (dt < bestPastDt) { bestPastDt = dt; bestPast = i; }
          }
          if (bestPast !== null) idx = bestPast;
        }
        selectEntry(idx);
      };
      wrap.appendChild(bar);
    });
  }

  setTimeout(() => {
    renderTimelineBaseLine();
    renderTimelineEscales(escales, state.entryTimes, state.entryTimeMin, state.entryTimeMax);
  }, 0);

  state.entries = entries;                        // keep all (hidden flag preserved for entryIdx compat)
  state.photos  = photos.filter(p => !p.hidden); // hidden photos not shown in carousel
  state.cities  = cities;
  state.visited = visited;
  state.escales = escales || [];

  const year = entries[0]?.year || new Date().getFullYear();
  travelYear = year;

  state.entryTimes    = entries.map(e => Date.UTC(year, e.month - 1, e.day, (e.hour || 0) - TZ_OFFSET, e.minute || 0));
  state.entryTimeMin  = Math.min(...state.entryTimes);
  state.entryTimeMax  = Math.max(...state.entryTimes);

  const firstT = state.entryTimeMin || Date.now();
  map.whenReady(() => scheduleTerminatorUpdate(new Date(firstT)));

  // Fixed terminator opacity from first available entry
  try {
    const sample = entries.find(e => e.lat && e.lon);
    if (sample) {
      let elev = 0;
      if (window.SunCalc) {
        const pos = SunCalc.getPosition(
          new Date(Date.UTC(year, sample.month - 1, sample.day, (sample.hour || 0) - TZ_OFFSET, sample.minute || 0)),
          sample.lat, sample.lon
        );
        elev = pos.altitude * 180 / Math.PI;
      } else {
        elev = sunElevationDeg(sample.lat, sample.lon, sample.day, sample.month, sample.hour || 0, sample.minute || 0);
      }
      const NO_DARK = -3, FULL_NIGHT = -12;
      let t;
      if (elev >= NO_DARK) t = 0;
      else if (elev <= FULL_NIGHT) t = 1;
      else t = (NO_DARK - elev) / (NO_DARK - FULL_NIGHT);
      t = t * t * (3 - 2 * t);
      fixedTermOp = 0.7; // Force un overlay nuit modéré
      if (terminator) terminator.setStyle({ fillOpacity: fixedTermOp, fillColor: '#000412' });
    }
  } catch (err) {
    console.warn('Could not compute fixed terminator opacity', err);
  }

  // ── Carousel ──
  const carousel = document.getElementById('photo-carousel');
  const thumbObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; }
        thumbObserver.unobserve(img);
      }
    });
  }, { root: carousel, rootMargin: '0px 4000px 0px 4000px' });

  const fragment = document.createDocumentFragment();
  photos.forEach((p, i) => {
    const img = document.createElement('img');
    if (i < 10) {
      img.src = p.thumb || p.src;
    } else {
      img.dataset.src = p.thumb || p.src;
    }
    img.className = 'photo-thumb';
    img.draggable = false;
    img.onerror = () => { if (img.src.includes('/Thumbs/') && p.src) img.src = p.src; };

    if (p.type === 'video') {
      const wrap = document.createElement('div');
      wrap.className = 'video-thumb-wrap';
      wrap.addEventListener('click', () => openLightbox(photos, i));
      const badge = document.createElement('div');
      badge.className = 'play-badge';
      badge.setAttribute('aria-hidden', 'true');
      wrap.appendChild(img);
      wrap.appendChild(badge);
      fragment.appendChild(wrap);
    } else {
      img.addEventListener('click', () => openLightbox(photos, i));
      fragment.appendChild(img);
    }
  });
  if (carousel) {
    carousel.appendChild(fragment);
    state.thumbEls = Array.from(carousel.querySelectorAll('.photo-thumb'));
    state.thumbEls.forEach(img => thumbObserver.observe(img));
  } else {
    console.warn('photo-carousel element not found');
    state.thumbEls = [];
  }

  // Nearest entryIdx for each city
  const assignEntryIdx = arr => arr.forEach(c => {
    let best = 0, bestD = Infinity;
    entries.forEach((e, i) => {
      const d = (e.lat - c.lat) ** 2 + (e.lon - c.lon) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    c.entryIdx = best;
  });
  assignEntryIdx(cities);
  assignEntryIdx(visited);

  // ── Route polylines ──
  const findNearestEntry = (latlng) => {
    let best = 0, bestD = Infinity;
    entries.forEach((e, i) => {
      const d = (e.lat - latlng.lat) ** 2 + (e.lon - latlng.lng) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };

  const latlngs = entries.map(e => [e.lat, e.lon]);

  function gapKm(a, b) {
    const R = 6371;
    const lat1 = a.lat * Math.PI / 180, lon1 = a.lon * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180, lon2 = b.lon * Math.PI / 180;
    const dlat = lat2 - lat1, dlon = lon2 - lon1;
    const h = Math.sin(dlat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlon/2)**2;
    return R * 2 * Math.asin(Math.sqrt(h));
  }
  const GAP_THRESHOLD_KM = 10;

  let curSeg = [], curInterp = null;
  const flushSeg = (interp) => {
    if (curSeg.length < 2) return;
    const opts = interp
      ? { color: ACCENT, weight: 2, opacity: 1, smoothFactor: 1, dashArray: '6 6', pane: 'routePane' }
      : { color: ACCENT, weight: 4, opacity: 0.65, smoothFactor: 1, pane: 'routePane' };
    const line = L.polyline(curSeg, opts).on('click', ev => selectEntry(findNearestEntry(ev.latlng))).addTo(map);
    state.polylines.push({ line, interp });
  };
  entries.forEach((e, i) => {
    const interp = e.frame === 0;
    if (i > 0 && gapKm(entries[i - 1], e) > GAP_THRESHOLD_KM) {
      flushSeg(curInterp);
      const prev = entries[i - 1];
      const gap = gapRoutes.find(g =>
        Math.abs(g.fromLatLon[0] - prev.lat) < 0.001 && Math.abs(g.fromLatLon[1] - prev.lon) < 0.001
      );
      const gapCoords = gap ? gap.coords : [[prev.lat, prev.lon], [e.lat, e.lon]];
      L.polyline(gapCoords, { color: ACCENT, weight: 2, opacity: 1, dashArray: '6 6', smoothFactor: 1, pane: 'routePane' })
        .on('click', ev => selectEntry(findNearestEntry(ev.latlng))).addTo(map);
      curSeg = [];
      curInterp = interp;
    } else if (curInterp === null) {
      curInterp = interp;
    } else if (interp !== curInterp) {
      const join = curSeg[curSeg.length - 1];
      flushSeg(curInterp);
      curSeg = [join];
      curInterp = interp;
    }
    curSeg.push([e.lat, e.lon]);
  });
  flushSeg(curInterp);

  // Tick labels every 10 minutes
  let lastTick = -1;
  const mediaEntries = new Set();
  photos.forEach(p => { if (p.entryIdx != null) mediaEntries.add(p.entryIdx); });
  entries.forEach((e, i) => {
    const slot = e.hour * 6 + Math.floor(e.minute / 10);
    if (slot === lastTick) return;
    lastTick = slot;
    if (e.frame === 0) return;
    const label = `${e.day} ${MONTHS_FR[e.month]} · ${e.hour}h${String(e.minute).padStart(2,'0')}`;
    L.marker([e.lat, e.lon], {
      icon: L.divIcon({
        className: 'time-tick',
        html: `<div class="time-tick-label">${label}</div>`,
        iconSize: [0, 0], iconAnchor: [0, 0],
      }),
      interactive: true,
    }).on('click', () => selectEntry(i)).addTo(map);
  });

  state.markers = [];
  map.fitBounds(L.latLngBounds(latlngs), { padding: [20, 20] });

  // ── Visited city labels ──
  visited.forEach(c => {
    L.marker([c.lat, c.lon], {
      pane: 'labelsPane',
      icon: L.divIcon({ className: 'city-label', html: c.name, iconAnchor: [0, 0] }),
      interactive: false,
    }).addTo(map);
  });

  // Update timeline edge labels
  if (entries.length > 0) {
    const first = entries[0];
    const last  = entries[entries.length - 1];
    const startEl = document.getElementById('tl-label-start');
    const endEl   = document.getElementById('tl-label-end');
    if (startEl) startEl.textContent = `${first.day} ${MONTHS_FR[first.month]}`;
    if (endEl)   endEl.textContent   = `${last.day} ${MONTHS_FR[last.month]}`;
  }

  // ── Timeline setup ──
  state.segMap = buildSegmentMap(entries, state.entryTimes);
  if (state.segMap) {
    buildSegmentTrack(state.segMap);
    tlInput.min   = 0;
    tlInput.max   = state.segMap.totalUnits - 1;
    tlInput.step  = 1;
    tlInput.value = 0;
  } else if (state.entryTimes && state.entryTimes.length > 1) {
    tlInput.min   = state.entryTimeMin;
    tlInput.max   = state.entryTimeMax;
    tlInput.step  = 60000;
    tlInput.value = state.entryTimeMin;
  } else {
    tlInput.min   = 0;
    tlInput.max   = entries.length - 1;
    tlInput.step  = 1;
    tlInput.value = 0;
  }

  // Start on a random entry with photos
  const photoEntryIndices = [...new Set(photos.map(p => p.entryIdx).filter(i => i != null))];
  const startIdx = photoEntryIndices.length > 0
    ? photoEntryIndices[Math.floor(Math.random() * photoEntryIndices.length)]
    : 0;
  if (state.segMap) {
    tlInput.value = indexToVisualUnits(startIdx, state.segMap);
  } else if (state.entryTimes && state.entryTimes.length > 1) {
    tlInput.value = state.entryTimes[startIdx];
  } else {
    tlInput.value = startIdx;
  }
  updateTimelineThumb(startIdx);
  setTimeout(() => selectEntry(startIdx), 0);
  buildTimelineCities(visited, entries.length);

  // ── Animation timeline ──
  let autoSlideRAF = null;
  function cancelAutoSlide() {
    if (autoSlideRAF) { cancelAnimationFrame(autoSlideRAF); autoSlideRAF = null; }
  }
  function animateToTime(from, to, duration, onUpdate, onEnd) {
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = (1 - Math.cos(Math.PI * t)) / 2;
      const val = from + (to - from) * eased;
      onUpdate(val);
      if (t < 1) { autoSlideRAF = requestAnimationFrame(step); }
      else { autoSlideRAF = null; if (onEnd) onEnd(); }
    }
    cancelAutoSlide();
    autoSlideRAF = requestAnimationFrame(step);
  }

  tlInput.addEventListener('input', () => {
    cancelAutoSlide();
    if (state.segMap) {
      const idx = visualUnitsToIndex(Number(tlInput.value), state.segMap);
      updateTimelineThumb(idx);
      selectEntry(idx);
    } else if (state.entryTimes && state.entryTimes.length > 1) {
      const t = Number(tlInput.value);
      previewAtTime(t);
      updateTimelineThumbForTime(t);
    } else {
      const idx = Number(tlInput.value);
      updateTimelineThumb(idx);
      selectEntry(idx);
    }
  });

  window.addEventListener('resize', () => {
    renderTimelineEscales(escales, state.entryTimes, state.entryTimeMin, state.entryTimeMax);
  });

  tlInput.addEventListener('change', () => {
    if (state.entryTimes && state.entryTimes.length > 1) {
      const t = Number(tlInput.value);
      const tIdx = timeToIndex(t);
      if (mediaEntries.size === 0) { selectEntry(tIdx); return; }
      let idx = tIdx;
      let best = null, bestDt = Infinity;
      for (const i of mediaEntries) {
        if (i < 0 || i >= state.entryTimes.length) continue;
        const dt = state.entryTimes[i] - t;
        if (dt < 0) continue;
        if (dt < bestDt) { bestDt = dt; best = i; }
      }
      if (best === null) {
        let bestPast = null, bestPastDt = Infinity;
        for (const i of mediaEntries) {
          if (i < 0 || i >= state.entryTimes.length) continue;
          const dt = t - state.entryTimes[i];
          if (dt < 0) continue;
          if (dt < bestPastDt) { bestPastDt = dt; bestPast = i; }
        }
        if (bestPast !== null) best = bestPast;
      }
      if (best !== null) idx = best;
      const target = state.entryTimes[idx];
      if (t === target) { selectEntry(idx); return; }
      animateToTime(t, target, 2000,
        (val) => { const v = Math.round(val); tlInput.value = v; previewAtTime(v); updateTimelineThumbForTime(v); },
        () => selectEntry(idx)
      );
    }
  });

  // ── Carousel arrows ──
  const carouselEl = document.getElementById('photo-carousel');
  function previewEntryFromCarouselCenter() {
    const scrollLeft = carouselEl.scrollLeft;
    const centerX = scrollLeft + carouselEl.clientWidth / 2;
    const photoIdx = Math.max(0, Math.min(state.photos.length - 1, Math.round((centerX - THUMB_STEP / 2) / THUMB_STEP)));
    const p = state.photos[photoIdx];
    if (!p || p.entryIdx == null) return;
    const idx = p.entryIdx;
    const e = state.entries[idx];
    if (!e) return;
    showRing([e.lat, e.lon]);
    applyDaylight(sunElevationDeg(e.lat, e.lon, e.day, e.month, e.hour, e.minute));
    scheduleTerminatorUpdate(new Date(Date.UTC(year, e.month - 1, e.day, e.hour - TZ_OFFSET, e.minute)));
    if (!map.getBounds().contains([e.lat, e.lon])) {
      map.panTo([e.lat, e.lon], { animate: true, duration: 0.4 });
    }
    if (dateDay)   dateDay.textContent   = e.day;
    if (dateMonth) dateMonth.textContent = MONTHS_FR[e.month];
    if (dateTime)  dateTime.textContent  = `${e.hour}h${String(e.minute).padStart(2, '0')}`;
  }

  function attachCarouselArrow(btnId, dir) {
    const btn = document.getElementById(btnId);
    let intervalId = null;
    function step() { carouselEl.scrollBy({ left: dir * THUMB_STEP, behavior: 'smooth' }); previewEntryFromCarouselCenter(); }
    function start() { step(); intervalId = setInterval(step, 300); }
    function stop()  { if (intervalId) { clearInterval(intervalId); intervalId = null; } }
    btn.addEventListener('mousedown', start);
    btn.addEventListener('touchstart', start, { passive: true });
    btn.addEventListener('mouseup', stop);
    btn.addEventListener('mouseleave', stop);
    btn.addEventListener('touchend', stop);
  }
  attachCarouselArrow('carousel-prev', -1);
  attachCarouselArrow('carousel-next',  1);

  // ── Nav buttons (navigate between photo-bearing entries) ──
  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }
  function navPrev() {
    if (state.activeIdx === null) return;
    for (let i = state.activeIdx - 1; i >= 0; i--) {
      if (mediaEntries.has(i)) { selectEntry(i); return; }
    }
    if (state.activeIdx > 0) selectEntry(state.activeIdx - 1);
  }
  function navNext() {
    if (state.activeIdx === null) return;
    for (let i = state.activeIdx + 1; i < entries.length; i++) {
      if (mediaEntries.has(i)) { selectEntry(i); return; }
    }
    if (state.activeIdx < entries.length - 1) selectEntry(state.activeIdx + 1);
  }
  document.getElementById('tl-prev').addEventListener('click', debounce(navPrev, 400));
  document.getElementById('tl-next').addEventListener('click', debounce(navNext, 400));

  // ── Keyboard ──
  document.addEventListener('keydown', ev => {
    if (!lightbox.hidden) {
      if (ev.key === 'ArrowLeft')  { if (state.lbIdx > 0) { state.lbIdx--; lbShowCurrent(); } }
      if (ev.key === 'ArrowRight') { if (state.lbIdx < state.lbPhotos.length - 1) { state.lbIdx++; lbShowCurrent(); } }
      if (ev.key === 'Escape') closeLightbox();
      return;
    }
    if (state.activeIdx === null) return;
    if      (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') { ev.preventDefault(); if (state.activeIdx < entries.length - 1) selectEntry(state.activeIdx + 1); }
    else if (ev.key === 'ArrowLeft'  || ev.key === 'ArrowUp')   { ev.preventDefault(); if (state.activeIdx > 0) selectEntry(state.activeIdx - 1); }
    else if (ev.key === 'Escape') closeLightbox();
  });
}

document.addEventListener('DOMContentLoaded', init);
