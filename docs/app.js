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
  voyages:        [],
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

// ── Map ──────────────────────────────────────────────────────────────
const map = L.map('map', { zoomControl: false, attributionControl: true })
  .setView([46.5, 3], 6); // France

let tileLayer = L.tileLayer(TILE_LIGHT, {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
  maxZoom: 19, subdomains: 'abcd',
}).addTo(map);

L.control.zoom({ position: 'bottomleft' }).addTo(map);

map.createPane('shadePane');
map.getPane('shadePane').style.zIndex = 250;
map.getPane('shadePane').style.pointerEvents = 'none';
map.getPane('shadePane').style.mixBlendMode = 'multiply';
map.createPane('labelsPane');
map.getPane('labelsPane').style.zIndex = 700;
map.getPane('labelsPane').style.pointerEvents = 'none';
map.createPane('routePane');
map.getPane('routePane').style.zIndex = 690;
map.createPane('ringPane');
map.getPane('ringPane').style.zIndex = 710;
map.getPane('ringPane').style.pointerEvents = 'none';

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
const dateLoc      = document.getElementById('date-loc');
const tlInput      = document.getElementById('timeline-input');      // null (bottom-bar removed)
const tlThumbLabel = document.getElementById('timeline-thumb-label'); // null (bottom-bar removed)
const tlCitiesRow  = document.getElementById('timeline-cities-row');  // null (bottom-bar removed)
const lightbox     = document.getElementById('lightbox');
const lbImg        = document.getElementById('lightbox-img');

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

const lbLocCache = (() => { try { return JSON.parse(localStorage.getItem('lbLocCache') || '{}'); } catch { return {}; } })();
function _saveLocCache() { try { localStorage.setItem('lbLocCache', JSON.stringify(lbLocCache)); } catch {} }
let lbLocReqId = 0;

async function updateLbLocation(item) {
  const counter = document.getElementById('lb-counter');
  if (!counter) return;
  counter.removeAttribute('hidden');
  // Priorité : coordonnées propres de la photo (GPS EXIF), sinon entrée GPX
  let lat, lon;
  if (item.lat != null && item.lon != null) {
    lat = item.lat; lon = item.lon;
  } else if (item.entryIdx != null && state.entries && state.entries.length) {
    const entry = state.entries[item.entryIdx];
    if (entry && entry.lat != null && entry.lon != null) { lat = entry.lat; lon = entry.lon; }
  }
  if (lat == null || lon == null) { counter.textContent = ''; return; }
  const key = `${Math.round(lat * 100) / 100},${Math.round(lon * 100) / 100}`;
  if (lbLocCache[key]) { counter.textContent = `\u{1F4CD} ${lbLocCache[key]}`; return; }
  const local = nearestNamedPlace(lat, lon);
  if (local) counter.textContent = `\u{1F4CD} ${local.name}`;
  const reqId = ++lbLocReqId;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=14`;
    const r = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
    if (reqId !== lbLocReqId) return;
    const data = await r.json();
    const a = data.address || {};
    const place = a.city || a.town || a.village || a.hamlet || a.city_district ||
                  a.municipality || a.county || '';
    if (place) {
      lbLocCache[key] = place;
      _saveLocCache();
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
  const lbVideo = document.getElementById('lightbox-video');

  if (item.type === 'video') {
    // Affichage vidéo
    lbImg.style.display  = 'none';
    lbVideo.style.display = '';
    if (lbVideo.src !== item.src) {
      lbVideo.src = item.src;
      lbVideo.load();
      lbVideo.play().catch(() => {});
    } else if (lbVideo.paused) {
      lbVideo.play().catch(() => {});
    }
    prog.classList.remove('active');
  } else {
    // Affichage photo
    lbVideo.style.display = 'none';
    lbVideo.src = '';
    lbImg.style.display = '';
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
  }
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
document.getElementById('lightbox-video').addEventListener('click', e => e.stopPropagation());
document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
document.getElementById('lightbox-prev').addEventListener('click', () => { if (state.lbIdx > 0) { state.lbIdx--; lbShowCurrent(); } });
document.getElementById('lightbox-next').addEventListener('click', () => { if (state.lbIdx < state.lbPhotos.length - 1) { state.lbIdx++; lbShowCurrent(); } });

// ── Timeline ───────────────────────────────────────────────────────────
// Timeline basée sur le TEMPS : slider = ms UTC, curseur proportionnel au temps réel

function timeToPct(ms) {
  const tMin = state.tMin, tMax = state.tMax;
  if (!tMin || tMax === tMin) return 0;
  return Math.max(0, Math.min(1, (ms - tMin) / (tMax - tMin)));
}

function timeToPhotoIdx(ms) {
  const times = state.photoTimes;
  if (!times || !times.length) return 0;
  let best = 0, bestD = Infinity;
  times.forEach((t, i) => {
    if (t == null) return;
    const d = Math.abs(t - ms);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

// Compat : index photo → pourcentage (via temps)
function photoIdxToPct(pi) {
  const t = state.photoTimes?.[pi];
  if (t != null) return timeToPct(t);
  const n = state.photos.length;
  return n > 1 ? pi / (n - 1) : 0;
}

// Retourne "HHhMM" depuis photoMs (EXIF) ou entryIdx GPX en fallback
function photoTimeStr(p) {
  if (p.photoMs != null) {
    const d = new Date(p.photoMs);
    return `${d.getUTCHours()}h${String(d.getUTCMinutes()).padStart(2,'0')}`;
  }
  if (p.entryIdx != null && state.entries[p.entryIdx]) {
    const e = state.entries[p.entryIdx];
    return `${e.hour}h${String(e.minute).padStart(2,'0')}`;
  }
  return '';
}

function updateTimelineThumbByPhoto(pi) {
  const photos = state.photos;
  if (!photos || !photos.length) return;
  pi = Math.max(0, Math.min(pi, photos.length - 1));
  const t = state.photoTimes?.[pi];
  // Move scroll track so this photo's time is under the fixed cursor
  if (t != null && typeof window._tlSeekToMs === 'function') window._tlSeekToMs(t);
}

// Helper : ville de l'escale la plus proche d'un index photo
function photoEscaleCity(pi) {
  const t = state.photoTimes?.[pi];
  if (t == null) return '';
  const esc = state.escales || [];
  let best = '', bestDist = Infinity;
  esc.forEach(e => {
    if (!e.start || !e.city) return;
    const et = new Date(e.start).getTime();
    if (!isNaN(et)) {
      const d = Math.abs(et - t);
      if (d < bestDist) { bestDist = d; best = e.city; }
    }
  });
  return best;
}

// Affiche la ville dans #date-loc : champ city > escale > Nominatim
let _datLocReqId = 0, _datLocTimer = 0;
async function updateDateLoc(pi, photo) {
  if (!dateLoc) return;
  // 1. Ville stockée dans l'entrée photo (définie à l'ingestion admin)
  if (photo.city) { dateLoc.textContent = photo.city; return; }
  // 2. Escale correspondante
  const city = photoEscaleCity(pi);
  if (city) { dateLoc.textContent = city; return; }

  // Résoudre les coordonnées (GPS EXIF ou point GPX)
  let lat, lon;
  if (photo.lat != null && photo.lon != null) {
    lat = photo.lat; lon = photo.lon;
  } else if (photo.entryIdx != null && state.entries?.[photo.entryIdx]) {
    const e = state.entries[photo.entryIdx];
    lat = e.lat; lon = e.lon;
  }
  if (lat == null) { dateLoc.textContent = ''; return; }

  const key = `${Math.round(lat * 100) / 100},${Math.round(lon * 100) / 100}`;
  if (lbLocCache[key]) { dateLoc.textContent = lbLocCache[key]; return; }

  // Debounce : attend 350 ms de pause avant de contacter Nominatim
  dateLoc.textContent = '…';
  const reqId = ++_datLocReqId;
  clearTimeout(_datLocTimer);
  _datLocTimer = setTimeout(async () => {
    if (reqId !== _datLocReqId) return;
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=14`;
      const r = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
      if (reqId !== _datLocReqId) return;
      const data = await r.json();
      const a = data.address || {};
      const place = a.city || a.town || a.village || a.hamlet || a.city_district ||
                    a.municipality || a.county || '';
      if (place) {
        lbLocCache[key] = place;
        _saveLocCache();
        if (reqId === _datLocReqId) dateLoc.textContent = place;
      } else {
        if (reqId === _datLocReqId) dateLoc.textContent = '';
      }
    } catch { if (reqId === _datLocReqId) dateLoc.textContent = ''; }
  }, 350);
}

// Compat wrapper pour les appels existants par entryIdx
function updateTimelineThumb(idx) {
  const pi = nearestPhotoIdx(idx);
  updateTimelineThumbByPhoto(pi);
}

// Helper : trouver l'index photo le plus proche d'un entryIdx
function photoIdxForEntryIdx(eidx) {
  const photos = state.photos;
  let best = 0, bestD = Infinity;
  photos.forEach((p, i) => {
    if (p.entryIdx == null) return;
    const d = Math.abs(p.entryIdx - eidx);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

// Helper : trouver l'index photo le plus proche d'une date (string)
function photoIdxForDate(dateStr) {
  if (!dateStr) return 0;
  return timeToPhotoIdx(new Date(dateStr).getTime());
}

function buildTimelineCities() {
  if (!tlCitiesRow) return;
  tlCitiesRow.innerHTML = '';
  const photos = state.photos;
  if (!photos || !photos.length) return;

  const escaleTicked = new Set();

  (window.escales || []).forEach(e => {
    const norm = (e.city || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    if (escaleTicked.has(norm)) return;
    escaleTicked.add(norm);
    if (!e.start) return;
    const t = new Date(e.start).getTime();
    if (isNaN(t)) return;
    const pct = timeToPct(t) * 100;
    const div = document.createElement('div');
    div.className = 'tl-city-tick tl-escale-city-tick';
    div.style.left = `${pct}%`;
    div.innerHTML = `<div class="tick-line"></div><div class="tick-name">${e.city}</div>`;
    tlCitiesRow.appendChild(div);
  });
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
    if (seg.isGap) {
      if (idx >= seg.startIdx && idx <= seg.endIdx)
        return seg.cumulStart;
      continue;
    }
    if (idx >= seg.startIdx && idx <= seg.endIdx)
      return seg.cumulStart + (idx - seg.startIdx);
  }
  // Clamp: find nearest segment
  let best = 0, bestDist = Infinity;
  for (const seg of segMap.segments) {
    if (seg.isGap) continue;
    const d = Math.min(Math.abs(idx - seg.startIdx), Math.abs(idx - seg.endIdx));
    if (d < bestDist) { bestDist = d; best = seg.cumulStart + Math.max(0, Math.min(idx - seg.startIdx, seg.points - 1)); }
  }
  return best;
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
const THUMB_STEP = 114; // 110px + 4px gap

function nearestPhotoIdx(entryIdx) {
  const photos = state.photos;
  if (!photos.length) return 0;
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < photos.length; i++) {
    if (photos[i].entryIdx == null) continue;
    const d = Math.abs(photos[i].entryIdx - entryIdx);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
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
  updateTimelineThumb(ip.idx != null ? ip.idx : timeToIndex(t));
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
  const scrubber = document.getElementById('carousel-scrubber');
  if (scrubber) scrubber.value = pi;
}

// ── Select entry ──────────────────────────────────────────────────────
// Sélection par photo : utilise ses coords GPS propres si dispo, sinon entryIdx GPX
function selectPhotoEntry(photo, skipCarousel) {
  if (photo.lat != null && photo.lon != null) {
    showRing([photo.lat, photo.lon]);
    if (!map.getBounds().contains([photo.lat, photo.lon])) {
      map.panTo([photo.lat, photo.lon], { animate: true, duration: 0.4 });
    }
  } else if (photo.entryIdx != null && state.entries[photo.entryIdx]) {
    const e = state.entries[photo.entryIdx];
    showRing([e.lat, e.lon]);
    if (!map.getBounds().contains([e.lat, e.lon])) {
      map.panTo([e.lat, e.lon], { animate: true, duration: 0.4 });
    }
  }
  // Update slider to this photo's ms time
  const pi = state.photos.indexOf(photo);
  if (pi >= 0) {
    updateTimelineThumbByPhoto(pi);
    if (!skipCarousel) scrollCarouselTo(pi, false);
    // Ville / lieu (escale ou Nominatim async)
    updateDateLoc(pi, photo);
    // Update date display from photo
    const cap = photo.caption || '';
    const m = cap.match(/(\d{4})-(\d{2})-(\d{2})/);
    const t = photoTimeStr(photo);
    if (m) {
      if (dateDay)   dateDay.textContent   = parseInt(m[3]);
      if (dateMonth) dateMonth.textContent = MONTHS_FR[parseInt(m[2])];
      if (dateTime)  dateTime.textContent  = t;
    } else if (photo.entryIdx != null && state.entries[photo.entryIdx]) {
      const e = state.entries[photo.entryIdx];
      if (dateDay)   dateDay.textContent   = e.day;
      if (dateMonth) dateMonth.textContent = MONTHS_FR[e.month];
      if (dateTime)  dateTime.textContent  = t;
    }
  }
}

function selectEntry(idx, skipCarousel, skipSlider) {
  const entries = state.entries;
  if (idx < 0 || idx >= entries.length) return;
  const e = entries[idx];
  state.activeIdx = idx;

  showRing([e.lat, e.lon]);
  const pi = nearestPhotoIdx(idx);
  if (!skipCarousel) scrollCarouselTo(pi, false);
  if (!map.getBounds().contains([e.lat, e.lon])) {
    map.panTo([e.lat, e.lon], { animate: true, duration: 0.4 });
  }

  if (dateDay)   dateDay.textContent   = e.day;
  if (dateMonth) dateMonth.textContent = MONTHS_FR[e.month];
  if (dateTime)  dateTime.textContent  = `${e.hour}h${String(e.minute).padStart(2, '0')}`;

  updateTimelineThumbByPhoto(pi);
}

// ── Init ───────────────────────────────────────────────────────────────
async function fetchRepoJson(filename, fallback) {
  try {
    // Les fichiers JSON sont servis directement par GitHub Pages — pas besoin de l'API
    const r = await fetch(`./${filename}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch {
    if (fallback !== undefined) return fallback;
    throw new Error(`Impossible de charger ${filename}`);
  }
}

async function init() {
  let entries, photos, cities, visited, escales, voyages, gapRoutes;
  try {
    [entries, photos, cities, visited, escales, voyages, gapRoutes] = await Promise.all([
      fetchRepoJson('travel.json'),
      fetchRepoJson('photos.json',    []),
      fetchRepoJson('cities.json',    []),
      fetchRepoJson('visited.json',   []),
      fetchRepoJson('escales.json',   []),
      fetchRepoJson('voyages.json',    []),
      fetchRepoJson('gap_routes.json',[]),
    ]);
  } catch (err) {
    console.error('Impossible de charger les données', err);
    return;
  }
  if (!entries.length && !photos.length) return;

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
    base.style.height     = '1px';
    base.style.transform  = 'translateY(-50%)';
    base.style.background = 'rgba(240,192,96,0.75)';
    base.style.zIndex     = '0';
    base.style.pointerEvents = 'none';
  }

  // ── Timeline Escale Highlights (photo-index based) ──
  function renderTimelineEscales(escales) {
    const wrap = document.getElementById('timeline-slider-wrap');
    if (!wrap || !state.photos.length) return;
    Array.from(wrap.querySelectorAll('.tl-escale-bar, .tl-escale-cover, .tl-escale-city-tick, .tl-photo-dot, #tl-date-start, #tl-date-end')).forEach(el => el.remove());

    // ── Photo dots ──
    state.photoTimes.forEach(t => {
      if (t == null) return;
      const pct = timeToPct(t) * 100;
      const dot = document.createElement('div');
      dot.className = 'tl-photo-dot';
      dot.style.left = `${pct}%`;
      wrap.appendChild(dot);
    });

    // ── Escale ticks ──
    (escales || []).forEach(e => {
      if (!e.start) return;
      const t = new Date(e.start).getTime();
      if (isNaN(t)) return;
      const pct = timeToPct(t) * 100;

      const tick = document.createElement('div');
      tick.className = 'tl-escale-city-tick';
      tick.style.cssText = `position:absolute;left:${pct}%;top:50%;transform:translateX(-50%);pointer-events:none;z-index:3`;

      const line = document.createElement('div');
      line.className = 'tick-line';
      tick.appendChild(line);

      const name = document.createElement('div');
      name.className = 'tick-name';
      name.textContent = e.city;
      tick.appendChild(name);

      wrap.appendChild(tick);
    });

    // ── Date labels below ──
    if (state.tMin && state.tMax) {
      const fmt = ms => {
        const d = new Date(ms);
        return `${d.getUTCDate()} ${MONTHS_FR[d.getUTCMonth() + 1]}`;
      };
      const s = document.createElement('div');
      s.id = 'tl-date-start';
      s.textContent = fmt(state.tMin);
      wrap.appendChild(s);

      const e2 = document.createElement('div');
      e2.id = 'tl-date-end';
      e2.textContent = fmt(state.tMax);
      wrap.appendChild(e2);
    }
  }

  // ── Day separators and photo dots ──
  // Rendered inside renderScrollTrack (scroll-track architecture)

  setTimeout(() => {
    renderScrollTrack();
  }, 0);

  // Expose pour rappel externe (ex: après commit escales/photos depuis admin)
  function refreshTimeline() {
    renderScrollTrack();
  }
  window._refreshTimeline = refreshTimeline;
  window._refreshTimelineEscales = () => renderScrollTrack();

  // Normalise les URLs photos :
  //  1. Migre les anciennes URLs pCloud (filedn.com) vers hub.studios-voa.com:1666/files
  //  2. Upgrade http:// → https:// si la page est en HTTPS (évite le mixed-content)
  const HUB_BASE = 'https://hub.studios-voa.com:1666/files';
  function normUrl(u) {
    if (!u) return u;
    // Migration pCloud → hub : extraire le chemin après VELOROUTE/
    const pcloudMatch = u.match(/filedn\.com\/.+?\/VELOROUTE\/(.+)$/);
    if (pcloudMatch) return `${HUB_BASE}/${pcloudMatch[1]}`;
    // Mixed-content : http → https si la page est en https
    if (location.protocol === 'https:' && u.startsWith('http://')) return 'https://' + u.slice(7);
    return u;
  }

  state.entries = entries;                        // keep all (hidden flag preserved for entryIdx compat)
  state.photos  = photos
    .filter(p => !p.hidden)
    .map(p => ({ ...p, src: normUrl(p.src), thumb: normUrl(p.thumb), webp: normUrl(p.webp), src_orig: normUrl(p.src_orig) }));
  state.cities  = cities;
  state.visited = visited;
  state.escales = escales || [];
  state.voyages = voyages || [];

  // ── Filtre voyage ────────────────────────────────────
  const _activeVoyageId = sessionStorage.getItem('voyageFilter') || '';
  const _activeVoyage = state.voyages.find(v => v.id === _activeVoyageId) || null;

  // Peupler le sélecteur
  const voyageSel = document.getElementById('voyage-filter');
  if (voyageSel) {
    while (voyageSel.options.length > 1) voyageSel.remove(1);
    state.voyages.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id; opt.textContent = v.label;
      voyageSel.appendChild(opt);
    });
    voyageSel.value = _activeVoyageId;
    voyageSel.addEventListener('change', () => {
      sessionStorage.setItem('voyageFilter', voyageSel.value);
      location.reload();
    });
  }

  // Appliquer le filtre
  if (_activeVoyage) {
    const gpxSet    = new Set(_activeVoyage.gpxFiles || []);
    const voyPhotos = state.photos.filter(p => p.voyage === _activeVoyageId);

    if (gpxSet.size > 0) {
      // Filtrage explicite par nom de fichier GPX
      state.entries = entries.filter(e => !e.gpxFile || gpxSet.has(e.gpxFile));
    } else {
      // Fallback : jours couverts par les photos du voyage
      const voyageDays = new Set();
      voyPhotos.forEach(p => {
        const m = (p.caption || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) voyageDays.add(`${m[1]}-${m[2]}-${m[3]}`);
      });
      state.entries = voyageDays.size
        ? entries.filter(e => voyageDays.has(`${e.year}-${String(e.month).padStart(2,'0')}-${String(e.day).padStart(2,'0')}`))
        : [];
    }

    state.photos = voyPhotos;
    entries = state.entries; // rebind local var → trace + carte ne montrent que le voyage
    photos  = state.photos;  // rebind local var → marqueurs photo + mediaEntries filtrés
  }

  const year = entries[0]?.year || new Date().getFullYear();
  travelYear = year;

  state.entryTimes    = entries.map(e => Date.UTC(year, e.month - 1, e.day, (e.hour || 0) - TZ_OFFSET, e.minute || 0));
  state.entryTimeMin  = Math.min(...state.entryTimes);
  state.entryTimeMax  = Math.max(...state.entryTimes);

  // Temps réel de chaque photo (ms UTC) — pour positionnement proportionnel sur la timeline
  state.photoTimes = state.photos.map(p => {
    if (p.photoMs != null) return p.photoMs;
    const m = (p.caption || '').match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0); // midi UTC si pas de photoMs
    return null;
  });
  state.tMin = Math.min(...state.photoTimes.filter(t => t != null));
  state.tMax = Math.max(...state.photoTimes.filter(t => t != null));

  // ── Interpolation GPS pour photos sans coordonnées ───────────────────
  // Pour chaque photo sans lat/lon, cherche les voisins temporels avec GPS.
  // Seuil : 6h. Interpole linéairement si les deux existent, sinon copie le plus proche.
  (function interpolatePhotoCoords(photos) {
    const MAX_MS = 6 * 3600 * 1000;
    const anchors = photos
      .filter(p => p.lat != null && p.lon != null && p.photoMs != null)
      .sort((a, b) => a.photoMs - b.photoMs);
    if (!anchors.length) return;
    photos.forEach(p => {
      if (p.lat != null || p.photoMs == null) return;
      const ms = p.photoMs;
      let prev = null, next = null;
      for (let i = anchors.length - 1; i >= 0; i--) { if (anchors[i].photoMs <= ms) { prev = anchors[i]; break; } }
      for (let i = 0; i < anchors.length; i++)         { if (anchors[i].photoMs >= ms) { next = anchors[i]; break; } }
      const prevOk = prev && (ms - prev.photoMs) <= MAX_MS;
      const nextOk = next && (next.photoMs - ms) <= MAX_MS;
      if (!prevOk && !nextOk) return;
      if (prevOk && nextOk) {
        const span = next.photoMs - prev.photoMs;
        const t = span > 0 ? (ms - prev.photoMs) / span : 0;
        p.lat = prev.lat + t * (next.lat - prev.lat);
        p.lon = prev.lon + t * (next.lon - prev.lon);
      } else {
        const ref = nextOk ? next : prev;
        p.lat = ref.lat; p.lon = ref.lon;
      }
      p._gpsInterp = true; // coordonnées interpolées, pas EXIF
    });
  })(state.photos);

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

  // ── Carousel scroll → sync slider + scrubber ──
  let carouselScrollTimer = null;
  carousel.addEventListener('scroll', () => {
    if (carouselScrollTimer) clearTimeout(carouselScrollTimer);
    carouselScrollTimer = setTimeout(() => {
      const pi = Math.round(carousel.scrollLeft / THUMB_STEP);
      const clamped = Math.max(0, Math.min(pi, state.photos.length - 1));
      const scrubber = document.getElementById('carousel-scrubber');
      if (scrubber) scrubber.value = clamped;
      if (clamped !== state.activePhotoIdx) {
        updateTimelineThumbByPhoto(clamped);
        selectPhotoEntry(state.photos[clamped], true);
      }
    }, 80);
  }, { passive: true });

  const MONTHS_SHORT = ['','jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];
  const fragment = document.createDocumentFragment();
  state.photos.forEach((p, i) => {
    // Date + heure label
    const cap = p.caption || '';
    const dm = cap.match(/^(\d{4})-(\d{2})-(\d{2})/);
    let labelText = '';
    if (dm) {
      const t = photoTimeStr(p);
      labelText = `${parseInt(dm[3])} ${MONTHS_SHORT[parseInt(dm[2])]}`;
      if (t) labelText += ` ${t}`;
    }

    // Élément vignette : <video> si thumb mp4 animée, sinon <img>
    const isMp4Thumb = p.type === 'video' && (p.thumb || '').endsWith('.mp4');
    let thumbEl;
    if (isMp4Thumb) {
      thumbEl = document.createElement('video');
      thumbEl.autoplay = true; thumbEl.muted = true; thumbEl.loop = true;
      thumbEl.setAttribute('playsinline', ''); thumbEl.setAttribute('preload', 'metadata');
      if (i < 6) { thumbEl.src = p.thumb; }
      else        { thumbEl.dataset.src = p.thumb; }
    } else {
      thumbEl = document.createElement('img');
      if (p.type === 'video' && !p.thumb) {
        thumbEl.style.visibility = 'hidden';
      } else if (i < 10) {
        thumbEl.src = p.thumb || p.src;
      } else {
        thumbEl.dataset.src = p.thumb || p.src;
      }
      if (p.type === 'video') {
        thumbEl.onerror = () => { thumbEl.removeAttribute('src'); thumbEl.style.visibility = 'hidden'; };
      } else {
        thumbEl.onerror = () => { if (thumbEl.src.includes('/Thumbs/') && p.src) thumbEl.src = p.src; };
      }
    }
    thumbEl.className = 'photo-thumb';
    thumbEl.draggable = false;

    const outer = document.createElement('div');
    outer.className = 'thumb-cell';

    if (p.type === 'video') {
      const wrap = document.createElement('div');
      wrap.className = 'video-thumb-wrap';
      let clickTimer = null;
      wrap.addEventListener('click', () => {
        if (clickTimer) return; // ignore second click of dblclick
        clickTimer = setTimeout(() => { clickTimer = null; selectPhotoEntry(p); scrollCarouselTo(i, true); }, 220);
      });
      wrap.addEventListener('dblclick', () => {
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        selectPhotoEntry(p); openLightbox(state.photos, i);
      });
      wrap.appendChild(thumbEl);
      // Icône play seulement si pas de vignette animée mp4
      if (!isMp4Thumb) {
        const badge = document.createElement('div');
        badge.className = 'play-badge';
        badge.setAttribute('aria-hidden', 'true');
        wrap.appendChild(badge);
      }
      outer.appendChild(wrap);
    } else {
      let clickTimer = null;
      thumbEl.addEventListener('click', () => {
        if (clickTimer) return;
        clickTimer = setTimeout(() => { clickTimer = null; selectPhotoEntry(p); scrollCarouselTo(i, true); }, 220);
      });
      thumbEl.addEventListener('dblclick', () => {
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        selectPhotoEntry(p); openLightbox(state.photos, i);
      });
      outer.appendChild(thumbEl);
    }

    if (labelText) {
      const dateLbl = document.createElement('div');
      dateLbl.className = 'thumb-date';
      dateLbl.textContent = labelText;
      outer.appendChild(dateLbl);
    }
    fragment.appendChild(outer);
  });
  if (carousel) {
    carousel.appendChild(fragment);
    state.thumbEls = Array.from(carousel.querySelectorAll('.photo-thumb'));
    state.thumbEls.forEach(img => thumbObserver.observe(img));
  } else {
    console.warn('photo-carousel element not found');
    state.thumbEls = [];
  }

  // ── Scrubber carousel ──
  const scrubber = document.getElementById('carousel-scrubber');
  if (scrubber && state.photos.length) {
    scrubber.max = state.photos.length - 1;
    scrubber.value = 0;
    scrubber.addEventListener('input', () => {
      const pi = Number(scrubber.value);
      scrollCarouselTo(pi, false);
      selectPhotoEntry(state.photos[pi], true);
    });
  }

  // Nearest entryIdx for each city / escale
  // Pour les escales : utilise la date (start) pour matcher le point temporellement le plus proche
  // Pour cities/visited : matcher par position géographique
  const assignEntryIdxByPos = arr => arr.forEach(c => {
    let best = 0, bestD = Infinity;
    entries.forEach((e, i) => {
      const d = (e.lat - c.lat) ** 2 + (e.lon - c.lon) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    c.entryIdx = best;
  });

  const assignEntryIdxByTime = arr => {
    if (!state.entryTimes || state.entryTimes.length === 0) {
      assignEntryIdxByPos(arr);
      return;
    }
    arr.forEach(c => {
      if (!c.start) { assignEntryIdxByPos([c]); return; }
      const t = new Date(c.start).getTime();
      if (isNaN(t)) { assignEntryIdxByPos([c]); return; }
      c.entryIdx = timeToIndex(t);
    });
  };

  assignEntryIdxByPos(cities);
  assignEntryIdxByPos(visited);
  assignEntryIdxByTime(escales.filter(e => e.start != null));
  window.escales = escales; // exposé après assignEntryIdx (entryIdx disponibles)

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

  // ── Photo markers on map ──
  // Montre un point doré pour chaque photo avec GPS, surtout celles sans trace GPX
  const photoMarkerLayer = L.layerGroup().addTo(map);
  photos.forEach((p, i) => {
    if (p.lat == null || p.lon == null) return;
    const hasTrace = p.entryIdx != null;
    const marker = L.circleMarker([p.lat, p.lon], {
      radius: hasTrace ? 4 : 6,
      color: '#fff',
      fillColor: hasTrace ? '#f0c060' : '#e07040',
      fillOpacity: hasTrace ? 0.6 : 0.85,
      weight: hasTrace ? 1 : 2,
      pane: 'markerPane',
    });
    marker.on('click', () => {
      scrollCarouselTo(i, true);
      selectPhotoEntry(p, true);
    });
    marker.addTo(photoMarkerLayer);
  });

  // Ajuste le cadrage carte pour inclure les photos hors trace 
  const allPhotoLatLngs = photos
    .filter(p => p.lat != null && p.lon != null)
    .map(p => [p.lat, p.lon]);
  const allPoints = latlngs.concat(allPhotoLatLngs);
  if (allPoints.length) map.fitBounds(L.latLngBounds(allPoints), { padding: [20, 20] });


  // ── Visited city labels ──
  visited.forEach(c => {
    L.marker([c.lat, c.lon], {
      pane: 'labelsPane',
      icon: L.divIcon({ className: 'city-label', html: c.name, iconAnchor: [0, 0] }),
      interactive: false,
    }).addTo(map);
  });

  // Update timeline edge labels from photos
  if (state.photos.length > 0) {
    const startEl = document.getElementById('tl-label-start');
    const endEl   = document.getElementById('tl-label-end');
    const labelFromCaption = (cap) => {
      const m = (cap || '').match(/(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${parseInt(m[3])} ${MONTHS_FR[parseInt(m[2])]}` : '';
    };
    if (startEl) startEl.textContent = labelFromCaption(state.photos[0].caption);
    if (endEl)   endEl.textContent   = labelFromCaption(state.photos[state.photos.length - 1].caption);
  }

  // ── Timeline setup (temps réel, track scrollable) ──
  state.segMap = entries.length ? buildSegmentMap(entries, state.entryTimes) : null;

  const nPhotos = state.photos.length;
  const tlWrap = document.getElementById('timeline-slider-wrap');

  // Zoom : 10 jours visibles sur toute la largeur du conteneur
  const VISIBLE_DAYS = 10;
  const MS_PER_DAY   = 86400000;
  const totalMs      = (state.tMax || 0) - (state.tMin || 0);

  // Current timeline time (ms), centered under cursor
  let tlCurrentMs = state.tMin || 0;

  function tlPxPerMs() {
    const w = tlWrap ? (tlWrap.offsetWidth || window.innerWidth) : window.innerWidth;
    return w / (VISIBLE_DAYS * MS_PER_DAY);
  }
  function tlTrackWidth() {
    return Math.round(totalMs * tlPxPerMs());
  }
  function msToPx(ms) {
    if (!totalMs) return 0;
    return (ms - state.tMin) * tlPxPerMs();
  }
  function pxToMs(px) {
    const ppm = tlPxPerMs();
    return ppm ? state.tMin + px / ppm : state.tMin;
  }

  // Build the scroll track once
  let tlTrack = document.getElementById('tl-scroll-track');
  if (!tlTrack && tlWrap) {
    tlTrack = document.createElement('div');
    tlTrack.id = 'tl-scroll-track';
    tlWrap.appendChild(tlTrack);
  }

  function renderScrollTrack() {
    if (!tlWrap || !tlTrack) return;
    const W = tlTrackWidth();
    const halfWrap = tlWrap.offsetWidth / 2;
    tlTrack.style.width = W + 'px';

    tlTrack.innerHTML = '';

    // Base line
    const base = document.createElement('div');
    base.className = 'tl-base-line';
    tlTrack.appendChild(base);

    // Photo dots
    state.photoTimes.forEach(t => {
      if (t == null) return;
      const x = msToPx(t);
      const dot = document.createElement('div');
      dot.className = 'tl-photo-dot';
      dot.style.left = `${x}px`;
      tlTrack.appendChild(dot);
    });

    // Escale ticks
    (state.escales || []).forEach(e => {
      if (!e.start) return;
      const t = new Date(e.start).getTime();
      if (isNaN(t)) return;
      const x = msToPx(t);

      const tick = document.createElement('div');
      tick.className = 'tl-escale-city-tick';
      tick.style.cssText = `position:absolute;left:${x}px;top:50%;transform:translateX(-50%);pointer-events:none;z-index:3`;

      const line = document.createElement('div');
      line.className = 'tick-line';
      tick.appendChild(line);

      const name = document.createElement('div');
      name.className = 'tick-name';
      name.textContent = e.city;
      tick.appendChild(name);

      tlTrack.appendChild(tick);
    });

    // Date labels at start and end of track
    if (state.tMin && state.tMax) {
      const fmt = ms => {
        const d = new Date(ms);
        return `${d.getUTCDate()} ${MONTHS_FR[d.getUTCMonth() + 1]}`;
      };
      const s = document.createElement('div');
      s.id = 'tl-date-start';
      s.style.cssText = `position:absolute;left:0;top:calc(50% + 7px);font-size:0.52rem;letter-spacing:0.06em;font-weight:600;color:rgba(240,192,96,0.55);text-transform:uppercase;white-space:nowrap;pointer-events:none;z-index:5`;
      s.textContent = fmt(state.tMin);
      tlTrack.appendChild(s);

      const eEl = document.createElement('div');
      eEl.id = 'tl-date-end';
      eEl.style.cssText = `position:absolute;right:0;top:calc(50% + 7px);font-size:0.52rem;letter-spacing:0.06em;font-weight:600;color:rgba(240,192,96,0.55);text-transform:uppercase;white-space:nowrap;pointer-events:none;z-index:5`;
      eEl.textContent = fmt(state.tMax);
      tlTrack.appendChild(eEl);
    }

    // Position track so tlCurrentMs is under center
    setTrackOffset(tlCurrentMs);
  }

  function setTrackOffset(ms) {
    if (!tlTrack || !tlWrap) return;
    const halfWrap = tlWrap.offsetWidth / 2;
    const x = msToPx(ms);
    tlTrack.style.left = `${halfWrap - x}px`;
  }

  // Expose track-offset mover for use by updateTimelineThumbByPhoto (no recursion)
  window._tlSeekToMs = ms => setTrackOffset(ms);

  function seekToMs(ms) {
    const clamped = Math.max(state.tMin, Math.min(state.tMax, ms));
    tlCurrentMs = clamped;
    setTrackOffset(clamped);
    const pi = timeToPhotoIdx(clamped);
    scrollCarouselTo(pi);
    const photo = state.photos[pi];
    if (photo) {
      if (photo.lat != null && photo.lon != null) {
        try { showRing([photo.lat, photo.lon]); } catch(e) {}
      } else if (photo.entryIdx != null && state.entries[photo.entryIdx]) {
        const e = state.entries[photo.entryIdx];
        try { showRing([e.lat, e.lon]); } catch(e2) {}
      }
    }
  }

  // ── Pointer/touch drag on timeline ──
  let tlDrag = null;
  if (tlWrap) {
  tlWrap.addEventListener('pointerdown', e => {
    e.preventDefault();
    tlWrap.setPointerCapture(e.pointerId);
    tlWrap.classList.add('dragging');
    cancelAutoSlide();
    tlDrag = { startX: e.clientX, startMs: tlCurrentMs };
  });
  tlWrap.addEventListener('pointermove', e => {
    if (!tlDrag) return;
    const dx = e.clientX - tlDrag.startX;
    seekToMs(tlDrag.startMs - dx / tlPxPerMs(), false);
  });
  const endDrag = e => {
    if (!tlDrag) return;
    tlWrap.classList.remove('dragging');
    const moved  = Math.abs(e.clientX - tlDrag.startX);
    tlDrag = null;

    if (moved < 5) {
      // Clic : animer pour centrer le temps cliqué sous le curseur
      cancelAutoSlide();
      const rect   = tlWrap.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const target = Math.max(state.tMin, Math.min(state.tMax,
        tlCurrentMs + (clickX - tlWrap.offsetWidth / 2) / tlPxPerMs()));
      const from   = tlCurrentMs;
      animateToTime(from, target, 500,
        val => { tlCurrentMs = val; setTrackOffset(val); },
        () => { tlCurrentMs = target; const pi = timeToPhotoIdx(target); const photo = state.photos[pi]; if (photo) selectPhotoEntry(photo, false); }
      );
      return;
    }

    // Fin de drag : snap vers l'escale la plus proche
    const snappedMs = snapToEscaleMs(tlCurrentMs);
    if (snappedMs !== tlCurrentMs) {
      animateToTime(tlCurrentMs, snappedMs, 1500,
        val => seekToMs(val, false),
        () => { const pi = timeToPhotoIdx(snappedMs); const photo = state.photos[pi]; if (photo) selectPhotoEntry(photo, false); }
      );
    } else {
      const pi = timeToPhotoIdx(tlCurrentMs);
      const photo = state.photos[pi];
      if (photo) selectPhotoEntry(photo, false);
    }
  };
  tlWrap.addEventListener('pointerup', endDrag);
  tlWrap.addEventListener('pointercancel', e => { tlDrag = null; tlWrap.classList.remove('dragging'); });

  // ── Wheel scroll on timeline ──
  tlWrap.addEventListener('wheel', e => {
    e.preventDefault();
    cancelAutoSlide();
    seekToMs(tlCurrentMs + (e.deltaY + e.deltaX) / tlPxPerMs(), false);
  }, { passive: false });
  } // end if (tlWrap)

  function snapToEscaleMs(currentMs) {
    const esc = state.escales || [];
    if (!esc.length) return currentMs;
    let bestMs = null, bestDist = Infinity;
    esc.forEach(e => {
      if (!e.start) return;
      const t = new Date(e.start).getTime();
      if (isNaN(t)) return;
      const dist = Math.abs(t - currentMs);
      if (dist < bestDist) { bestDist = dist; bestMs = t; }
    });
    // Only snap if within 2 days
    return (bestMs != null && bestDist < 2 * MS_PER_DAY) ? bestMs : currentMs;
  }

  // Start position
  const startPi = nPhotos > 0 ? Math.floor(Math.random() * nPhotos) : 0;
  tlCurrentMs = state.photoTimes?.[startPi] || state.tMin || 0;
  setTimeout(() => {
    renderScrollTrack();
    updateTimelineThumbByPhoto(startPi);
    if (nPhotos > 0) selectPhotoEntry(state.photos[startPi], false);
    else if (entries.length) selectEntry(0);
  }, 0);

  window.addEventListener('resize', () => {
    renderScrollTrack();
  });

  buildTimelineCities(); // still used for the hidden cities-row if needed

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

  // ── Nav buttons (navigate between photo-bearing entries) ──
  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }
  function navPrev() {
    const pi = state.activePhotoIdx;
    if (pi > 0) {
      scrollCarouselTo(pi - 1, true);
      selectPhotoEntry(photos[pi - 1], true);
    }
  }
  function navNext() {
    const pi = state.activePhotoIdx;
    if (pi < photos.length - 1) {
      scrollCarouselTo(pi + 1, true);
      selectPhotoEntry(photos[pi + 1], true);
    }
  }

  // ── Carousel arrows — naviguent photo par photo, restent centrées ──
  const carouselEl = document.getElementById('photo-carousel');
  function attachCarouselArrow(btnId, fn) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    let intervalId = null;
    function start() { fn(); intervalId = setInterval(() => fn(), 350); }
    function stop()  { if (intervalId) { clearInterval(intervalId); intervalId = null; } }
    btn.addEventListener('mousedown', start);
    btn.addEventListener('touchstart', start, { passive: true });
    btn.addEventListener('mouseup', stop);
    btn.addEventListener('mouseleave', stop);
    btn.addEventListener('touchend', stop);
  }
  attachCarouselArrow('carousel-prev', navPrev);
  attachCarouselArrow('carousel-next', navNext);

  document.getElementById('tl-prev')?.addEventListener('click', debounce(navPrev, 400));
  document.getElementById('tl-next')?.addEventListener('click', debounce(navNext, 400));

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
