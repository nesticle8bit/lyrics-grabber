const fs = require('fs');
const path = require('path');

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = {};
    this.saveTimeout = null;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(raw);
      }
    } catch (err) {
      console.error('Store load error:', err.message);
      this.data = {};
    }
  }

  get(key, defaultValue = undefined) {
    return key in this.data ? this.data[key] : defaultValue;
  }

  set(key, value) {
    this.data[key] = value;
    this.debouncedSave();
  }

  delete(key) {
    delete this.data[key];
    this.debouncedSave();
  }

  debouncedSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => this.save(), 500);
  }

  save() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Store save error:', err.message);
    }
  }
}

module.exports = { Store };
