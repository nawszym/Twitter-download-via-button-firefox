# Twitter Media via Button

A Firefox add-on for X / Twitter that puts a **download button on every media item**:

- one button per image, video and animated GIF
- every slide of a carousel gets its own button
- best available quality: original images (`name=orig`), highest practical MP4 variant for video
- filenames like `@username_123456789_1.jpg` (sequential numbering when a post has several media items)
- works on **desktop Firefox and Firefox for Android**

Install it from [addons.mozilla.org](https://addons.mozilla.org/addon/twitter-media-via-button/).

## How it works

1. The content script adds a button to each media element and keeps it in sync while you scroll.
2. Video URLs are resolved from several sources: page hooks, a background
   `webRequest` filter, React fiber data, the DOM, and — as a last resort —
   FxTwitter by post ID. On Android the add-on selects a lighter 720p variant
   for reliability.
3. Desktop saves images through `browser.downloads`; Android (which has no
   downloads API) uses a `Blob` + `<a download>`. Videos always use a Blob so
   the CDN receives a proper `Referer`.
4. Visible images are prefetched on Android so the download prompt appears
   immediately when you tap.

## Repository contents

| File | Purpose |
| --- | --- |
| `manifest.json` | Manifest V2, add-on ID, permissions, data-collection declaration |
| `content.js` | DOM scanning, buttons, URL resolution, saving |
| `content.css` | Button styles |
| `background.js` | Downloads, CORS fallback, GraphQL capture, FxTwitter fallback |
| `icon-48.png`, `icon-96.png` | Add-on icons |
| `LICENSE` | Mozilla Public License 2.0 |
| `PRIVACY.md` | Privacy notice |
| `AMO_LISTING.md` | Ready-to-paste AMO listing text and reviewer notes |
| `INSTALL-ANDROID.md` | Android sideloading instructions |
| `publish-update.ps1` | Sign and upload a listed update to AMO |
| `install-permanent.ps1` | Install a signed XPI into the local Firefox profile |

`amo-credentials.txt`, `signed/`, `sign-source/` and all generated `.xpi` files
are intentionally gitignored.

## Build a local package

The XPI is just a ZIP of the extension files:

```powershell
Compress-Archive -Path manifest.json,content.js,content.css,background.js,icon-48.png,icon-96.png,LICENSE `
  -DestinationPath addon.zip -Force
Rename-Item addon.zip addon.xpi -Force
```

Validate with Mozilla's linter:

```bash
npx addons-linter .
```

## Publish to addons.mozilla.org

1. Create AMO API credentials at
   <https://addons.mozilla.org/en-US/developers/addon/api/key/>.
2. Put them in `amo-credentials.txt` (two lines: JWT issuer, then secret).
   This file is gitignored and stays on your machine.
3. Bump `version` in `manifest.json`.
4. Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\publish-update.ps1
```

The script rebuilds the clean signing source, signs the listed update and
prints the signed XPI path. It does not delete your credentials file.

To install the signed file locally, close Firefox and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-permanent.ps1 -SignedXpi .\signed\<signed-file>.xpi
```

## Privacy

The add-on normally works entirely in the browser. As a last resort for videos
it sends only the numeric post ID to FxTwitter to obtain the MP4 link; this is
declared in the manifest as `data_collection_permissions.required =
["websiteActivity"]`. See [PRIVACY.md](PRIVACY.md).

## License

Mozilla Public License 2.0 — see [LICENSE](LICENSE).
