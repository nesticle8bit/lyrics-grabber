const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

const LRCLIB_BASE = 'https://lrclib.net/api';
const USER_AGENT = 'LyricsGrabber/1.0.0 (https://github.com/lyrics-grabber)';

let cache = {};
let cachePath = null;

function initCache(userDataPath) {
  cachePath = path.join(userDataPath, 'lyrics-cache.json');
  try {
    if (fs.existsSync(cachePath)) {
      cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    }
  } catch {
    cache = {};
  }
}

function saveCache() {
  if (!cachePath) return;
  try {
    fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf-8');
  } catch {}
}

function getCacheKey(artist, title) {
  return `${normalize(artist)}::${normalize(title)}`.toLowerCase();
}

function normalize(str) {
  if (!str) return '';
  return str
    .replace(/\s*\(feat\.?[^)]*\)/gi, '')
    .replace(/\s*\[feat\.?[^\]]*\]/gi, '')
    .replace(/\s*ft\.?\s+.*/gi, '')
    .replace(/\s*featuring\s+.*/gi, '')
    .replace(/\s*\(remix\)/gi, '')
    .replace(/\s*\[remix\]/gi, '')
    .replace(/\s*\(live\)/gi, '')
    .replace(/\s*\[live\]/gi, '')
    .replace(/\s*\(acoustic\)/gi, '')
    .replace(/\s*\(remaster(ed)?\)/gi, '')
    .replace(/\s*\[remaster(ed)?\]/gi, '')
    .replace(/\s*-\s*remaster(ed)?\s*(\d{4})?/gi, '')
    .replace(/\s*-\s*bonus\s*track/gi, '')
    .replace(/\s*\(deluxe[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: { 'User-Agent': USER_AGENT }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function encodeParams(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

async function fetchLyrics(artist, title, album, duration) {
  const normArtist = normalize(artist);
  const normTitle = normalize(title);
  const normAlbum = normalize(album);

  const key = getCacheKey(artist, title);
  if (cache[key]) {
    return cache[key] === 'NOT_FOUND' ? null : cache[key];
  }

  let result = null;

  result = await tryLrclib(artist, title, album, duration);


  if (!result && (normArtist !== artist || normTitle !== title)) {
    result = await tryLrclib(normArtist, normTitle, normAlbum, duration);
  }

  if (!result) {
    result = await tryLrclib(normArtist, normTitle, '', duration);
  }

  if (!result) {
    result = await tryLrclibSearch(normArtist, normTitle, duration);
  }


  if (!result && (normArtist !== artist || normTitle !== title)) {
    result = await tryLrclibSearch(artist, title, duration);
  }

  if (!result && normArtist.toLowerCase().startsWith('the ')) {
    result = await tryLrclibSearch(normArtist.replace(/^the\s+/i, ''), normTitle, duration);
  }

  if (!result) {
    const swapped = normArtist.includes('&') ? normArtist.replace(/\s*&\s*/g, ' and ') : normArtist.replace(/\s+and\s+/gi, ' & ');
    if (swapped !== normArtist) result = await tryLrclibSearch(swapped, normTitle, duration);
  }

  if (!result) {
    result = await tryLrclibSearch('', normTitle, duration);
  }

  cache[key] = result || 'NOT_FOUND';
  saveCache();

  return result;
}

async function tryLrclib(artist, title, album, duration) {
  try {
    const params = encodeParams({
      artist_name: artist,
      track_name: title,
      album_name: album || undefined,
      duration: duration || undefined
    });
    const r = await httpGet(`${LRCLIB_BASE}/get?${params}`);
    if (r && (r.syncedLyrics || r.plainLyrics)) {
      return { synced: r.syncedLyrics || null, plain: r.plainLyrics || null, source: 'lrclib' };
    }
  } catch {}
  return null;
}

async function tryLrclibSearch(artist, title, duration) {
  try {
    const q = `${artist} ${title}`;
    const results = await httpGet(`${LRCLIB_BASE}/search?${encodeParams({ q })}`);
    if (!results || !Array.isArray(results) || results.length === 0) return null;

    const withSynced = results.filter(r => r.syncedLyrics);
    const candidates = withSynced.length > 0 ? withSynced : results.filter(r => r.plainLyrics);
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const diffA = Math.abs((a.duration || 0) - (duration || 0));
      const diffB = Math.abs((b.duration || 0) - (duration || 0));
      return diffA - diffB;
    });

    const best = candidates[0];
    return {
      synced: best.syncedLyrics || null,
      plain: best.plainLyrics || null,
      source: 'lrclib-search'
    };
  } catch {}
  return null;
}

function clearCache() {
  cache = {};
  saveCache();
}

function getCacheStats() {
  const entries = Object.keys(cache).length;
  const found = Object.values(cache).filter(v => v !== 'NOT_FOUND').length;
  return { entries, found, notFound: entries - found };
}

module.exports = { fetchLyrics, initCache, clearCache, getCacheStats, normalize };
