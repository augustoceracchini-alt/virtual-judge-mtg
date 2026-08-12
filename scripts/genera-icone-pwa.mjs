import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "../public");

// Colori del tema Magic
const DARK_BG = "#17161a";
const GOLD = "#d4af37";
const CREAM = "#f1ece1";

async function createIcon(size, isMaskable) {
  const padding = Math.round(size * 0.1);
  const innerSize = size - padding * 2;

  // Crea un SVG semplice: sfondo scuro, bordo dorato, testo "VJ" in cream
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${GOLD};stop-opacity:1" />
          <stop offset="100%" style="stop-color:#b8860b;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" fill="${DARK_BG}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${innerSize / 2}" fill="none" stroke="url(#grad)" stroke-width="${Math.round(size * 0.02)}"/>
      <text x="${size / 2}" y="${size / 2 + Math.round(size * 0.08)}" font-family="serif" font-size="${Math.round(size * 0.4)}" font-weight="bold" fill="${CREAM}" text-anchor="middle" dominant-baseline="middle">VJ</text>
    </svg>
  `;

  const buffer = Buffer.from(svg);
  const filename = isMaskable
    ? `icon-${size}-maskable.png`
    : `icon-${size}.png`;
  const filepath = path.join(publicDir, filename);

  await sharp(buffer).png().toFile(filepath);
  console.log(`✓ Creato ${filename}`);
}

async function createScreenshot(width, height) {
  // Screenshot semplice: tema Magic con testo placeholder
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="noise" x="0" y="0" width="100" height="100" patternUnits="userSpaceOnUse">
          <rect width="100" height="100" fill="${DARK_BG}"/>
          <circle cx="10" cy="10" r="1" fill="${GOLD}" opacity="0.1"/>
          <circle cx="40" cy="50" r="1" fill="${GOLD}" opacity="0.1"/>
          <circle cx="70" cy="30" r="1" fill="${GOLD}" opacity="0.1"/>
        </pattern>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#noise)"/>
      <rect width="${width}" height="${Math.round(height * 0.15)}" fill="${DARK_BG}" opacity="0.9"/>
      <text x="${Math.round(width * 0.5)}" y="${Math.round(height * 0.08)}" font-family="serif" font-size="${Math.round(width * 0.04)}" font-weight="bold" fill="${GOLD}" text-anchor="middle">Virtual Judge MTG</text>
      <circle cx="${Math.round(width * 0.5)}" cy="${Math.round(height * 0.5)}" r="${Math.round(Math.min(width, height) * 0.15)}" fill="none" stroke="${GOLD}" stroke-width="2"/>
      <text x="${Math.round(width * 0.5)}" y="${Math.round(height * 0.5)}" font-family="serif" font-size="${Math.round(width * 0.06)}" font-weight="bold" fill="${CREAM}" text-anchor="middle" dominant-baseline="middle">VJ</text>
    </svg>
  `;

  const buffer = Buffer.from(svg);
  const filename = `screenshot-${width}.png`;
  const filepath = path.join(publicDir, filename);

  await sharp(buffer).png().toFile(filepath);
  console.log(`✓ Creato ${filename}`);
}

async function main() {
  try {
    console.log("Generazione icone PWA e screenshot...\n");

    // Icone
    await createIcon(192, false);
    await createIcon(192, true);
    await createIcon(512, false);
    await createIcon(512, true);

    // Screenshot
    await createScreenshot(540, 720);
    await createScreenshot(1280, 720);

    console.log("\n✓ Tutti i file PWA generati con successo!");
  } catch (err) {
    console.error("Errore durante la generazione:", err);
    process.exit(1);
  }
}

main();
