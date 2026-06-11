let songs = new Map();
let currentFilter = 'all';
let searchQuery = '';
let isRunning = false;
let filteredCache = [];
let searchDebounce = null;
let currentModalSongId = null;
let coverCache = new Map();
let prevStats = {};
let lyricsPreviewCache = new Map();
let hoverTimeout = null;

let ROW_HEIGHT = 88;
const OVERSCAN = 8;

function updateRowHeight() {
  ROW_HEIGHT = window.innerWidth <= 500 ? 76 : 88;
}
window.addEventListener('resize', () => { updateRowHeight(); renderVirtual(); });
updateRowHeight();

const $ = (s) => document.querySelector(s);
const songList = $('#song-list');
const emptyState = $('#empty-state');
const scanOverlay = $('#scan-overlay');
const scanDetail = $('#scan-detail');
const scanCount = $('#scan-count');
const searchInput = $('#search-input');
const btnStart = $('#btn-start');
const btnPause = $('#btn-pause');
const progressFill = $('#progress-fill');
const progressText = $('#progress-text');
const progressEta = $('#progress-eta');
const dropOverlay = $('#drop-overlay');
const foldersPanel = $('#folders-panel');
const foldersList = $('#folders-list');
const lyricsModal = $('#lyrics-modal');
const lyricsEditor = $('#lyrics-editor');

const scrollContainer = document.createElement('div');
scrollContainer.className = 'virtual-scroll-container';
const scrollContent = document.createElement('div');
scrollContent.className = 'virtual-scroll-content';
scrollContainer.appendChild(scrollContent);

const toast = document.createElement('div');
toast.className = 'toast';
document.body.appendChild(toast);

const tooltip = document.createElement('div');
tooltip.className = 'lyrics-tooltip';
document.body.appendChild(tooltip);

const confettiCanvas = document.createElement('canvas');
confettiCanvas.id = 'confetti-canvas';
document.body.appendChild(confettiCanvas);

const miniPlayer = document.createElement('div');
miniPlayer.className = 'mini-player';
miniPlayer.innerHTML = `
  <div class="mini-player-cover">
    <img style="display:none" />
    <div class="mini-player-cover-placeholder"></div>
  </div>
  <div class="mini-player-dot"></div>
  <div class="mini-player-info">
    <div class="mini-player-title"></div>
    <div class="mini-player-artist"></div>
  </div>
  <div class="mini-player-status">Fetching lyrics...</div>
`;
document.getElementById('app').appendChild(miniPlayer);

emptyState.innerHTML = `
  <div class="empty-state-icon">
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
  </div>
  <h3>No songs yet</h3>
  <p>Add a music folder or drag & drop folders here to start fetching lyrics</p>
`;

const SORT_ORDER = { processing: 0, pending: 1, failed: 2, completed: 3, skipped: 4 };

async function init() {
  const theme = await window.api.getTheme();
  document.body.setAttribute('data-theme', theme);

  const data = await window.api.getAll();
  data.songs.forEach(s => songs.set(s.id, s));
  isRunning = data.isRunning;
  prevStats = data.stats;
  updateFilteredCache();
  renderVirtual();
  updateStatsImmediate(data.stats);
  updateRunningState();
  updateProgress(data.stats);
  updateMiniPlayer();

  songList.addEventListener('scroll', onScroll, { passive: true });
  setupDragDrop();
  setupKeyboardShortcuts();
}

let scrollRAF = null;
function onScroll() {
  if (scrollRAF) return;
  scrollRAF = requestAnimationFrame(() => { scrollRAF = null; renderVirtual(); });
}

function setupDragDrop() {
  let dragCounter = 0;
  document.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; dropOverlay.classList.add('active'); });
  document.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove('active'); } });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('active');
    const paths = Array.from(e.dataTransfer.files).map(f => f.path);
    if (paths.length > 0) {
      scanOverlay.style.display = 'flex';
      try {
        const results = await window.api.dropFolders(paths);
        const totalAdded = results.reduce((s, r) => s + r.added, 0);
        if (totalAdded > 0) showToast(`Added ${totalAdded} songs from ${results.length} folder(s)`);
      } catch (err) { console.error(err); }
      scanOverlay.style.display = 'none';
      refreshAll();
    }
  });
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); searchInput.focus(); searchInput.select(); }
    if (e.key === 'Escape') {
      if (lyricsModal.style.display !== 'none') { lyricsModal.style.display = 'none'; return; }
      if (foldersPanel.style.display !== 'none') { foldersPanel.style.display = 'none'; return; }
      if (document.activeElement === searchInput) { searchInput.blur(); return; }
    }
    if (e.key === ' ' && document.activeElement !== searchInput && document.activeElement !== lyricsEditor) {
      e.preventDefault();
      if (isRunning) { window.api.pauseQueue(); isRunning = false; } else { window.api.startQueue(); isRunning = true; }
      updateRunningState();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') { e.preventDefault(); rescanAll(); }
  });
}

$('#btn-add-folder').addEventListener('click', addFolders);
$('#btn-add-folder-panel').addEventListener('click', addFolders);

async function addFolders() {
  const folders = await window.api.selectFolder();
  if (!folders) return;
  scanOverlay.style.display = 'flex';
  let totalAdded = 0;
  for (const folder of folders) { try { const r = await window.api.addFolder(folder); totalAdded += r.added; } catch {} }
  scanOverlay.style.display = 'none';
  if (totalAdded > 0) showToast(`Added ${totalAdded} new songs`);
  refreshAll();
}

btnStart.addEventListener('click', () => { window.api.startQueue(); isRunning = true; updateRunningState(); });
btnPause.addEventListener('click', () => { window.api.pauseQueue(); isRunning = false; updateRunningState(); });
$('#btn-retry').addEventListener('click', async () => { const c = await window.api.retryFailed(); if (c > 0) showToast(`Retrying ${c} songs`); });

$('#btn-clear').addEventListener('click', async () => {
  const c = await window.api.clearCompleted();
  if (c > 0) {
    for (const [id, s] of songs) { if (s.status === 'completed' || s.status === 'skipped') songs.delete(id); }
    updateFilteredCache(); renderVirtual(); showToast(`Cleared ${c} songs`);
  }
});

$('#btn-rescan').addEventListener('click', rescanAll);
async function rescanAll() {
  scanOverlay.style.display = 'flex';
  try { const a = await window.api.rescanAll(); showToast(a > 0 ? `Found ${a} new songs` : 'No new songs found'); } catch {}
  scanOverlay.style.display = 'none';
  refreshAll();
}

searchInput.addEventListener('input', (e) => {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => { searchQuery = e.target.value.toLowerCase(); updateFilteredCache(); renderVirtual(); }, 150);
});

document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter = chip.dataset.filter;
    updateFilteredCache(); renderVirtual();
  });
});

$('#btn-theme').addEventListener('click', async () => {
  const next = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.body.setAttribute('data-theme', next);
  await window.api.setTheme(next);
});

$('#btn-folders').addEventListener('click', () => { foldersPanel.style.display = 'block'; renderFolders(); });
$('#btn-close-folders').addEventListener('click', () => { foldersPanel.style.display = 'none'; });
$('#panel-backdrop').addEventListener('click', () => { foldersPanel.style.display = 'none'; });

async function renderFolders() {
  const data = await window.api.getAll();
  const folders = data.folders || [];
  if (folders.length === 0) { foldersList.innerHTML = '<p style="text-align:center;color:var(--text-tertiary);padding:40px">No folders added</p>'; return; }
  foldersList.innerHTML = folders.map(f => `
    <div class="folder-item">
      <div class="folder-path" title="${esc(f)}">${esc(f)}</div>
      <div class="folder-actions">
        <button class="folder-btn" data-action="rescan" data-folder="${esc(f)}" title="Re-scan">&#x21BB;</button>
        <button class="folder-btn" data-action="open" data-folder="${esc(f)}" title="Open">&#x1F4C2;</button>
        <button class="folder-btn danger" data-action="remove" data-folder="${esc(f)}" title="Remove">&times;</button>
      </div>
    </div>
  `).join('');
  foldersList.querySelectorAll('.folder-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const folder = btn.dataset.folder, action = btn.dataset.action;
      if (action === 'remove') { await window.api.removeFolder(folder); renderFolders(); refreshAll(); showToast('Folder removed'); }
      else if (action === 'rescan') { foldersPanel.style.display = 'none'; scanOverlay.style.display = 'flex'; const r = await window.api.rescanFolder(folder); scanOverlay.style.display = 'none'; showToast(r.added > 0 ? `Found ${r.added} new` : 'No new songs'); refreshAll(); }
      else if (action === 'open') { window.api.openFolder(folder + '\\.'); }
    });
  });
}

$('#btn-close-modal').addEventListener('click', () => { lyricsModal.style.display = 'none'; });
$('#modal-backdrop').addEventListener('click', () => { lyricsModal.style.display = 'none'; });
$('#btn-cancel-lyrics').addEventListener('click', () => { lyricsModal.style.display = 'none'; });
$('#btn-save-lyrics').addEventListener('click', async () => {
  if (!currentModalSongId) return;
  const ok = await window.api.saveSongLyrics(currentModalSongId, lyricsEditor.value);
  if (ok) { showToast('Lyrics saved'); lyricsModal.style.display = 'none'; refreshAll(); }
});

async function openLyricsModal(song) {
  currentModalSongId = song.id;
  $('#modal-title').textContent = song.title;
  $('#modal-artist').textContent = `${song.artist}${song.album ? ' — ' + song.album : ''}`;
  const lyrics = await window.api.getSongLyrics(song.id);
  lyricsEditor.value = lyrics || '';
  lyricsModal.style.display = 'block';
  lyricsEditor.focus();
}

let updateBatch = [];
let updateRAF = null;

window.api.onSongUpdate((song) => {
  songs.set(song.id, song);
  updateBatch.push(song.id);
  if (!updateRAF) updateRAF = requestAnimationFrame(flushUpdates);
  updateMiniPlayer(song);
});

function flushUpdates() {
  updateRAF = null;
  updateFilteredCache();
  const scrollTop = songList.scrollTop, viewportH = songList.clientHeight;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(filteredCache.length, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN);
  const visibleIds = new Set();
  for (let i = startIdx; i < endIdx; i++) visibleIds.add(filteredCache[i].id);
  const ids = updateBatch; updateBatch = [];
  if (ids.some(id => visibleIds.has(id))) renderVirtual();
  else scrollContainer.style.height = `${filteredCache.length * ROW_HEIGHT}px`;
}

window.api.onQueueStats((stats) => { updateStats(stats); updateProgress(stats); if (stats.processing === 0 && stats.pending === 0 && isRunning) { isRunning = false; updateRunningState(); } });
window.api.onScanProgress((p) => { scanDetail.textContent = p.current.split(/[/\\]/).slice(-2).join('/'); scanCount.textContent = `${p.scanned} scanned${p.skippedExisting ? `, ${p.skippedExisting} skipped` : ''}`; });
window.api.onScanComplete(() => { scanOverlay.style.display = 'none'; refreshAll(); });
window.api.onSongRemoved((id) => { songs.delete(id); updateFilteredCache(); renderVirtual(); });
window.api.onQueueComplete((stats) => { showToast(`Done! ${stats.completed} found, ${stats.failed} failed`); launchConfetti(); updateMiniPlayer(); });
window.api.onWatchNewFiles((d) => { showToast(`Watch: ${d.added} new file(s)`); refreshAll(); });

function animateValue(el, from, to) {
  if (from === to) return;
  const duration = 400;
  const start = performance.now();
  const update = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(update);
    else {
      el.textContent = to;
      if (to > from) { el.classList.add('bounce'); setTimeout(() => el.classList.remove('bounce'), 400); }
    }
  };
  requestAnimationFrame(update);
}

function updateStats(stats) {
  const fields = ['total', 'pending', 'processing', 'completed', 'failed', 'skipped'];
  for (const f of fields) {
    const el = $(`#val-${f}`);
    const prev = prevStats[f] || 0;
    const next = stats[f] || 0;
    if (prev !== next) animateValue(el, prev, next);
  }
  prevStats = { ...stats };
}

function updateStatsImmediate(stats) {
  const fields = ['total', 'pending', 'processing', 'completed', 'failed', 'skipped'];
  for (const f of fields) $(`#val-${f}`).textContent = stats[f] || 0;
  prevStats = { ...stats };
}

function updateProgress(stats) {
  progressFill.style.width = `${stats.progress || 0}%`;
  progressText.textContent = `${stats.progress || 0}%`;
  progressEta.textContent = stats.eta ? `ETA: ${stats.eta}` : '';
}

function updateRunningState() {
  btnStart.style.display = isRunning ? 'none' : 'inline-flex';
  btnPause.style.display = isRunning ? 'inline-flex' : 'none';
}

function updateMiniPlayer(song) {
  let current = song && song.status === 'processing' ? song : null;
  if (!current) {
    for (const [, s] of songs) { if (s.status === 'processing') { current = s; break; } }
  }
  if (current) {
    miniPlayer.classList.add('active');
    miniPlayer.querySelector('.mini-player-title').textContent = current.title;
    miniPlayer.querySelector('.mini-player-artist').textContent = current.artist;
    const mpImg = miniPlayer.querySelector('.mini-player-cover img');
    const mpPlaceholder = miniPlayer.querySelector('.mini-player-cover-placeholder');
    mpPlaceholder.textContent = (current.artist[0] || current.title[0] || '?').toUpperCase();
    loadCover(current.filePath, current.id, mpImg, mpPlaceholder);
  } else {
    miniPlayer.classList.remove('active');
  }
}

async function loadCover(filePath, songId, imgEl, placeholderEl) {
  if (coverCache.has(songId)) {
    const url = coverCache.get(songId);
    if (url) { imgEl.src = url; imgEl.style.display = 'block'; placeholderEl.style.display = 'none'; }
    return;
  }
  window.api.getSongCover(filePath, songId).then(url => {
    coverCache.set(songId, url);
    if (url) {
      imgEl.src = url;
      imgEl.style.display = 'block';
      placeholderEl.style.display = 'none';
    }
  }).catch(() => { coverCache.set(songId, null); });
}

function setupHoverPreview(el, song) {
  el.addEventListener('mouseenter', (e) => {
    if (song.status !== 'completed' && song.status !== 'skipped') return;
    hoverTimeout = setTimeout(async () => {
      let lyrics = lyricsPreviewCache.get(song.id);
      if (lyrics === undefined) {
        lyrics = await window.api.getSongLyrics(song.id);
        lyricsPreviewCache.set(song.id, lyrics);
      }
      if (!lyrics) return;
      const lines = lyrics.split('\n').filter(l => !l.startsWith('[')).slice(0, 8);
      if (lines.length === 0) {
        const lrcLines = lyrics.split('\n').filter(l => l.match(/^\[\d/)).map(l => l.replace(/\[\d+:\d+\.\d+\]/, '').trim()).slice(0, 8);
        tooltip.textContent = lrcLines.join('\n') || 'No preview';
      } else {
        tooltip.textContent = lines.join('\n');
      }
      const rect = el.getBoundingClientRect();
      tooltip.style.left = `${Math.min(rect.left, window.innerWidth - 320)}px`;
      tooltip.style.top = `${rect.top - 10}px`;
      tooltip.style.transform = `translateY(-100%)`;
      tooltip.classList.add('visible');
    }, 600);
  });

  el.addEventListener('mouseleave', () => {
    clearTimeout(hoverTimeout);
    tooltip.classList.remove('visible');
  });
}

function updateFilteredCache() {
  let list = Array.from(songs.values());
  if (currentFilter !== 'all') list = list.filter(s => s.status === currentFilter);
  if (searchQuery) {
    list = list.filter(s =>
      s.title.toLowerCase().includes(searchQuery) || s.artist.toLowerCase().includes(searchQuery) ||
      s.album.toLowerCase().includes(searchQuery) || s.filePath.toLowerCase().includes(searchQuery)
    );
  }
  list.sort((a, b) => (SORT_ORDER[a.status] ?? 5) - (SORT_ORDER[b.status] ?? 5));
  filteredCache = list;
}

function renderVirtual() {
  if (filteredCache.length === 0) {
    songList.innerHTML = '';
    songList.appendChild(emptyState);
    emptyState.style.display = 'flex';
    emptyState.querySelector('h3').textContent = songs.size === 0 ? 'No songs yet' : 'No matches';
    emptyState.querySelector('p').textContent = songs.size === 0 ? 'Add a music folder or drag & drop folders here to start fetching lyrics' : 'Try changing the filter or search term';
    return;
  }

  emptyState.style.display = 'none';
  scrollContainer.style.height = `${filteredCache.length * ROW_HEIGHT}px`;

  const scrollTop = songList.scrollTop, viewportH = songList.clientHeight;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(filteredCache.length, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN);

  const fragment = document.createDocumentFragment();
  for (let i = startIdx; i < endIdx; i++) {
    const el = createSongElement(filteredCache[i]);
    el.style.position = 'absolute';
    el.style.top = `${i * ROW_HEIGHT}px`;
    el.style.left = '0';
    el.style.right = '0';
    fragment.appendChild(el);
  }

  scrollContent.innerHTML = '';
  scrollContent.appendChild(fragment);
  if (!songList.contains(scrollContainer)) { songList.innerHTML = ''; songList.appendChild(scrollContainer); }
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function createSongElement(song) {
  const div = document.createElement('div');
  div.className = `song-card${song.status === 'processing' ? ' is-processing' : ''}`;
  div.id = `song-${song.id}`;

  const initial = (song.artist[0] || song.title[0] || '?').toUpperCase();
  const badge = song.status === 'completed' ? `<span class="song-badge ${song.hasSyncedLyrics ? 'synced' : 'plain'}">${song.hasSyncedLyrics ? 'Synced' : 'Plain'}</span>` : '';
  const error = song.status === 'failed' && song.error ? `<span class="song-error" title="${esc(song.error)}">${esc(song.error)}</span>` : '';
  const dur = formatDuration(song.duration);

  div.innerHTML = `
    <div class="song-cover">
      <img style="display:none" />
      <div class="song-cover-placeholder">${initial}</div>
      <div class="song-status-dot ${song.status}"></div>
    </div>
    <div class="song-info">
      <div class="song-title">${esc(song.title)}</div>
      <div class="song-artist">${esc(song.artist)}</div>
      <div class="song-detail-row">
        <span class="song-album">${esc(song.album || '')}</span>
        ${dur ? `<span class="song-duration">${dur}</span>` : ''}
      </div>
      <div class="song-path" title="${esc(song.filePath)}">${esc(shortenPath(song.filePath))}</div>
    </div>
    <div class="song-meta">${badge}${error}</div>
    <button class="song-remove" title="Remove">&times;</button>
  `;

  const img = div.querySelector('.song-cover img');
  const placeholder = div.querySelector('.song-cover-placeholder');
  loadCover(song.filePath, song.id, img, placeholder);

  setupHoverPreview(div, song);

  div.addEventListener('click', (e) => {
    if (e.target.closest('.song-remove') || e.target.closest('.song-path')) return;
    openLyricsModal(song);
  });

  div.querySelector('.song-path').addEventListener('click', (e) => { e.stopPropagation(); window.api.openFolder(song.filePath); });

  div.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.api.showContextMenu({ id: song.id, filePath: song.filePath, lrcPath: song.lrcPath, artist: song.artist, title: song.title, status: song.status });
  });

  div.querySelector('.song-remove').addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.api.removeSong(song.id);
    songs.delete(song.id);
    updateFilteredCache(); renderVirtual();
  });

  return div;
}

function launchConfetti() {
  const ctx = confettiCanvas.getContext('2d');
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;

  const particles = [];
  const colors = ['#007aff', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#ffcc00', '#5856d6', '#30d158'];

  for (let i = 0; i < 150; i++) {
    particles.push({
      x: Math.random() * confettiCanvas.width,
      y: -20 - Math.random() * 200,
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 4,
      vy: 2 + Math.random() * 4,
      rot: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 10,
      opacity: 1
    });
  }

  let frame = 0;
  function animate() {
    frame++;
    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);

    let alive = false;
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05;
      p.rot += p.rotSpeed;
      if (frame > 60) p.opacity -= 0.01;

      if (p.opacity <= 0 || p.y > confettiCanvas.height + 20) continue;
      alive = true;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    if (alive) requestAnimationFrame(animate);
    else ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }

  requestAnimationFrame(animate);
}

async function refreshAll() {
  const data = await window.api.getAll();
  songs.clear();
  data.songs.forEach(s => songs.set(s.id, s));
  isRunning = data.isRunning;
  updateStatsImmediate(data.stats);
  updateProgress(data.stats);
  updateRunningState();
  updateFilteredCache();
  renderVirtual();
  updateMiniPlayer();
}

function shortenPath(p) {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts.length > 3 ? '\u2026/' + parts.slice(-3).join('/') : parts.join('/');
}

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

init();
