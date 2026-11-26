# Installing on Firefox for Android

The XPI in this folder is **unsigned**. Regular Firefox from Google Play only
accepts add-ons signed by Mozilla, and `xpinstall.signatures.required=false`
has **no effect** there. Use **Firefox Nightly for Android** (or Beta) for a
persistent install of an unsigned add-on.

Earlier builds produced an "appears to be corrupted" error because the manifest
was missing an add-on ID. The current `manifest.json` includes:

```json
"browser_specific_settings": {
  "gecko": { "id": "twitter-media-via-button@local.addon" }
}
```

## Nightly — install from file (persistent)

1. Install **Firefox Nightly for Developers** from Google Play.
2. In Nightly open `about:config` and set `xpinstall.signatures.required` to `false`.
3. Open **Settings → About Firefox Nightly** and tap the Firefox logo **5 times**
   to unlock the secret debug settings.
4. Go back to **Settings** and tap **Install extension from file** (older builds:
   "Install add-on from file").
5. Pick `twitter-media-via-button.xpi` (or the ID-named copy
   `twitter-media-via-button@local.addon.xpi`) from your Downloads folder.
6. Confirm the permissions and tap **Add**.

## web-ext — temporary install via USB (any Firefox edition)

Requires USB debugging on the phone and `adb` available:

```bash
npm install -g web-ext
web-ext run --target firefox-android --firefox-apk org.mozilla.firefox
```

Use `org.mozilla.fenix` for Nightly or `org.mozilla.firefox_beta` for Beta.
The add-on is removed when Firefox restarts.

## Stable Firefox — signed package only

Regular Firefox requires a Mozilla-signed XPI (AMO unlisted listing). With an
AMO API key:

```bash
web-ext sign --channel=unlisted --api-key YOUR_KEY --api-secret YOUR_SECRET
```

Then install the signed XPI from an HTTPS URL or through the debug menu.
