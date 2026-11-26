# AMO listing text (copy/paste ready)

Use this for the public listing on addons.mozilla.org. It is written to be
clear about what the add-on does and to state honestly that no data leaves the
browser.

## Name

Twitter Media via Button

## Summary (short, ≤ 100 chars)

Adds a download button to images, videos and GIFs on X/Twitter — best quality, one button per carousel item.

## Description

Do you want to save a photo, video or animated GIF from X (Twitter) in the
highest quality available? This add-on puts a small download button directly on
top of every media item you see in the timeline, on a profile or in a tweet's
detail view.

Features:

- One button per media item — image carousels and video carousels get a button
  on every slide.
- Best quality: images are downloaded in their original resolution
  (`name=orig`); videos and animated GIFs use the highest-bitrate MP4 variant
  that X provides.
- Animated GIFs are saved as the MP4 files they actually are, so they keep
  playing in any gallery or video player.
- Works on both desktop Firefox and Firefox for Android. On desktop it uses
  Firefox's download manager; on Android it saves through the browser's normal
  download mechanism.
- Filenames are based on the author and the post, e.g. `@username_123456789_1.jpg`.
  If a post has several media items they are numbered 1, 2, 3, and so on.

How it works: the add-on reads the media information that X's own page already
loads in order to display the media. It does not bypass login walls, paywalls or
any access restriction, and it cannot download media that is not already
visible to you.

Privacy: this add-on collects and transmits no personal data. It does not send
anything to third-party services, does not use analytics, and does not need an
account. Media files are fetched directly from X's own image/video servers only
when you click a button. This is declared in the manifest as
`data_collection_permissions.required = ["none"]`.

## Category

Photos & Images / Social & Communication (choose whichever fits best)

## Testing instructions for the reviewer

1. Install the add-on and visit `https://x.com/` (or `https://twitter.com/`).
   Log in if the home timeline is not publicly visible.
2. Find any tweet with a photo. A small blue circular arrow button should appear
   in the top-right corner of the photo. Click it — the file is saved to your
   normal Downloads folder as `@username_<post-id>.jpg` (or `_1.jpg`, `_2.jpg`
   for a carousel, one per slide).
3. Find a tweet with a video or animated GIF. The button should appear on the
   video as well. Click it — an `.mp4` file is saved. Open it to confirm it plays.
4. Scroll the timeline so new tweets load; buttons should appear on those too.
5. No account or special credentials are needed beyond a normal X account for
   viewing the timeline.

## Privacy note for the listing (important)

If the add-on cannot read a video URL from the page (common on Firefox for
Android), clicking a video download button sends only the numeric post ID to
the public FxTwitter API in order to obtain the MP4 link. The manifest declares
this as `data_collection_permissions.required = ["websiteActivity"]`. There is
no analytics, no tracking, no cookies and no other transmission. Full notice:
`PRIVACY.md`.

## License

Select **Mozilla Public License 2.0 (MPL 2.0)** in the AMO listing wizard.
The full license text is included in the repository as `LICENSE`.

## Notes

- Manifest V2 is used because Firefox continues to support it and it is the most
  reliable option on Firefox for Android.
- Source code is plain, unminified JavaScript: `content.js`, `background.js`,
  `content.css`, `manifest.json`. No build step is required, so no separate
  source package is necessary.
- If you choose "On your own" (self-distributed) instead of a public listing,
  the same package can be uploaded for signing; nothing in it needs to change.
