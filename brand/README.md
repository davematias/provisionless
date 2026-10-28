# Provisionless brand

The Provisionless mark is an open box with a node inside: content without a server to provision.
The box opens to the right, toward the wordmark in the lockup.

Everything is monochrome so the identity sits comfortably next to the neutral design system.

## Files

| File                 | Purpose                                             |
| -------------------- | --------------------------------------------------- |
| `mark.svg`           | Mark for light backgrounds (`#111111`)              |
| `mark-dark.svg`      | Mark for dark backgrounds (`#fafafa`)               |
| `mark-tile.svg`      | Rounded app-icon tile with the mark in white        |
| `apple-icon.svg`     | Full-bleed app icon source (no transparent corners) |
| `wordmark.svg`       | Wordmark for light backgrounds                      |
| `wordmark-dark.svg`  | Wordmark for dark backgrounds                       |
| `lockup.svg`         | Mark plus wordmark for light backgrounds            |
| `lockup-dark.svg`    | Mark plus wordmark for dark backgrounds             |
| `social-preview.svg` | Repository and site social card source              |
| `png/`               | Exported PNGs (generated, committed)                |
| `export.mjs`         | Exporter that regenerates the PNGs and app icons    |

The SVGs are the editable source. Edit them by hand, then regenerate the PNGs.

## Colours

| Name  | Value     | Use                    |
| ----- | --------- | ---------------------- |
| Ink   | `#111111` | Mark and text on light |
| Paper | `#fafafa` | Mark and text on dark  |

There are no accent colours, gradients, or effects.

## Exported sizes

| Asset       | PNG sizes (px)                                     |
| ----------- | -------------------------------------------------- |
| Mark        | 16, 24, 32, 48, 64, 128, 256, 512 (light and dark) |
| Tile        | 16, 32, 48, 64, 128, 180, 192, 512                 |
| Wordmark    | heights 24, 32, 64 (light and dark)                |
| Lockup      | heights 32, 64 (light and dark)                    |
| Apple icon  | 180 × 180                                          |
| Social card | 1280 × 640                                         |

## Clear space and minimum sizes

- Keep at least the node diameter (about 21% of the mark) clear on every side.
- Minimum mark size is 16 px; minimum lockup width is 120 px.
- Use the tile for favicons and app icons, where a transparent mark can disappear against the tab
  bar.

## Usage

- Use `mark.svg` / `lockup.svg` on light surfaces and the `-dark` variants on dark surfaces.
- In the apps, use the shared `Logo` component from `@provisionless/design-system`. It draws with
  `currentColor`, so it follows the surrounding text colour in both themes.
- Do not rotate, stretch, outline, recolour outside the palette, or add shadows and gradients.
- Do not place the light mark on a light background or the dark mark on a dark background.

## Regenerating

```bash
npm run brand:export
```

The exporter requires the root `sharp` dev dependency. It writes `png/`, copies the favicons into
the admin and website app directories, and copies the social card into `packages/website/public/`.
The wordmark uses a system sans-serif stack, so regenerate on macOS to match the committed PNGs.

## GitHub repository metadata

- Description: `A serverless, headless CMS.`
- Homepage: intentionally blank until the website is deployed. Set it to the canonical site URL
  then; the website README uses `https://provisionless.dev` as the example.
- Topics: `cms`, `headless-cms`, `serverless`, `aws`, `lambda`, `dynamodb`, `typescript`, `nextjs`,
  `hono`.
- Social preview: upload `png/social-preview-1280x640.png` under Settings → General → Social
  preview. GitHub has no API for this image, so it is a manual step.
