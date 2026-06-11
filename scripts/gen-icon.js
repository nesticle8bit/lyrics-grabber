let pngToIco;
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'icon.png');
const dst = path.join(__dirname, '..', 'build', 'icon.ico');

import('png-to-ico').then(mod => {
  pngToIco = mod.default || mod;
  return pngToIco(src);
}).then(buf => {
  fs.writeFileSync(dst, buf);
  console.log(`ICO written to ${dst} (${buf.length} bytes)`);
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
