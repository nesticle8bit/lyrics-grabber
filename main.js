const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { QueueManager } = require('./lib/queue-manager');
const { scanFolder, AUDIO_EXTENSIONS } = require('./lib/scanner');
const { Store } = require('./lib/store');
const { initCache, getCacheStats, clearCache } = require('./lib/lyrics-fetcher');

let mainWindow;
let queueManager;
let store;
let tray = null;
let watchers = new Map();
let isQuitting = false;

const coverCache = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 350,
    title: 'Lyrics Grabber',
    icon: path.join(__dirname, 'src', 'icon.png'),
    backgroundColor: '#f2f2f7',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('src/index.html');
  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'src', 'icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Lyrics Grabber', click: () => { mainWindow.show(); mainWindow.focus(); }},
    { type: 'separator' },
    { label: 'Start Queue', click: () => { queueManager.start(); sendToRenderer('queue:stats', queueManager.getStats()); }},
    { label: 'Pause Queue', click: () => { queueManager.pause(); sendToRenderer('queue:stats', queueManager.getStats()); }},
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); }}
  ]);

  tray.setToolTip('Lyrics Grabber');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function startWatching(folderPath) {
  if (watchers.has(folderPath)) return;

  try {
    const watcher = fs.watch(folderPath, { recursive: true }, async (eventType, filename) => {
      if (!filename) return;
      const ext = path.extname(filename).toLowerCase();
      if (!AUDIO_EXTENSIONS.has(ext)) return;

      setTimeout(async () => {
        const fullPath = path.join(folderPath, filename);
        if (!fs.existsSync(fullPath)) return;

        try {
          const result = await scanFolder(folderPath, null, queueManager.getExistingIds());
          if (result.songs.length > 0) {
            const added = queueManager.addSongs(result.songs, folderPath);
            if (added > 0) {
              sendToRenderer('watch:new-files', { folder: folderPath, added });
              sendToRenderer('queue:stats', queueManager.getStats());
            }
          }
        } catch {}
      }, 2000);
    });

    watchers.set(folderPath, watcher);
  } catch {}
}

function stopWatching(folderPath) {
  const watcher = watchers.get(folderPath);
  if (watcher) {
    watcher.close();
    watchers.delete(folderPath);
  }
}

function stopAllWatchers() {
  for (const [, watcher] of watchers) watcher.close();
  watchers.clear();
}

app.whenReady().then(() => {
  store = new Store(path.join(app.getPath('userData'), 'lyrics-data.json'));
  initCache(app.getPath('userData'));

  queueManager = new QueueManager(store, {
    concurrency: 3,
    onProgress: (song) => sendToRenderer('song:update', song),
    onStats: (stats) => sendToRenderer('queue:stats', stats),
    onError: (song, error) => sendToRenderer('song:error', { id: song.id, error: error.message }),
    onComplete: (stats) => {
      sendToRenderer('queue:complete', stats);
      if (Notification.isSupported()) {
        new Notification({
          title: 'Lyrics Grabber',
          body: `Done! ${stats.completed} lyrics found, ${stats.failed} failed.`
        }).show();
      }
    }
  });

  const pendingCount = queueManager.resumeQueue();
  if (pendingCount > 0) console.log(`Resumed ${pendingCount} pending songs`);

  const folders = store.get('folders', []);
  for (const f of folders) startWatching(f);

  setupIPC();
  createWindow();
  createTray();
});

function setupIPC() {
  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'multiSelections']
    });
    if (result.canceled) return null;
    return result.filePaths;
  });

  ipcMain.handle('folder:add', async (_, folderPath) => {
    sendToRenderer('scan:start', folderPath);
    try {
      const existingIds = queueManager.getExistingIds();
      const result = await scanFolder(folderPath, (progress) => {
        sendToRenderer('scan:progress', progress);
      }, existingIds);

      const added = queueManager.addSongs(result.songs, folderPath);
      startWatching(folderPath);
      sendToRenderer('scan:complete', {
        folder: folderPath,
        added,
        total: result.songs.length,
        skipped: result.skippedExisting
      });
      return { added, total: result.songs.length, skipped: result.skippedExisting };
    } catch (err) {
      sendToRenderer('scan:error', { folder: folderPath, error: err.message });
      throw err;
    }
  });

  ipcMain.handle('folder:rescan', async (_, folderPath) => {
    sendToRenderer('scan:start', folderPath);
    try {
      const existingIds = queueManager.getExistingIds();
      const result = await scanFolder(folderPath, (progress) => {
        sendToRenderer('scan:progress', progress);
      }, existingIds);

      const added = queueManager.addSongs(result.songs, folderPath);
      sendToRenderer('scan:complete', {
        folder: folderPath,
        added,
        total: result.songs.length,
        skipped: result.skippedExisting,
        isRescan: true
      });
      return { added, total: result.songs.length };
    } catch (err) {
      sendToRenderer('scan:error', { folder: folderPath, error: err.message });
      throw err;
    }
  });

  ipcMain.handle('folder:rescan-all', async () => {
    const folders = store.get('folders', []);
    let totalAdded = 0;
    for (const folder of folders) {
      if (!fs.existsSync(folder)) continue;
      sendToRenderer('scan:start', folder);
      const existingIds = queueManager.getExistingIds();
      const result = await scanFolder(folder, (progress) => {
        sendToRenderer('scan:progress', progress);
      }, existingIds);
      const added = queueManager.addSongs(result.songs, folder);
      totalAdded += added;
      sendToRenderer('scan:complete', { folder, added, total: result.songs.length, skipped: result.skippedExisting });
    }
    return totalAdded;
  });

  ipcMain.handle('queue:start', () => queueManager.start());
  ipcMain.handle('queue:pause', () => queueManager.pause());
  ipcMain.handle('queue:retry-failed', () => queueManager.retryFailed());
  ipcMain.handle('queue:clear-completed', () => queueManager.clearCompleted());

  ipcMain.handle('queue:get-all', () => ({
    songs: queueManager.getAllSongs(),
    stats: queueManager.getStats(),
    folders: store.get('folders', []),
    isRunning: queueManager.isRunning
  }));

  ipcMain.handle('queue:remove-song', (_, songId) => queueManager.removeSong(songId));

  ipcMain.handle('folder:remove', (_, folderPath) => {
    queueManager.removeSongsFromFolder(folderPath);
    stopWatching(folderPath);
    const folders = store.get('folders', []);
    store.set('folders', folders.filter(f => f !== folderPath));
  });

  ipcMain.handle('queue:skip-with-lyrics', () => queueManager.skipExistingLyrics());

  ipcMain.handle('shell:open-folder', (_, filePath) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('song:get-lyrics', (_, songId) => queueManager.getSongLyrics(songId));

  ipcMain.handle('song:save-lyrics', (_, songId, content) => queueManager.saveSongLyrics(songId, content));

  ipcMain.handle('cache:stats', () => getCacheStats());
  ipcMain.handle('cache:clear', () => clearCache());

  ipcMain.handle('song:get-cover', async (_, filePath, songId) => {
    if (coverCache.has(songId)) return coverCache.get(songId);
    try {
      const mm = await import('music-metadata');
      const metadata = await mm.parseFile(filePath, { duration: false, skipCovers: false });
      const pic = metadata.common.picture?.[0];
      if (pic) {
        const dataUrl = `data:${pic.format};base64,${Buffer.from(pic.data).toString('base64')}`;
        coverCache.set(songId, dataUrl);
        return dataUrl;
      }
    } catch {}
    coverCache.set(songId, null);
    return null;
  });

  ipcMain.handle('theme:set', (_, theme) => store.set('theme', theme));
  ipcMain.handle('theme:get', () => store.get('theme', 'light'));

  ipcMain.handle('context-menu:song', (_, songData) => {
    const menu = Menu.buildFromTemplate([
      { label: 'Open in Explorer', click: () => shell.showItemInFolder(songData.filePath) },
      { label: 'Open LRC file', enabled: !!songData.lrcPath && fs.existsSync(songData.lrcPath),
        click: () => shell.openPath(songData.lrcPath) },
      { type: 'separator' },
      { label: 'Retry', enabled: songData.status === 'failed',
        click: () => {
          const song = queueManager.songs.get(songData.id);
          if (song) { song.status = 'pending'; song.error = null; queueManager.save(); queueManager.emitStats(); sendToRenderer('song:update', song); if (queueManager.isRunning) queueManager.processNext(); }
        }},
      { label: 'Copy Artist - Title', click: () => {
          const { clipboard } = require('electron');
          clipboard.writeText(`${songData.artist} - ${songData.title}`);
        }},
      { type: 'separator' },
      { label: 'Remove from Queue', click: () => {
          queueManager.removeSong(songData.id);
          sendToRenderer('song:removed', songData.id);
        }}
    ]);
    menu.popup({ window: mainWindow });
  });

  ipcMain.handle('drop:folders', async (_, paths) => {
    const results = [];
    for (const p of paths) {
      try {
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
          sendToRenderer('scan:start', p);
          const existingIds = queueManager.getExistingIds();
          const result = await scanFolder(p, (progress) => {
            sendToRenderer('scan:progress', progress);
          }, existingIds);
          const added = queueManager.addSongs(result.songs, p);
          startWatching(p);
          sendToRenderer('scan:complete', { folder: p, added, total: result.songs.length, skipped: result.skippedExisting });
          results.push({ folder: p, added, total: result.songs.length });
        }
      } catch {}
    }
    return results;
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  queueManager.pause();
  queueManager.save();
  stopAllWatchers();
});

app.on('window-all-closed', () => {
});

app.on('activate', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
