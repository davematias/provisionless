import sharp from "sharp";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const brand = dirname(fileURLToPath(import.meta.url));
const root = dirname(brand);
const png = join(brand, "png");

mkdirSync(png, { recursive: true });

/** Renders an SVG at exactly the requested pixel size so small icons stay crisp. */
async function render(source, out, width, height) {
  const metadata = await sharp(source).metadata();
  const density = 72 * Math.max(width / metadata.width, height / metadata.height);
  await sharp(source, { density })
    .resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(out);
}

async function renderHeight(source, out, height) {
  const metadata = await sharp(source).metadata();
  await render(source, out, Math.round((metadata.width / metadata.height) * height), height);
}

const markSizes = [16, 24, 32, 48, 64, 128, 256, 512];
const tileSizes = [16, 32, 48, 64, 128, 180, 192, 512];
const wordmarkHeights = [24, 32, 64];
const lockupHeights = [32, 64];

for (const size of markSizes) {
  await render(join(brand, "mark.svg"), join(png, `mark-${size}.png`), size, size);
  await render(join(brand, "mark-dark.svg"), join(png, `mark-dark-${size}.png`), size, size);
}

for (const size of tileSizes) {
  await render(join(brand, "mark-tile.svg"), join(png, `tile-${size}.png`), size, size);
}

for (const height of wordmarkHeights) {
  await renderHeight(join(brand, "wordmark.svg"), join(png, `wordmark-${height}.png`), height);
  await renderHeight(
    join(brand, "wordmark-dark.svg"),
    join(png, `wordmark-dark-${height}.png`),
    height,
  );
}

for (const height of lockupHeights) {
  await renderHeight(join(brand, "lockup.svg"), join(png, `lockup-${height}.png`), height);
  await renderHeight(
    join(brand, "lockup-dark.svg"),
    join(png, `lockup-dark-${height}.png`),
    height,
  );
}

await render(join(brand, "apple-icon.svg"), join(png, "apple-icon-180.png"), 180, 180);
await render(
  join(brand, "social-preview.svg"),
  join(png, "social-preview-1280x640.png"),
  1280,
  640,
);

const appIcons = [
  ["packages/admin/src/app/icon.svg", "mark-tile.svg"],
  ["packages/admin/src/app/apple-icon.png", "png/apple-icon-180.png"],
  ["packages/website/src/app/icon.svg", "mark-tile.svg"],
  ["packages/website/src/app/apple-icon.png", "png/apple-icon-180.png"],
  ["packages/website/public/social-preview.png", "png/social-preview-1280x640.png"],
];

for (const [destination, source] of appIcons) {
  const target = join(root, destination);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(brand, source), target);
}

console.log("Brand assets exported.");
