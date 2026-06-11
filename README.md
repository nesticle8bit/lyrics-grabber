# Lyrics Grabber v1.0.1

<img width="969" height="616" alt="image" src="https://github.com/user-attachments/assets/94f76955-633a-49d9-ab69-04fc00d1bf14" />

Automatic synchronized lyrics fetcher for your music library. Built for [Navidrome](https://www.navidrome.org/) / [Feishin](https://github.com/jeffvli/feishin) users who want `.lrc` files alongside their audio files — no manual work required.

## Features

- **Batch lyrics fetching** — Scan entire folders and fetch synchronized lyrics for all supported audio files automatically
- **Synchronized LRC generation** — Creates timestamped `.lrc` files next to your music files, compatible with most music players
- **Smart matching** — Dual-search strategy (exact metadata match + normalized fallback) with duration-based scoring for accurate results
- **Live folder monitoring** — Watches your folders for new additions and processes them automatically
- **Drag & drop** — Drop folders directly into the app to start scanning
- **Queue management** — Real-time progress tracking with ETA, pause/resume, and concurrency control
- **Manual lyrics editor** — Edit or add lyrics manually when automatic fetching doesn't find a match
- **Cover art display** — Extracts and shows album artwork from audio metadata
- **Light & dark themes** — Toggle between themes with persistent preference
- **System tray** — Minimize to tray with quick controls
- **Virtual scrolling** — Handles large libraries (10,000+ files) without performance issues

## Supported Audio Formats

`MP3` `FLAC` `OGG` `M4A` `WAV` `WMA` `AAC` `Opus` `APE` `WV` `DSF` `DFF`

## Installation

### From Release

Download the latest installer or portable version from [Releases](../../releases).

- **Installer** (`.exe`) — One-click install with desktop & start menu shortcuts
- **Portable** (`.exe`) — No installation needed, run from anywhere

### From Source

```bash
# Clone the repository
git clone https://github.com/nesticle8bit/lyrics-grabber.git
cd lyrics-grabber

# Install dependencies
npm install

# Run in development mode
npm run dev

# Run in production mode
npm start
```

### Build

```bash
# Build both installer and portable
npm run build

# Build only installer
npm run build:installer

# Build only portable
npm run build:portable
```

Output goes to the `dist/` directory.

## How It Works

1. **Add folders** containing your music files (drag & drop or browse)
2. The app scans for supported audio files and extracts metadata (artist, title, album, duration)
3. For each file, it queries the [LRCLIB](https://lrclib.net/) API for synchronized lyrics
4. Matching lyrics are saved as `.lrc` files alongside the original audio files
5. Files are cached to avoid redundant API calls on subsequent runs

## Project Structure

```
lyrics-grabber/
├── main.js              # Electron main process
├── preload.js           # Secure IPC bridge
├── lib/
│   ├── lyrics-fetcher.js  # LRCLIB API integration & caching
│   ├── queue-manager.js   # Song processing queue & state
│   ├── scanner.js         # Folder scanning & metadata extraction
│   └── store.js           # JSON persistence layer
├── src/
│   ├── index.html       # App UI
│   ├── renderer.js      # Frontend logic & virtual scrolling
│   ├── styles.css       # Theming & responsive design
│   └── icon.png         # App icon
├── build/
│   └── icon.ico         # Windows build icon
└── scripts/
    └── gen-icon.js      # PNG to ICO converter
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | [Electron](https://www.electronjs.org/) |
| Frontend | Vanilla JavaScript + CSS Custom Properties |
| Metadata | [music-metadata](https://github.com/borewit/music-metadata) |
| Storage | [electron-store](https://github.com/sindresorhus/electron-store) |
| Lyrics API | [LRCLIB](https://lrclib.net/) |
| Build | [electron-builder](https://www.electron.build/) |
| Typography | [DM Sans](https://fonts.google.com/specimen/DM+Sans) + [JetBrains Mono](https://www.jetbrains.com/lp/mono/) |

## Acknowledgements

This project exists thanks to the following open-source projects, APIs, and resources:

- **[Electron](https://www.electronjs.org/)** — Cross-platform desktop app framework that makes this possible
- **[LRCLIB](https://lrclib.net/)** — Free, open-source synchronized lyrics API powering all lyrics lookups
- **[music-metadata](https://github.com/borewit/music-metadata)** by Borewit — Robust audio metadata parser supporting 12+ formats
- **[electron-store](https://github.com/sindresorhus/electron-store)** by Sindre Sorhus — Simple, persistent JSON storage for Electron apps
- **[electron-builder](https://www.electron.build/)** — Packaging and distribution tooling for Windows builds
- **[DM Sans](https://fonts.google.com/specimen/DM+Sans)** by Colophon Foundry — Clean geometric typeface via Google Fonts
- **[JetBrains Mono](https://www.jetbrains.com/lp/mono/)** by JetBrains — Monospace font designed for developers
- **[Navidrome](https://www.navidrome.org/)** — Self-hosted music server that inspired this project
- **[Feishin](https://github.com/jeffvli/feishin)** — Modern music player client for Navidrome/Jellyfin

---

Made with care for music lovers who like their lyrics synced.
