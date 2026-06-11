const fs = require('fs');
const { fetchLyrics } = require('./lyrics-fetcher');

class QueueManager {
  constructor(store, options = {}) {
    this.store = store;
    this.concurrency = options.concurrency || 3;
    this.onProgress = options.onProgress || (() => {});
    this.onStats = options.onStats || (() => {});
    this.onError = options.onError || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.isRunning = false;
    this.activeCount = 0;
    this.songs = new Map();
    this.processingTimes = [];

    const saved = store.get('songs', []);
    for (const song of saved) {
      this.songs.set(song.id, song);
    }
  }

  addSongs(songs, folderPath) {
    let added = 0;
    const folders = this.store.get('folders', []);

    if (!folders.includes(folderPath)) {
      folders.push(folderPath);
      this.store.set('folders', folders);
    }

    for (const song of songs) {
      if (!this.songs.has(song.id)) {
        this.songs.set(song.id, song);
        added++;
      }
    }

    this.save();
    this.emitStats();
    return added;
  }

  getAllSongs() {
    return Array.from(this.songs.values());
  }

  getExistingIds() {
    return new Set(this.songs.keys());
  }

  getStats() {
    const songs = this.getAllSongs();
    const stats = {
      total: songs.length,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      skipped: 0
    };
    for (const s of songs) {
      if (stats[s.status] !== undefined) stats[s.status]++;
    }

    const done = stats.completed + stats.failed + stats.skipped;
    stats.progress = stats.total > 0 ? Math.round((done / stats.total) * 100) : 0;
    stats.eta = this.calculateETA(stats);
    stats.isRunning = this.isRunning;

    return stats;
  }

  calculateETA(stats) {
    if (this.processingTimes.length === 0) return null;
    const remaining = stats.pending + stats.processing;
    if (remaining === 0) return null;
    const avg = this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length;
    const seconds = Math.ceil((remaining * avg) / (this.concurrency * 1000));
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`;
  }

  emitStats() {
    this.onStats(this.getStats());
  }

  resumeQueue() {
    let count = 0;
    for (const [, song] of this.songs) {
      if (song.status === 'processing') {
        song.status = 'pending';
        count++;
      }
    }
    if (count > 0) this.save();
    return count;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.emitStats();
    this.processNext();
  }

  pause() {
    this.isRunning = false;
    this.emitStats();
  }

  async processNext() {
    if (!this.isRunning) return;

    while (this.activeCount < this.concurrency) {
      const next = this.getNextPending();
      if (!next) break;

      this.activeCount++;
      next.status = 'processing';
      this.onProgress(next);

      this.processSong(next).then(() => {
        this.activeCount--;
        this.emitStats();
        if (this.isRunning) this.processNext();
      });
    }

    if (this.activeCount === 0 && !this.getNextPending()) {
      this.isRunning = false;
      this.emitStats();
      this.onComplete(this.getStats());
    }
  }

  getNextPending() {
    for (const [, song] of this.songs) {
      if (song.status === 'pending') return song;
    }
    return null;
  }

  async processSong(song) {
    const startTime = Date.now();
    try {
      const skipExisting = this.store.get('skipExisting', true);
      if (skipExisting && fs.existsSync(song.lrcPath)) {
        song.status = 'skipped';
        song.processedAt = Date.now();
        song.error = 'LRC already exists';
        this.onProgress(song);
        this.save();
        return;
      }

      const result = await fetchLyrics(song.artist, song.title, song.album, song.duration);

      if (!result) {
        song.status = 'failed';
        song.error = 'No lyrics found';
        song.processedAt = Date.now();
        this.onProgress(song);
        this.save();
        return;
      }

      const lrcContent = result.synced || this.formatPlainAsLrc(result.plain, song);
      fs.writeFileSync(song.lrcPath, lrcContent, 'utf-8');

      song.status = 'completed';
      song.error = null;
      song.processedAt = Date.now();
      song.lyricsSource = result.source;
      song.hasSyncedLyrics = !!result.synced;
      song.lyricsContent = lrcContent;
      this.onProgress(song);
      this.save();

      this.processingTimes.push(Date.now() - startTime);
      if (this.processingTimes.length > 50) this.processingTimes.shift();

    } catch (err) {
      song.status = 'failed';
      song.error = err.message;
      song.processedAt = Date.now();
      this.onProgress(song);
      this.onError(song, err);
      this.save();
    }
  }

  formatPlainAsLrc(plainLyrics, song) {
    if (!plainLyrics) return '';
    const lines = plainLyrics.split('\n');
    let lrc = `[ti:${song.title}]\n[ar:${song.artist}]\n`;
    if (song.album) lrc += `[al:${song.album}]\n`;
    lrc += '\n' + lines.join('\n');
    return lrc;
  }

  retryFailed() {
    let count = 0;
    for (const [, song] of this.songs) {
      if (song.status === 'failed') {
        song.status = 'pending';
        song.error = null;
        song.processedAt = null;
        count++;
      }
    }
    this.save();
    this.emitStats();
    if (this.isRunning) this.processNext();
    return count;
  }

  clearCompleted() {
    let count = 0;
    for (const [id, song] of this.songs) {
      if (song.status === 'completed' || song.status === 'skipped') {
        this.songs.delete(id);
        count++;
      }
    }
    this.save();
    this.emitStats();
    return count;
  }

  removeSong(songId) {
    const deleted = this.songs.delete(songId);
    if (deleted) { this.save(); this.emitStats(); }
    return deleted;
  }

  removeSongsFromFolder(folderPath) {
    for (const [id, song] of this.songs) {
      if (song.folder === folderPath) this.songs.delete(id);
    }
    this.save();
    this.emitStats();
  }

  skipExistingLyrics() {
    let count = 0;
    for (const [, song] of this.songs) {
      if (song.status === 'pending' && fs.existsSync(song.lrcPath)) {
        song.status = 'skipped';
        song.error = 'LRC already exists';
        song.processedAt = Date.now();
        count++;
      }
    }
    this.save();
    this.emitStats();
    return count;
  }

  getSongLyrics(songId) {
    const song = this.songs.get(songId);
    if (!song) return null;
    if (song.lyricsContent) return song.lyricsContent;
    try {
      if (fs.existsSync(song.lrcPath)) {
        return fs.readFileSync(song.lrcPath, 'utf-8');
      }
    } catch {}
    return null;
  }

  saveSongLyrics(songId, content) {
    const song = this.songs.get(songId);
    if (!song) return false;
    try {
      fs.writeFileSync(song.lrcPath, content, 'utf-8');
      song.lyricsContent = content;
      song.status = 'completed';
      song.hasSyncedLyrics = content.includes('[0');
      song.processedAt = Date.now();
      this.onProgress(song);
      this.save();
      return true;
    } catch { return false; }
  }

  batchRetry(ids) {
    let count = 0;
    for (const id of ids) {
      const song = this.songs.get(id);
      if (song && song.status === 'failed') {
        song.status = 'pending';
        song.error = null;
        song.processedAt = null;
        count++;
      }
    }
    this.save();
    this.emitStats();
    if (this.isRunning && count > 0) this.processNext();
    return count;
  }

  batchRemove(ids) {
    let count = 0;
    for (const id of ids) {
      if (this.songs.delete(id)) count++;
    }
    if (count > 0) { this.save(); this.emitStats(); }
    return count;
  }

  getDuplicates() {
    const seen = new Map();
    const dupes = [];
    for (const [, song] of this.songs) {
      const key = `${song.artist.toLowerCase()}::${song.title.toLowerCase()}`;
      if (seen.has(key)) {
        if (seen.get(key).length === 1) dupes.push(seen.get(key)[0]);
        dupes.push({ id: song.id, artist: song.artist, title: song.title, filePath: song.filePath });
        seen.get(key).push(song.id);
      } else {
        seen.set(key, [{ id: song.id, artist: song.artist, title: song.title, filePath: song.filePath }]);
      }
    }
    return dupes;
  }

  getDetailedStats() {
    const songs = this.getAllSongs();
    let synced = 0, plain = 0, totalTime = 0, processedCount = 0;
    const sources = {};
    const errors = {};
    for (const s of songs) {
      if (s.status === 'completed') {
        if (s.hasSyncedLyrics) synced++; else plain++;
        if (s.lyricsSource) sources[s.lyricsSource] = (sources[s.lyricsSource] || 0) + 1;
      }
      if (s.status === 'failed' && s.error) {
        errors[s.error] = (errors[s.error] || 0) + 1;
      }
      if (s.processedAt && s.status !== 'pending') {
        processedCount++;
      }
    }
    if (this.processingTimes.length > 0) {
      totalTime = this.processingTimes.reduce((a, b) => a + b, 0);
    }
    const base = this.getStats();
    return {
      ...base,
      synced,
      plain,
      avgTime: this.processingTimes.length > 0 ? Math.round(totalTime / this.processingTimes.length) : 0,
      sources,
      errors,
      successRate: base.total > 0 ? Math.round(((base.completed + base.skipped) / base.total) * 100) : 0
    };
  }

  save() {
    this.store.set('songs', Array.from(this.songs.values()));
  }
}

module.exports = { QueueManager };
