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
let selectedSongs = new Set();
let focusedIndex = -1;
let audioElement = null;

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
const batchToolbar = $('#batch-toolbar');
const statsModal = $('#stats-modal');

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
  setupBatchToolbar();
  setupStatsModal();
  setupAudioPlayer();
  setupExportImport();
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
      if (lyricsModal.style.display !== 'none') { stopAudio(); lyricsModal.style.display = 'none'; return; }
      if (statsModal.style.display !== 'none') { statsModal.style.display = 'none'; return; }
      if (settingsPanel.style.display !== 'none') { settingsPanel.style.display = 'none'; return; }
      if (foldersPanel.style.display !== 'none') { foldersPanel.style.display = 'none'; return; }
      if (selectedSongs.size > 0) { selectedSongs.clear(); updateBatchToolbar(); renderVirtual(); return; }
      if (document.activeElement === searchInput) { searchInput.blur(); return; }
    }
    if (e.key === ' ' && document.activeElement !== searchInput && document.activeElement !== lyricsEditor) {
      e.preventDefault();
      if (isRunning) { window.api.pauseQueue(); isRunning = false; } else { window.api.startQueue(); isRunning = true; }
      updateRunningState();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') { e.preventDefault(); rescanAll(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'a' && document.activeElement !== searchInput && document.activeElement !== lyricsEditor) {
      e.preventDefault();
      filteredCache.forEach(s => selectedSongs.add(s.id));
      updateBatchToolbar();
      renderVirtual();
    }

    if (document.activeElement === searchInput || document.activeElement === lyricsEditor) return;
    if (lyricsModal.style.display !== 'none' || statsModal.style.display !== 'none') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (focusedIndex < filteredCache.length - 1) {
        focusedIndex++;
        scrollToFocused();
        renderVirtual();
      }
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (focusedIndex > 0) {
        focusedIndex--;
        scrollToFocused();
        renderVirtual();
      }
    }
    if (e.key === 'Enter' && focusedIndex >= 0 && focusedIndex < filteredCache.length) {
      e.preventDefault();
      openLyricsModal(filteredCache[focusedIndex]);
    }
    if (e.key === 'Delete' && focusedIndex >= 0 && focusedIndex < filteredCache.length) {
      e.preventDefault();
      const song = filteredCache[focusedIndex];
      window.api.removeSong(song.id);
      songs.delete(song.id);
      selectedSongs.delete(song.id);
      if (focusedIndex >= filteredCache.length - 1) focusedIndex = Math.max(0, filteredCache.length - 2);
      updateFilteredCache();
      renderVirtual();
      updateBatchToolbar();
    }
  });
}

function scrollToFocused() {
  const scrollTop = songList.scrollTop;
  const viewportH = songList.clientHeight;
  const itemTop = focusedIndex * ROW_HEIGHT;
  const itemBottom = itemTop + ROW_HEIGHT;
  if (itemTop < scrollTop) songList.scrollTop = itemTop;
  else if (itemBottom > scrollTop + viewportH) songList.scrollTop = itemBottom - viewportH;
}

function setupBatchToolbar() {
  $('#btn-batch-retry').addEventListener('click', async () => {
    const ids = Array.from(selectedSongs);
    const count = await window.api.batchRetry(ids);
    if (count > 0) showToast(`Retrying ${count} songs`);
    selectedSongs.clear();
    updateBatchToolbar();
    refreshAll();
  });
  $('#btn-batch-remove').addEventListener('click', async () => {
    const ids = Array.from(selectedSongs);
    const count = await window.api.batchRemove(ids);
    ids.forEach(id => songs.delete(id));
    selectedSongs.clear();
    updateBatchToolbar();
    updateFilteredCache();
    renderVirtual();
    if (count > 0) showToast(`Removed ${count} songs`);
  });
  $('#btn-batch-clear').addEventListener('click', () => {
    selectedSongs.clear();
    updateBatchToolbar();
    renderVirtual();
  });
}

function updateBatchToolbar() {
  if (selectedSongs.size > 0) {
    batchToolbar.style.display = 'flex';
    $('#batch-count').textContent = `${selectedSongs.size} selected`;
  } else {
    batchToolbar.style.display = 'none';
  }
}

function setupStatsModal() {
  $('#btn-stats').addEventListener('click', async () => {
    const stats = await window.api.getDetailedStats();
    const dupes = await window.api.getDuplicates();
    renderStatsModal(stats, dupes);
    statsModal.style.display = 'block';
  });
  $('#btn-close-stats').addEventListener('click', () => { statsModal.style.display = 'none'; });
  $('#stats-backdrop').addEventListener('click', () => { statsModal.style.display = 'none'; });
}

function renderStatsModal(stats, dupes) {
  const dashboard = $('#stats-dashboard');
  const srcEntries = Object.entries(stats.sources).sort((a, b) => b[1] - a[1]);
  const errEntries = Object.entries(stats.errors).sort((a, b) => b[1] - a[1]).slice(0, 5);

  dashboard.innerHTML = `
    <div class="stats-grid">
      <div class="stats-card">
        <div class="stats-card-value">${stats.successRate}%</div>
        <div class="stats-card-label">Success Rate</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-value">${stats.synced}</div>
        <div class="stats-card-label">Synced Lyrics</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-value">${stats.plain}</div>
        <div class="stats-card-label">Plain Lyrics</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-value">${stats.avgTime ? (stats.avgTime / 1000).toFixed(1) + 's' : '-'}</div>
        <div class="stats-card-label">Avg Time</div>
      </div>
    </div>
    ${srcEntries.length > 0 ? `
      <div class="stats-section">
        <div class="stats-section-title">Sources</div>
        ${srcEntries.map(([src, count]) => `
          <div class="stats-bar-row">
            <span class="stats-bar-label">${esc(src)}</span>
            <div class="stats-bar-track"><div class="stats-bar-fill" style="width:${Math.round(count / stats.completed * 100)}%"></div></div>
            <span class="stats-bar-value">${count}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
    ${errEntries.length > 0 ? `
      <div class="stats-section">
        <div class="stats-section-title">Top Errors</div>
        ${errEntries.map(([err, count]) => `
          <div class="stats-bar-row">
            <span class="stats-bar-label error">${esc(err)}</span>
            <span class="stats-bar-value">${count}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
    ${dupes.length > 0 ? `
      <div class="stats-section">
        <div class="stats-section-title">Duplicates (${dupes.length})</div>
        ${dupes.slice(0, 10).map(d => `
          <div class="stats-dupe-row">
            <span>${esc(d.artist)} — ${esc(d.title)}</span>
            <span class="stats-dupe-path">${esc(shortenPath(d.filePath))}</span>
          </div>
        `).join('')}
        ${dupes.length > 10 ? `<div class="stats-dupe-more">...and ${dupes.length - 10} more</div>` : ''}
      </div>
    ` : ''}
  `;
}

function setupAudioPlayer() {
  audioElement = new Audio();
  const playBtn = $('#btn-audio-play');
  const iconPlay = playBtn.querySelector('.icon-play');
  const iconPause = playBtn.querySelector('.icon-pause-audio');
  const timeEl = $('#audio-time');
  const durationEl = $('#audio-duration');
  const progressBar = $('#audio-progress-bar');
  const progressFillEl = $('#audio-progress-fill');

  playBtn.addEventListener('click', () => {
    if (audioElement.paused) audioElement.play(); else audioElement.pause();
  });

  audioElement.addEventListener('play', () => { iconPlay.style.display = 'none'; iconPause.style.display = 'block'; });
  audioElement.addEventListener('pause', () => { iconPlay.style.display = 'block'; iconPause.style.display = 'none'; });
  audioElement.addEventListener('timeupdate', () => {
    timeEl.textContent = formatDuration(audioElement.currentTime);
    if (audioElement.duration) {
      progressFillEl.style.width = `${(audioElement.currentTime / audioElement.duration) * 100}%`;
    }
  });
  audioElement.addEventListener('loadedmetadata', () => {
    durationEl.textContent = formatDuration(audioElement.duration);
  });

  progressBar.addEventListener('click', (e) => {
    if (!audioElement.duration) return;
    const rect = progressBar.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audioElement.currentTime = ratio * audioElement.duration;
  });

  $('#btn-sync-stamp').addEventListener('click', () => {
    if (!audioElement.duration) return;
    const time = audioElement.currentTime;
    const min = Math.floor(time / 60);
    const sec = (time % 60).toFixed(2);
    const stamp = `[${String(min).padStart(2, '0')}:${sec.padStart(5, '0')}]`;

    const start = lyricsEditor.selectionStart;
    const val = lyricsEditor.value;
    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    const existing = val.substring(lineStart).match(/^\[\d{2}:\d{2}\.\d{2}\]/);
    if (existing) {
      lyricsEditor.value = val.substring(0, lineStart) + stamp + val.substring(lineStart + existing[0].length);
    } else {
      lyricsEditor.value = val.substring(0, lineStart) + stamp + val.substring(lineStart);
    }
    lyricsEditor.selectionStart = lyricsEditor.selectionEnd = lineStart + stamp.length;
    lyricsEditor.focus();
  });
}

function stopAudio() {
  if (audioElement) { audioElement.pause(); audioElement.src = ''; }
  $('#audio-player').style.display = 'none';
}

function setupExportImport() {
  $('#btn-export-lyrics').addEventListener('click', async () => {
    const count = await window.api.exportLyrics();
    if (count !== null) showToast(`Exported ${count} LRC files`);
  });
  $('#btn-import-lyrics').addEventListener('click', async () => {
    const count = await window.api.importLyrics();
    if (count !== null) {
      showToast(`Imported ${count} LRC files`);
      refreshAll();
    }
  });
}

$('#btn-add-folder').addEventListener('click', addFolders);
$('#btn-add-folder-panel').addEventListener('click', addFolders);

async function addFolders() {
  const folders = await window.api.selectFolder();
  if (!folders) return;
  scanOverlay.style.display = 'flex';
  let totalAdded = 0;
  for (const folder of folders) { try { const r = await window.api.addFolder(folder); totalAdded += r.added; } catch { } }
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
  try { const a = await window.api.rescanAll(); showToast(a > 0 ? `Found ${a} new songs` : 'No new songs found'); } catch { }
  scanOverlay.style.display = 'none';
  refreshAll();
}

searchInput.addEventListener('input', (e) => {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => { searchQuery = e.target.value.toLowerCase(); focusedIndex = -1; updateFilteredCache(); renderVirtual(); }, 150);
});

document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter = chip.dataset.filter;
    focusedIndex = -1;
    updateFilteredCache(); renderVirtual();
  });
});

const DARK_THEMES = ['dark', 'palenight', 'ocean', 'deepocean', 'material'];

$('#btn-theme').addEventListener('click', async () => {
  const current = document.body.getAttribute('data-theme');
  const isDark = DARK_THEMES.includes(current);
  const next = isDark ? 'light' : 'dark';
  document.body.setAttribute('data-theme', next);
  await window.api.setTheme(next);
  updateThemeGrid(next);
});

// Settings panel
const settingsPanel = $('#settings-panel');
$('#btn-settings').addEventListener('click', () => { settingsPanel.style.display = 'block'; loadSettings(); });
$('#btn-close-settings').addEventListener('click', () => { settingsPanel.style.display = 'none'; });
$('#settings-backdrop').addEventListener('click', () => { settingsPanel.style.display = 'none'; });

let currentSettings = {};

function updateThemeGrid(theme) {
  document.querySelectorAll('.theme-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.theme === theme);
  });
}

document.querySelectorAll('.theme-swatch').forEach(swatch => {
  swatch.addEventListener('click', async () => {
    const theme = swatch.dataset.theme;
    document.body.setAttribute('data-theme', theme);
    await window.api.setTheme(theme);
    updateThemeGrid(theme);
  });
});

async function loadSettings() {
  currentSettings = await window.api.getSettings();
  $('#concurrency-value').textContent = currentSettings.concurrency;
  $('#toggle-skip-existing').checked = currentSettings.skipExisting;
  $('#toggle-watch-folders').checked = currentSettings.watchFolders;
  $('#toggle-notifications').checked = currentSettings.notifications;
  $('#toggle-auto-start').checked = currentSettings.autoStart;

  const theme = document.body.getAttribute('data-theme');
  updateThemeGrid(theme);

  const cacheStats = await window.api.cacheStats();
  $('#cache-stats-text').textContent = `${cacheStats.entries} entries (${cacheStats.found} found, ${cacheStats.notFound} not found)`;
}

$('#concurrency-down').addEventListener('click', async () => {
  const val = Math.max(1, (currentSettings.concurrency || 3) - 1);
  currentSettings.concurrency = val;
  $('#concurrency-value').textContent = val;
  await window.api.setSettings({ concurrency: val });
});

$('#concurrency-up').addEventListener('click', async () => {
  const val = Math.min(10, (currentSettings.concurrency || 3) + 1);
  currentSettings.concurrency = val;
  $('#concurrency-value').textContent = val;
  await window.api.setSettings({ concurrency: val });
});

$('#toggle-skip-existing').addEventListener('change', async (e) => {
  currentSettings.skipExisting = e.target.checked;
  await window.api.setSettings({ skipExisting: e.target.checked });
});

$('#toggle-watch-folders').addEventListener('change', async (e) => {
  currentSettings.watchFolders = e.target.checked;
  await window.api.setSettings({ watchFolders: e.target.checked });
});

$('#toggle-notifications').addEventListener('change', async (e) => {
  currentSettings.notifications = e.target.checked;
  await window.api.setSettings({ notifications: e.target.checked });
});

$('#toggle-auto-start').addEventListener('change', async (e) => {
  currentSettings.autoStart = e.target.checked;
  await window.api.setSettings({ autoStart: e.target.checked });
});

$('#btn-clear-cache').addEventListener('click', async () => {
  await window.api.cacheClear();
  $('#cache-stats-text').textContent = '0 entries';
  showToast('Cache cleared');
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

$('#btn-close-modal').addEventListener('click', () => { stopAudio(); lyricsModal.style.display = 'none'; });
$('#modal-backdrop').addEventListener('click', () => { stopAudio(); lyricsModal.style.display = 'none'; });
$('#btn-cancel-lyrics').addEventListener('click', () => { stopAudio(); lyricsModal.style.display = 'none'; });
$('#btn-save-lyrics').addEventListener('click', async () => {
  if (!currentModalSongId) return;
  const ok = await window.api.saveSongLyrics(currentModalSongId, lyricsEditor.value);
  if (ok) { showToast('Lyrics saved'); stopAudio(); lyricsModal.style.display = 'none'; refreshAll(); }
});

async function openLyricsModal(song) {
  currentModalSongId = song.id;
  $('#modal-title').textContent = song.title;
  $('#modal-artist').textContent = `${song.artist}${song.album ? ' — ' + song.album : ''}`;
  const lyrics = await window.api.getSongLyrics(song.id);
  lyricsEditor.value = lyrics || '';
  lyricsModal.style.display = 'block';
  lyricsEditor.focus();

  const playerEl = $('#audio-player');
  try {
    const filePath = song.filePath.replace(/\\/g, '/');
    audioElement.src = `file:///${filePath}`;
    audioElement.load();
    playerEl.style.display = 'flex';
    $('#audio-time').textContent = '0:00';
    $('#audio-duration').textContent = formatDuration(song.duration);
    $('#audio-progress-fill').style.width = '0%';
    const iconPlay = $('#btn-audio-play .icon-play');
    const iconPause = $('#btn-audio-play .icon-pause-audio');
    iconPlay.style.display = 'block';
    iconPause.style.display = 'none';
  } catch {
    playerEl.style.display = 'none';
  }
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
window.api.onSongRemoved((id) => { songs.delete(id); selectedSongs.delete(id); updateFilteredCache(); renderVirtual(); updateBatchToolbar(); });
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
      s.album.toLowerCase().includes(searchQuery) || s.filePath.toLowerCase().includes(searchQuery) ||
      (s.lyricsContent && s.lyricsContent.toLowerCase().includes(searchQuery))
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
    const el = createSongElement(filteredCache[i], i);
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

function createSongElement(song, idx) {
  const div = document.createElement('div');
  const isSelected = selectedSongs.has(song.id);
  const isFocused = idx === focusedIndex;
  div.className = `song-card${song.status === 'processing' ? ' is-processing' : ''}${isSelected ? ' is-selected' : ''}${isFocused ? ' is-focused' : ''}`;
  div.id = `song-${song.id}`;

  const initial = (song.artist[0] || song.title[0] || '?').toUpperCase();
  const badge = song.status === 'completed' ? `<span class="song-badge ${song.hasSyncedLyrics ? 'synced' : 'plain'}">${song.hasSyncedLyrics ? 'Synced' : 'Plain'}</span>` : '';
  const error = song.status === 'failed' && song.error ? `<span class="song-error" title="${esc(song.error)}">${esc(song.error)}</span>` : '';
  const dur = formatDuration(song.duration);

  div.innerHTML = `
    <div class="song-select-box${isSelected ? ' checked' : ''}"></div>
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
    if (e.ctrlKey || e.metaKey || e.target.closest('.song-select-box')) {
      e.preventDefault();
      if (selectedSongs.has(song.id)) selectedSongs.delete(song.id); else selectedSongs.add(song.id);
      updateBatchToolbar();
      renderVirtual();
      return;
    }
    focusedIndex = idx;
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
    selectedSongs.delete(song.id);
    updateFilteredCache(); renderVirtual(); updateBatchToolbar();
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
  return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : parts.join('/');
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
