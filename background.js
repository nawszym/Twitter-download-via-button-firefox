/*
 * Twitter Media via Button - background script
 *
 * - Streams the direct URL to disk on desktop (browser.downloads).
 * - Fetches bytes for the Android Blob fallback when CORS blocks the page.
 * - Reads GraphQL responses via webRequest (with responseBody) so video URLs
 *   are found even when the page-side fetch/XHR hooks miss them.
 * No data is sent to any third-party service.
 */

'use strict';

var mediaByCode = Object.create(null);   // media code -> { imageUrl, videoUrl }
var mediaByTweet = Object.create(null);  // tweet id  -> [videoUrl, ...]

function bestMp4(variants) {
  if (!variants || !Array.isArray(variants)) return null;
  var best = null;
  for (var i = 0; i < variants.length; i++) {
    var v = variants[i];
    if (!v || !v.url) continue;
    var ct = String(v.content_type || v.container || '').toLowerCase();
    if (ct !== 'video/mp4' && ct !== 'mp4' && v.url.indexOf('.mp4') === -1) continue;
    if (!best || (Number(v.bitrate) || 0) > (Number(best.bitrate) || 0)) best = v;
  }
  return best ? best.url : null;
}

function codeFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  var m = url.match(/\/media\/([^/?#]+)/);
  return m ? m[1].replace(/\.[a-zA-Z0-9]+$/, '') : null;
}

function storeMedia(media, tweetId) {
  try {
    if (!media || typeof media !== 'object') return;
    var imageUrl = media.media_url_https || media.media_url;
    var code = codeFromUrl(imageUrl);
    var videoUrl = media.video_info ? bestMp4(media.video_info.variants) : null;
    if (!code && !videoUrl) return;
    if (code) {
      mediaByCode[code] = {
        imageUrl: imageUrl || '',
        videoUrl: videoUrl || (mediaByCode[code] && mediaByCode[code].videoUrl) || ''
      };
    }
    if (videoUrl && tweetId) {
      var list = mediaByTweet[tweetId] || (mediaByTweet[tweetId] = []);
      if (list.indexOf(videoUrl) === -1) list.push(videoUrl);
    }
  } catch (e) {}
}

function harvest(obj, depth, tweetId) {
  if (!obj || typeof obj !== 'object' || depth > 60) return;
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) harvest(obj[i], depth + 1, tweetId);
    return;
  }
  var id = obj.rest_id || obj.id_str || (obj.legacy && obj.legacy.id_str) || tweetId;
  try {
    if (obj.extended_entities && Array.isArray(obj.extended_entities.media)) {
      var list = obj.extended_entities.media;
      for (var j = 0; j < list.length; j++) storeMedia(list[j], id);
    }
    if (Array.isArray(obj.media)) {
      for (var k = 0; k < obj.media.length; k++) storeMedia(obj.media[k], id);
    }
  } catch (e) {}
  try {
    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        var val = obj[key];
        if (val && typeof val === 'object') harvest(val, depth + 1, id);
      }
    }
  } catch (e) {}
}

function parseGraphQL(chunks) {
  try {
    var total = 0, i;
    for (i = 0; i < chunks.length; i++) total += chunks[i].byteLength;
    var bytes = new Uint8Array(total), off = 0;
    for (i = 0; i < chunks.length; i++) {
      bytes.set(new Uint8Array(chunks[i]), off);
      off += chunks[i].byteLength;
    }
    var text = new TextDecoder().decode(bytes);
    harvest(JSON.parse(text), 0, null);
  } catch (e) {}
}

// Firefox's way to read a response body: filterResponseData from a blocking
// onBeforeRequest listener. We forward every chunk unchanged, so the page sees
// exactly the same response.
try {
  browser.webRequest.onBeforeRequest.addListener(function (details) {
    var filter;
    try {
      filter = browser.webRequest.filterResponseData(details.requestId);
    } catch (e) { return {}; }
    var chunks = [];
    filter.ondata = function (event) {
      try {
        chunks.push(event.data);
        filter.write(event.data);
      } catch (e) {}
    };
    filter.onstop = function () {
      try { parseGraphQL(chunks); } catch (e) {}
      try { filter.close(); } catch (e) {}
    };
    filter.onerror = function () {
      try { filter.close(); } catch (e) {}
    };
    return {};
  }, {
    urls: [
      '*://twitter.com/i/api/graphql/*',
      '*://www.twitter.com/i/api/graphql/*',
      '*://x.com/i/api/graphql/*',
      '*://www.x.com/i/api/graphql/*'
    ]
  }, ['blocking']);
} catch (e) {
  console.warn('[tw-media] webRequest hook unavailable:', e);
}

browser.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg) return;

  if (msg.action === 'downloadUrl' && msg.payload && msg.payload.url) {
    if (!browser.downloads || !browser.downloads.download) {
      sendResponse({ ok: false, error: 'downloads API unavailable' });
      return;
    }
    browser.downloads.download({
      url: msg.payload.url,
      filename: msg.payload.filename || 'download',
      saveAs: false,
      conflictAction: 'uniquify'
    }).then(function (id) {
      sendResponse({ ok: true, id: id });
    })['catch'](function (err) {
      sendResponse({ ok: false, error: String(err) });
    });
    return true;
  }

  if (msg.action === 'fetchBinary' && msg.payload && msg.payload.url) {
    fetch(msg.payload.url, { credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.arrayBuffer();
      })
      .then(function (buf) { sendResponse({ ok: true, data: buf }); })
      .catch(function (err) { sendResponse({ ok: false, error: String(err) }); });
    return true;
  }

  // Last-resort video lookup by post ID. The ID is taken from the tweet's
  // permalink in the DOM and is only sent to FxTwitter to retrieve MP4 URLs.
  if (msg.action === 'videoUrl' && msg.payload && msg.payload.tweetId) {
    var id = String(msg.payload.tweetId);
    var smaller = !!msg.payload.smaller;
    var endpoints = [
      'https://api.fxtwitter.com/status/' + encodeURIComponent(id),
      'https://api.fxtwitter.com/2/status/' + encodeURIComponent(id)
    ];
    function tryNext(i) {
      if (i >= endpoints.length) { sendResponse({ ok: true, url: null }); return; }
      fetch(endpoints[i], { credentials: 'omit' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          var tweet = (data && (data.tweet || data.status)) || data;
          var videos = tweet && tweet.media && (tweet.media.videos || tweet.media.all);
          var url = null;
          if (Array.isArray(videos)) {
            for (var k = 0; k < videos.length; k++) {
              var v = videos[k];
              var variants = (v.variants || []).concat(v.formats || []);
              url = bestMp4(variants) ||
                (v.url && v.url.indexOf('.mp4') !== -1 ? v.url : null);
              if (smaller && url) {
                // On mobile prefer a reliable ~720p variant over a huge 1080p
                // file that may time out or exhaust memory.
                var limited = variants.filter(function (x) {
                  return x && x.url && x.url.indexOf('.mp4') !== -1 &&
                    (Number(x.bitrate) || 0) <= 3000000;
                });
                if (limited.length) url = bestMp4(limited);
              }
              if (url) break;
            }
          }
          if (url) sendResponse({ ok: true, url: url });
          else tryNext(i + 1);
        })
        .catch(function () { tryNext(i + 1); });
    }
    tryNext(0);
    return true;
  }

  if (msg.action === 'getMediaInfo') {
    var code = msg.payload && msg.payload.code;
    var tweetId = msg.payload && msg.payload.tweetId;
    sendResponse({
      ok: true,
      videoUrl: code && mediaByCode[code] ? mediaByCode[code].videoUrl : null,
      imageUrl: code && mediaByCode[code] ? mediaByCode[code].imageUrl : null,
      tweetVideos: tweetId && mediaByTweet[tweetId] ? mediaByTweet[tweetId].slice() : []
    });
    return;
  }
});
