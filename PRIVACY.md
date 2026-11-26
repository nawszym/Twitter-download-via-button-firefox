# Privacy notice — Twitter Media via Button

## What this add-on does with data

This add-on adds download buttons to media on X/Twitter. It normally works
entirely inside your browser: no data is sent anywhere.

## The one exception

When you click the download button on a **video** and the add-on could not
read the video URL from the page itself (this happens on some Firefox for
Android builds), the add-on sends the **numeric post ID** of that tweet to the
public FxTwitter API (`api.fxtwitter.com`) in order to retrieve the MP4 link.
This is declared in the manifest as `data_collection_permissions.required =
["websiteActivity"]`.

- Only the post ID is sent — no cookies, no account details, no browsing
  history, no other tweets.
- The request happens only after you tap a video download button.
- The add-on does not use analytics, tracking, telemetry or advertising SDKs.

The manifest declares this data collection because the add-on transmits a post
identifier outside the browser for the sole purpose of downloading that video.

## Local data

Downloaded files are saved to your device's normal Downloads folder. The add-on
keeps no download history of its own and stores no personal data.

## Contact

Use the support field on the add-on's addons.mozilla.org listing page.
