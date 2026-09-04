import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FONTS_DIR = path.resolve(__dirname, '../public/fonts');

const FONTS = [
  {
    name: 'Geist-Regular.ttf',
    url: 'https://raw.githubusercontent.com/vercel/geist-font/main/packages/next/fonts/geist-sans/Geist-Regular.ttf'
  },
  {
    name: 'Geist-Bold.ttf',
    url: 'https://raw.githubusercontent.com/vercel/geist-font/main/packages/next/fonts/geist-sans/Geist-Bold.ttf'
  },
  {
    name: 'GeistMono-Regular.ttf',
    url: 'https://raw.githubusercontent.com/vercel/geist-font/main/packages/next/fonts/geist-mono/GeistMono-Regular.ttf'
  },
  {
    name: 'GeistMono-Bold.ttf',
    url: 'https://raw.githubusercontent.com/vercel/geist-font/main/packages/next/fonts/geist-mono/GeistMono-Bold.ttf'
  }
];

// Fallbacks if the paths above change:
const ALTERNATE_FONTS = [
  {
    name: 'Geist-Regular.ttf',
    url: 'https://github.com/vercel/geist-font/raw/main/fonts/geist-sans/ttf/Geist-Regular.ttf'
  },
  {
    name: 'Geist-Bold.ttf',
    url: 'https://github.com/vercel/geist-font/raw/main/fonts/geist-sans/ttf/Geist-Bold.ttf'
  },
  {
    name: 'GeistMono-Regular.ttf',
    url: 'https://github.com/vercel/geist-font/raw/main/fonts/geist-mono/ttf/GeistMono-Regular.ttf'
  },
  {
    name: 'GeistMono-Bold.ttf',
    url: 'https://github.com/vercel/geist-font/raw/main/fonts/geist-mono/ttf/GeistMono-Bold.ttf'
  }
];

async function downloadFont(fontInfo) {
  const dest = path.join(FONTS_DIR, fontInfo.name);
  if (fs.existsSync(dest)) {
    console.log(`[SKIP] ${fontInfo.name} already exists.`);
    return;
  }

  console.log(`[DOWNLOAD] Fetching ${fontInfo.name}...`);
  let res = await fetch(fontInfo.url);
  
  if (!res.ok) {
    console.log(`[WARN] Failed to fetch ${fontInfo.name} from primary URL, trying alternate...`);
    const alt = ALTERNATE_FONTS.find(f => f.name === fontInfo.name);
    if (alt) {
      res = await fetch(alt.url);
    }
  }

  if (!res.ok) {
    throw new Error(`Failed to download ${fontInfo.name}: ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(arrayBuffer));
  console.log(`[OK] Saved ${fontInfo.name} to public/fonts/`);
}

async function main() {
  if (!fs.existsSync(FONTS_DIR)) {
    fs.mkdirSync(FONTS_DIR, { recursive: true });
  }

  for (const font of Object.values(FONTS)) {
    await downloadFont(font);
  }
  console.log('All fonts downloaded.');
}

main().catch(console.error);
