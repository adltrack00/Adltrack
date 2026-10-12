/* Nearest drop-off: the closest places that accept this store's returns, through Google Places API (New).
   Google has the most complete US store listings with opening hours. Its terms allow keeping only place ids and coordinates
   (for up to 30 days), so those are cached per store and area (about 1 km, never linked to a user) and the name, address
   and hours of the closest few are fetched fresh each time. The user's exact location is only used for this request. */

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const DETAILS_URL = 'https://places.googleapis.com/v1/places/';
const CACHE_DAYS = 30;
const RADIUS_M = 25000;
const SHOW = 3;

const words = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/* Distance in miles between two points. */
function miles(a, b) {
  const rad = d => d * Math.PI / 180, R = 3958.8;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const validPoint = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
// About 1 km: close enough that the nearest places are the same, coarse enough that the cache says little about anyone.
const cell = (lat, lng) => `${lat.toFixed(2)},${lng.toFixed(2)}`;
const directions = p => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&destination_place_id=${encodeURIComponent(p.id)}`;

function createPlaces({ apiKey = process.env.GOOGLE_PLACES_API_KEY || '', store, fetch: fetchImpl = globalThis.fetch, log = console } = {}) {
  const call = async (url, init, mask) => {
    const res = await fetchImpl(url, { ...init, headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': mask, ...(init.headers || {}) }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Places request failed (${res.status})`);
    return res.json();
  };

  /* Place ids and coordinates of one store or partner around one area, from the cache or one Text Search. Only places whose
     name carries the store's name count, so "Apple" never returns an Applebee's. */
  async function search(query, lat, lng) {
    const key = `${words(query)}@${cell(lat, lng)}`;
    const cached = await store.getPlaceCache(key, new Date(Date.now() - CACHE_DAYS * 24 * 3600 * 1000));
    if (cached) return cached;
    const center = { latitude: Number(lat.toFixed(2)), longitude: Number(lng.toFixed(2)) };
    const r = await call(SEARCH_URL, { method: 'POST', body: JSON.stringify({ textQuery: query, locationBias: { circle: { center, radius: RADIUS_M } }, pageSize: 5 }) }, 'places.id,places.location,places.displayName');
    const want = words(query);
    const places = (r.places || []).filter(p => p.id && p.location && ` ${words(p.displayName && p.displayName.text)} `.includes(` ${want} `))
      .map(p => ({ id: p.id, lat: p.location.latitude, lng: p.location.longitude, query }));
    await store.putPlaceCache(key, places);
    return places;
  }

  async function details(id) {
    const r = await call(DETAILS_URL + encodeURIComponent(id), { method: 'GET' }, 'id,displayName,shortFormattedAddress,currentOpeningHours');
    const h = r.currentOpeningHours || null;
    return { name: r.displayName ? r.displayName.text : '', address: r.shortFormattedAddress || '', openNow: h && typeof h.openNow === 'boolean' ? h.openNow : null, hours: h && Array.isArray(h.weekdayDescriptions) ? h.weekdayDescriptions.slice(0, 7) : [] };
  }

  /* queries: store or partner names from the policy; lat/lng: the device's location. Closest first, at most three. */
  async function nearest(queries, lat, lng) {
    if (!validPoint(lat, lng)) throw Object.assign(new Error('That location isn’t valid.'), { status: 400 });
    const here = { lat, lng };
    const found = (await Promise.all(queries.map(q => search(q, lat, lng)))).flat();
    const seen = new Set();
    const closest = found.filter(p => !seen.has(p.id) && seen.add(p.id))
      .map(p => ({ ...p, miles: miles(here, p) })).filter(p => p.miles <= RADIUS_M / 1609.34)
      .sort((a, b) => a.miles - b.miles).slice(0, SHOW);
    return Promise.all(closest.map(async p => {
      let d = { name: p.query, address: '', openNow: null, hours: [] };
      try { d = { ...d, ...(await details(p.id)) }; if (!d.name) d.name = p.query; } catch (err) { log.error('Place details failed:', err.message); }
      return { id: p.id, name: d.name, partner: p.query, address: d.address, miles: Math.round(p.miles * 10) / 10, openNow: d.openNow, hours: d.hours, directions: directions(p) };
    }));
  }

  return { available: () => !!apiKey, nearest };
}

module.exports = { createPlaces, miles };
