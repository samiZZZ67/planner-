const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const rootDir = path.resolve(__dirname, '..');
const sourceIcon = path.join(rootDir, 'public', 'icons', 'icon.png');
const iconsDir = path.join(rootDir, 'public', 'icons');
const publicDir = path.join(rootDir, 'public');
const appDir = path.join(rootDir, 'src', 'app');

async function generate() {
  if (!fs.existsSync(sourceIcon)) {
    console.error('Source icon not found at:', sourceIcon);
    process.exit(1);
  }

  console.log('Generating optimized icons from:', sourceIcon);

  // 1. 192x192 PNG
  await sharp(sourceIcon)
    .resize(192, 192)
    .png({ quality: 95 })
    .toFile(path.join(iconsDir, 'icon-192.png'));
  console.log('✓ Created icon-192.png');

  // 2. 512x512 PNG
  await sharp(sourceIcon)
    .resize(512, 512)
    .png({ quality: 95 })
    .toFile(path.join(iconsDir, 'icon-512.png'));
  console.log('✓ Created icon-512.png');

  // 3. 512x512 Maskable PNG (with 10% padding so round avatar isn't cropped by Android masks)
  const innerSize = Math.round(512 * 0.85); // 435px
  const innerBuf = await sharp(sourceIcon)
    .resize(innerSize, innerSize)
    .toBuffer();

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 9, g: 10, b: 16, alpha: 1 }
    }
  })
    .composite([{ input: innerBuf, gravity: 'center' }])
    .png()
    .toFile(path.join(iconsDir, 'icon-maskable-512.png'));
  console.log('✓ Created icon-maskable-512.png');

  // 4. Apple Touch Icon (180x180)
  await sharp(sourceIcon)
    .resize(180, 180)
    .png({ quality: 95 })
    .toFile(path.join(iconsDir, 'apple-touch-icon.png'));
  console.log('✓ Created apple-touch-icon.png');

  // 5. Favicon PNG (32x32 & 48x48)
  const fav32 = await sharp(sourceIcon)
    .resize(32, 32)
    .png()
    .toFile(path.join(publicDir, 'favicon.png'));
  console.log('✓ Created public/favicon.png');

  // Also copy/generate favicon.ico for public and app
  // Sharp can write a PNG buffer as .ico for modern browsers
  const favIcoBuf = await sharp(sourceIcon)
    .resize(48, 48)
    .png()
    .toBuffer();

  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), favIcoBuf);
  fs.writeFileSync(path.join(appDir, 'favicon.ico'), favIcoBuf);
  fs.writeFileSync(path.join(appDir, 'icon.png'), await sharp(sourceIcon).resize(64, 64).png().toBuffer());
  console.log('✓ Created favicon.ico and app/icon.png');

  console.log('All icons generated successfully!');
}

generate().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
