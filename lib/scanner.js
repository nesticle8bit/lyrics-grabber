const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.flac', '.ogg', '.m4a', '.wav', '.wma',
  '.aac', '.opus', '.ape', '.wv', '.dsf', '.dff'
]);

async function scanFolder(folderPath, onProgress, existingIds = new Set()) {
  const mm = await import('music-metadata');
  const songs = [];
  let scanned = 0;
  let skippedExisting = 0;

  async function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!AUDIO_EXTENSIONS.has(ext)) continue;

      const id = crypto.createHash('md5').update(fullPath).digest('hex').slice(0, 12);
      if (existingIds.has(id)) {
        skippedExisting++;
        continue;
      }

      scanned++;
      if (onProgress) {
        onProgress({ scanned, skippedExisting, current: fullPath });
      }

      try {
        const metadata = await mm.parseFile(fullPath, { duration: true, skipCovers: true });
        const artist = metadata.common.artist || '';
        const title = metadata.common.title || '';
        const album = metadata.common.album || '';
        const duration = metadata.format.duration || 0;

        if (!artist || !title) continue;

        const lrcPath = fullPath.replace(/\.[^.]+$/, '.lrc');

        songs.push({
          id,
          filePath: fullPath,
          fileName: entry.name,
          artist,
          title,
          album,
          duration: Math.round(duration),
          lrcPath,
          hasExistingLrc: fs.existsSync(lrcPath),
          status: 'pending',
          error: null,
          addedAt: Date.now(),
          processedAt: null,
          folder: folderPath
        });
      } catch {}
    }
  }

  await walk(folderPath);
  return { songs, scanned, skippedExisting };
}

module.exports = { scanFolder, AUDIO_EXTENSIONS };
