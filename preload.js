const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  addFolder: (path) => ipcRenderer.invoke('folder:add', path),
  removeFolder: (path) => ipcRenderer.invoke('folder:remove', path),
  rescanFolder: (path) => ipcRenderer.invoke('folder:rescan', path),
  rescanAll: () => ipcRenderer.invoke('folder:rescan-all'),
  dropFolders: (paths) => ipcRenderer.invoke('drop:folders', paths),

  startQueue: () => ipcRenderer.invoke('queue:start'),
  pauseQueue: () => ipcRenderer.invoke('queue:pause'),
  retryFailed: () => ipcRenderer.invoke('queue:retry-failed'),
  clearCompleted: () => ipcRenderer.invoke('queue:clear-completed'),
  getAll: () => ipcRenderer.invoke('queue:get-all'),
  removeSong: (id) => ipcRenderer.invoke('queue:remove-song', id),
  skipWithLyrics: () => ipcRenderer.invoke('queue:skip-with-lyrics'),

  openFolder: (filePath) => ipcRenderer.invoke('shell:open-folder', filePath),

  getSongLyrics: (id) => ipcRenderer.invoke('song:get-lyrics', id),
  saveSongLyrics: (id, content) => ipcRenderer.invoke('song:save-lyrics', id, content),
  getSongCover: (filePath, songId) => ipcRenderer.invoke('song:get-cover', filePath, songId),

  showContextMenu: (songData) => ipcRenderer.invoke('context-menu:song', songData),

  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  getTheme: () => ipcRenderer.invoke('theme:get'),

  cacheStats: () => ipcRenderer.invoke('cache:stats'),
  cacheClear: () => ipcRenderer.invoke('cache:clear'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),

  batchRetry: (ids) => ipcRenderer.invoke('queue:batch-retry', ids),
  batchRemove: (ids) => ipcRenderer.invoke('queue:batch-remove', ids),
  getDetailedStats: () => ipcRenderer.invoke('queue:detailed-stats'),
  getDuplicates: () => ipcRenderer.invoke('queue:duplicates'),
  exportLyrics: () => ipcRenderer.invoke('lyrics:export'),
  importLyrics: () => ipcRenderer.invoke('lyrics:import'),

  onSongUpdate: (cb) => ipcRenderer.on('song:update', (_, d) => cb(d)),
  onSongError: (cb) => ipcRenderer.on('song:error', (_, d) => cb(d)),
  onSongRemoved: (cb) => ipcRenderer.on('song:removed', (_, d) => cb(d)),
  onQueueStats: (cb) => ipcRenderer.on('queue:stats', (_, d) => cb(d)),
  onQueueComplete: (cb) => ipcRenderer.on('queue:complete', (_, d) => cb(d)),
  onScanStart: (cb) => ipcRenderer.on('scan:start', (_, d) => cb(d)),
  onScanProgress: (cb) => ipcRenderer.on('scan:progress', (_, d) => cb(d)),
  onScanComplete: (cb) => ipcRenderer.on('scan:complete', (_, d) => cb(d)),
  onScanError: (cb) => ipcRenderer.on('scan:error', (_, d) => cb(d)),
  onWatchNewFiles: (cb) => ipcRenderer.on('watch:new-files', (_, d) => cb(d))
});
