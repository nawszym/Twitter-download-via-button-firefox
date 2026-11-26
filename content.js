/*
 * Twitter Media via Button - content script
 *
 * 1. Hooks fetch/XHR in the page to collect media metadata from Twitter's
 *    GraphQL responses (original image URLs + best MP4 for videos/GIFs).
 * 2. Also exposes a page-context helper that reads the same data straight
 *    out of React's fiber tree for a specific <video> element. This is the
 *    reliable path when the network hooks miss a response.
 * 3. Adds one download button per media element, including carousel slides.
 * 4. Saves via browser.downloads (desktop) or Blob + <a download> (Android).
 */
(function () {
  'use strict';

  var MEDIA_MAP = Object.create(null);   // media code -> { code, type, imageUrl, videoUrl }
  var TWEET_VIDEOS = Object.create(null); // tweet id -> [mp4 url, ...]
  var LAST_VIDEO_DEBUG = {};
  var BTN_ATTR = 'data-twmedia-btn';
  var PROCESSED_ATTR = 'data-twmedia-processed';

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */

  function extractCode(url) {
    if (!url || typeof url !== 'string') return null;
    var m = url.match(/\/media\/([^/?#]+)/);
    if (!m) return null;
    return m[1].replace(/\.[a-zA-Z0-9]+$/, '');
  }

  function originalImageUrl(url) {
    if (!url) return null;
    try {
      var u = new URL(url);
      u.searchParams.delete('name');
      u.searchParams.set('name', 'orig');
      return u.toString();
    } catch (e) {
      return url + (url.indexOf('?') === -1 ? '?' : '&') + 'name=orig';
    }
  }

  function fileExtension(src) {
    var m = src.match(/\.(jpg|jpeg|png|gif|webp)(?:\?|$)/i);
    if (m) return m[1].toLowerCase();
    var f = src.match(/[?&]format=(jpg|jpeg|png|gif|webp)(?:&|$)/i);
    return f ? f[1].toLowerCase() : 'jpg';
  }

  function feedback(btn, text) {
    var old = btn.getAttribute('data-label');
    var oldBg = btn.style.background;
    btn.textContent = text;
    btn.setAttribute('data-label', text);
    if (text === '\u2713') btn.style.background = 'rgba(29,155,240,0.95)';
    if (text === '\u2717') btn.style.background = 'rgba(220,38,38,0.95)';
    window.setTimeout(function () {
      btn.textContent = old || '\u21E9';
      btn.style.background = oldBg;
      btn.removeAttribute('data-label');
    }, 2000);
  }

  // Visible diagnostic, especially useful on Android where DevTools are not
  // available.
  function showToast(text) {
    try {
      var old = document.getElementById('twmedia-toast');
      if (old) old.remove();
      var d = document.createElement('div');
      d.id = 'twmedia-toast';
      d.textContent = text;
      d.style.cssText = 'position:fixed;left:50%;bottom:70px;transform:translateX(-50%);' +
        'z-index:2147483000;max-width:85vw;padding:10px 14px;border-radius:8px;' +
        'background:rgba(0,0,0,.88);color:#fff;font:13px/1.4 sans-serif;' +
        'box-shadow:0 4px 14px rgba(0,0,0,.5);pointer-events:none';
      document.body.appendChild(d);
      window.setTimeout(function () { if (d.parentNode) d.remove(); }, 5000);
    } catch (e) {}
  }

  function setBusy(btn, busy) {
    if (busy) btn.setAttribute('data-busy', '1');
    else btn.removeAttribute('data-busy');
  }

  /* ------------------------------------------------------------------ */
  /* page-context code (network hooks + React fiber reader)              */
  /* Must be self-contained: exported into the page's JS world.          */
  /* ------------------------------------------------------------------ */

  function installNetworkHooks() {
    var map = (window.__twMediaMap = window.__twMediaMap || {});

    function code(url) {
      if (!url || typeof url !== 'string') return null;
      var m = url.match(/\/media\/([^/?#]+)/);
      return m ? m[1].replace(/\.[a-zA-Z0-9]+$/, '') : null;
    }

    function bestMp4(variants) {
      if (!variants || Object.prototype.toString.call(variants) !== '[object Array]') return null;
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

    var videoByCode = (window.__twVideoByCode = window.__twVideoByCode || {});
    var tweetVideos = (window.__twTweetVideos = window.__twTweetVideos || {});
    window.__twHooksReady = true;

    function store(media, tweetId) {
      try {
        if (!media || typeof media !== 'object') return;
        var url = media.media_url_https || media.media_url || media.media_url_https_orig;
        var c = code(url);
        if (!c) return;
        var entry = {
          code: c,
          type: media.type || 'photo',
          imageUrl: url,
          videoUrl: ''
        };
        var vi = media.video_info || (media.extended_entities && media.extended_entities.video_info);
        if (vi) entry.videoUrl = bestMp4(vi.variants) || '';
        map[c] = entry;
        if (entry.videoUrl) {
          videoByCode[c] = entry.videoUrl;
          if (tweetId) {
            var arr = tweetVideos[tweetId] || (tweetVideos[tweetId] = []);
            if (arr.indexOf(entry.videoUrl) === -1) arr.push(entry.videoUrl);
          }
        }
      } catch (e) {}
    }

    function harvest(obj, depth, tweetId) {
      if (!obj || typeof obj !== 'object' || depth > 50) return;
      if (Object.prototype.toString.call(obj) === '[object Array]') {
        for (var i = 0; i < obj.length; i++) harvest(obj[i], depth + 1, tweetId);
        return;
      }
      var currentId = obj.rest_id || obj.id_str || (obj.legacy && obj.legacy.id_str) || tweetId;
      try {
        if (obj.extended_entities && Object.prototype.toString.call(obj.extended_entities.media) === '[object Array]') {
          var ee = obj.extended_entities.media;
          for (var j = 0; j < ee.length; j++) store(ee[j], currentId);
        }
        if (Object.prototype.toString.call(obj.media) === '[object Array]') {
          for (var k = 0; k < obj.media.length; k++) store(obj.media[k], currentId);
        }
        if (obj.media_key && (obj.media_url_https || obj.media_url)) store(obj, currentId);
      } catch (e) {}
      try {
        for (var key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            var val = obj[key];
            if (val && typeof val === 'object') harvest(val, depth + 1, currentId);
          }
        }
      } catch (e) {}
    }

    function relevant(url) {
      if (!url || typeof url !== 'string') return false;
      return url.indexOf('twitter.com') !== -1 ||
             url.indexOf('x.com') !== -1 ||
             url.indexOf('twimg.com') !== -1;
    }

    // Recursively look for video_info.variants anywhere inside an object.
    // React props shapes change often, so fixed key paths are not enough.
    function deepFindVideo(obj, seen, depth) {
      if (!obj || typeof obj !== 'object' || depth > 25) return null;
      if (seen.indexOf(obj) !== -1) return null;
      seen.push(obj);
      try {
        if (obj.video_info && obj.video_info.variants) {
          var u = bestMp4(obj.video_info.variants);
          if (u) return u;
        }
        if (Object.prototype.toString.call(obj.media) === '[object Array]') {
          for (var i = 0; i < obj.media.length; i++) {
            var m = obj.media[i];
            if (m && m.video_info) {
              var u2 = bestMp4(m.video_info.variants);
              if (u2) return u2;
            }
          }
        }
      } catch (e) {}
      try {
        var keys = Object.keys(obj);
        for (var k = 0; k < keys.length; k++) {
          var v = obj[keys[k]];
          if (v && typeof v === 'object') {
            var found = deepFindVideo(v, seen, depth + 1);
            if (found) return found;
          }
        }
      } catch (e) {}
      return null;
    }

    function getFiber(el) {
      while (el) {
        for (var k in el) {
          if (k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0) {
            return el[k];
          }
        }
        el = el.parentElement;
      }
      return null;
    }

    // Find the media object whose image URL contains this exact media code.
    // This is how we make sure a carousel button downloads ITS OWN video.
    function matchMediaByCode(obj, code, seen, depth) {
      if (!obj || typeof obj !== 'object' || depth > 25 || seen.indexOf(obj) !== -1) return null;
      seen.push(obj);
      try {
        var url = obj.media_url_https || obj.media_url || obj.media_url_https_orig;
        if (url && code && url.indexOf('/media/' + code) !== -1) {
          var vi = obj.video_info;
          if (vi && vi.variants) {
            var u = bestMp4(vi.variants);
            if (u) return u;
          }
          return null;
        }
      } catch (e) {}
      try {
        var keys = Object.keys(obj);
        for (var i = 0; i < keys.length; i++) {
          var v = obj[keys[i]];
          if (v && typeof v === 'object') {
            var found = matchMediaByCode(v, code, seen, depth + 1);
            if (found) return found;
          }
        }
      } catch (e) {}
      return null;
    }

    function collectVideoInfos(obj, out, seen, depth) {
      if (!obj || typeof obj !== 'object' || depth > 25 || seen.indexOf(obj) !== -1) return;
      seen.push(obj);
      try {
        var vi = obj.video_info;
        if (vi && vi.variants) {
          var u = bestMp4(vi.variants);
          if (u) out.push(u);
        }
        if (Object.prototype.toString.call(obj.media) === '[object Array]') {
          for (var i = 0; i < obj.media.length; i++) {
            var m = obj.media[i];
            if (m && m.video_info && m.video_info.variants) {
              var u2 = bestMp4(m.video_info.variants);
              if (u2) out.push(u2);
            }
          }
        }
      } catch (e) {}
      try {
        var keys = Object.keys(obj);
        for (var k = 0; k < keys.length; k++) {
          var v = obj[keys[k]];
          if (v && typeof v === 'object') collectVideoInfos(v, out, seen, depth + 1);
        }
      } catch (e) {}
    }

    function videoUrlFromFiber(el, code, index) {
      var fiber = getFiber(el);
      var depth = 0;
      var infos = [];
      while (fiber && depth < 100) {
        var props = fiber.memoizedProps;
        if (code && props) {
          var byCode = matchMediaByCode(props, code, [], 0) ||
                       (fiber.stateNode && matchMediaByCode(fiber.stateNode.props, code, [], 0));
          if (byCode) return byCode;
        }
        if (props) collectVideoInfos(props, infos, [], 0);
        fiber = fiber.return;
        depth++;
      }
      var unique = [];
      for (var i = 0; i < infos.length; i++) {
        if (unique.indexOf(infos[i]) === -1) unique.push(infos[i]);
      }
      if (index >= 0 && index < unique.length) return unique[index];
      return null;
    }

    function tweetFromFiber(el) {
      var fiber = getFiber(el);
      var depth = 0;
      while (fiber && depth < 80) {
        var props = fiber.memoizedProps;
        if (props) {
          var t = props.tweet || (props.tweet_results && props.tweet_results.result) || props.result;
          if (t) {
            var legacy = t.legacy || t;
            var id = t.rest_id || legacy.id_str || legacy.conversation_id_str;
            if (id) {
              var userResult = t.core && t.core.user_results && t.core.user_results.result;
              var user = (userResult && userResult.legacy) || legacy.user || {};
              return {
                id: String(id),
                screenName: user.screen_name ? String(user.screen_name) : ''
              };
            }
          }
        }
        fiber = fiber.return;
        depth++;
      }
      return null;
    }

    window.__twVideoUrlForElement = function (el, code, index) {
      try { return videoUrlFromFiber(el, code, index); } catch (e) { return null; }
    };

    window.__twTweetInfoForElement = function (el) {
      try { return tweetFromFiber(el); } catch (e) { return null; }
    };

    // fetch() hook
    try {
      var nativeFetch = window.fetch;
      if (nativeFetch) {
        window.fetch = function () {
          var target = arguments[0] && (arguments[0].url || arguments[0]);
          var promise = nativeFetch.apply(this, arguments);
          return promise.then(function (response) {
            try {
              var ct = response && response.headers && response.headers.get ?
                (response.headers.get('content-type') || '') : '';
              if (relevant(target) && (ct.indexOf('json') !== -1 || String(target).indexOf('graphql') !== -1) && response.clone) {
                response.clone().json().then(function (json) { harvest(json, 0); })['catch'](function () {});
              }
            } catch (e) {}
            return response;
          });
        };
      }
    } catch (e) {}

    // XMLHttpRequest hook
    try {
      var nativeOpen = XMLHttpRequest.prototype.open;
      var nativeSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        this.__twUrl = url;
        return nativeOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function () {
        var req = this;
        this.addEventListener('load', function () {
          try {
            var ct = req.getResponseHeader ? (req.getResponseHeader('content-type') || '') : '';
            if (relevant(req.__twUrl) && (ct.indexOf('json') !== -1 || String(req.__twUrl).indexOf('graphql') !== -1)) {
              harvest(JSON.parse(req.responseText), 0);
            }
          } catch (e) {}
        });
        return nativeSend.apply(this, arguments);
      };
    } catch (e) {}
  }

  // Fallback for Firefox for Android, where exportFunction may be unavailable
  // and inline scripts are blocked by CSP. We attach lightweight hooks straight
  // to the page's wrapped objects from the content script.
  function installWrappedHooks() {
    var w;
    try { w = window.wrappedJSObject; } catch (e) { return false; }
    if (!w) return false;
    try {
      var map = (w.__twMediaMap = w.__twMediaMap || {});
      var byCode = (w.__twVideoByCode = w.__twVideoByCode || {});
      var byTweet = (w.__twTweetVideos = w.__twTweetVideos || {});
      w.__twHooksReady = true;

      function code(url) {
        if (!url || typeof url !== 'string') return null;
        var m = url.match(/\/media\/([^/?#]+)/);
        return m ? m[1].replace(/\.[a-zA-Z0-9]+$/, '') : null;
      }
      function bestMp4(variants) {
        if (!variants || Object.prototype.toString.call(variants) !== '[object Array]') return null;
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
      function store(media, tweetId) {
        try {
          if (!media || typeof media !== 'object') return;
          var url = media.media_url_https || media.media_url;
          var c = code(url);
          if (!c) return;
          var vi = media.video_info || (media.extended_entities && media.extended_entities.video_info);
          var videoUrl = vi ? bestMp4(vi.variants) : '';
          map[c] = {
            code: c,
            type: media.type || 'photo',
            imageUrl: url,
            videoUrl: videoUrl || (map[c] && map[c].videoUrl) || ''
          };
          if (videoUrl) {
            byCode[c] = videoUrl;
            if (tweetId) {
              var arr = byTweet[tweetId] || (byTweet[tweetId] = []);
              if (arr.indexOf(videoUrl) === -1) arr.push(videoUrl);
            }
          }
        } catch (e) {}
      }
      function harvest(obj, depth, tweetId) {
        if (!obj || typeof obj !== 'object' || depth > 50) return;
        if (Object.prototype.toString.call(obj) === '[object Array]') {
          for (var i = 0; i < obj.length; i++) harvest(obj[i], depth + 1, tweetId);
          return;
        }
        var id = obj.rest_id || obj.id_str || (obj.legacy && obj.legacy.id_str) || tweetId;
        try {
          if (obj.extended_entities && Object.prototype.toString.call(obj.extended_entities.media) === '[object Array]') {
            var ee = obj.extended_entities.media;
            for (var j = 0; j < ee.length; j++) store(ee[j], id);
          }
          if (Object.prototype.toString.call(obj.media) === '[object Array]') {
            for (var k = 0; k < obj.media.length; k++) store(obj.media[k], id);
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

      // Hooking Response.json()/text() catches every fetch-based API call,
      // no matter which fetch reference the page captured at startup.
      var proto = w.Response && w.Response.prototype;
      if (proto) {
        ['json', 'text'].forEach(function (method) {
          var orig = proto[method];
          if (!orig) return;
          proto[method] = function () {
            var p = orig.apply(this, arguments);
            p.then(function (data) {
              try {
                if (typeof data === 'string') data = JSON.parse(data);
                harvest(data, 0, null);
              } catch (e) {}
            })['catch'](function () {});
            return p;
          };
        });
      }

      var X = w.XMLHttpRequest;
      if (X && X.prototype) {
        var origSend = X.prototype.send;
        X.prototype.send = function () {
          var req = this;
          req.addEventListener('load', function () {
            try {
              var ct = req.getResponseHeader ? (req.getResponseHeader('content-type') || '') : '';
              if (ct.indexOf('json') !== -1) harvest(JSON.parse(req.responseText), 0, null);
            } catch (e) {}
          });
          return origSend.apply(this, arguments);
        };
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function installHooks() {
    var installed = false;
    try {
      if (typeof exportFunction === 'function' && window.wrappedJSObject) {
        exportFunction(installNetworkHooks, window)();
        installed = true;
      }
    } catch (e) {}
    if (!installed) {
      try { installed = installWrappedHooks(); } catch (e) {}
    }
    if (!installed) {
      try {
        var s = document.createElement('script');
        s.textContent = '(' + installNetworkHooks.toString() + ')();';
        (document.head || document.documentElement).appendChild(s);
        if (s.parentNode) s.parentNode.removeChild(s);
      } catch (e) {}
    }
  }

  function syncMap() {
    var pageMap = null;
    try { pageMap = window.wrappedJSObject && window.wrappedJSObject.__twMediaMap; } catch (e) {}
    if (pageMap) {
      var keys;
      try { keys = Object.keys(pageMap); } catch (e) { keys = []; }
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (MEDIA_MAP[k]) continue;
        try {
          var v = pageMap[k];
          MEDIA_MAP[k] = {
            code: String(v.code || k),
            type: String(v.type || 'photo'),
            imageUrl: String(v.imageUrl || ''),
            videoUrl: String(v.videoUrl || '')
          };
        } catch (e) {}
      }
    }

    // Extra maps keyed by media code / tweet id - these are the rescue path
    // when the poster code cannot be read from the DOM.
    try {
      var pageVideos = window.wrappedJSObject && window.wrappedJSObject.__twVideoByCode;
      if (pageVideos) {
        var codes = Object.keys(pageVideos);
        for (var c = 0; c < codes.length; c++) {
          var code = codes[c];
          var url = String(pageVideos[code] || '');
          if (!url) continue;
          MEDIA_MAP[code] = MEDIA_MAP[code] || { code: code, type: 'video', imageUrl: '', videoUrl: '' };
          MEDIA_MAP[code].videoUrl = url;
        }
      }
      var pageTweets = window.wrappedJSObject && window.wrappedJSObject.__twTweetVideos;
      if (pageTweets) {
        var ids = Object.keys(pageTweets);
        for (var t = 0; t < ids.length; t++) {
          TWEET_VIDEOS[ids[t]] = Array.prototype.slice.call(pageTweets[ids[t]] || []);
        }
      }
    } catch (e) {}
  }

  /* ------------------------------------------------------------------ */
  /* video URL resolution                                                */
  /* ------------------------------------------------------------------ */

  function reactVideoUrl(el, code, index) {
    try {
      var pageEl = el.wrappedJSObject || el;
      var api = window.wrappedJSObject && window.wrappedJSObject.__twVideoUrlForElement;
      if (api) {
        var u = api(pageEl, code, index);
        if (u) return String(u);
      }
    } catch (e) {}
    return null;
  }

  // The poster image of a video carries the media ID of THAT video. Prefer it
  // over a code found anywhere else in the tweet (e.g. a carousel sibling).
  function videoCode(el) {
    var c = extractCode(el.poster || el.currentSrc || '');
    if (c) return c;
    var parent = el.parentElement;
    for (var level = 0; level < 3 && parent; level++) {
      var imgs = parent.querySelectorAll('img[src*="/media/"]');
      for (var i = 0; i < imgs.length; i++) {
        c = extractCode(imgs[i].currentSrc || imgs[i].src || '');
        if (c) return c;
      }
      parent = parent.parentElement;
    }
    return null;
  }

  function videoIndex(el) {
    var tweet = el.closest ? (el.closest('[data-testid="tweet"]') || el.closest('article')) : null;
    var scope = tweet || document;
    var videos = scope.querySelectorAll('video');
    return Array.prototype.indexOf.call(videos, el);
  }

  function pickBestUrl(urls) {
    var best = null, bestArea = -1;
    for (var i = 0; i < urls.length; i++) {
      var u = urls[i];
      var m = u.match(/\/(\d{2,4})x(\d{2,4})\//);
      var area = m ? (Number(m[1]) * Number(m[2])) : 0;
      if (area > bestArea) { bestArea = area; best = u; }
    }
    return best;
  }

  function extractMp4Urls(html) {
    var text = String(html || '')
      .replace(/\\\//g, '/')
      .replace(/\\u002F/gi, '/')
      .replace(/&amp;/g, '&');
    var found = text.match(/https:\/\/(?:video|pbs)\.twimg\.com[^"' <>\\)]+\.mp4(?:[^"' <>\\)]*)?/g) || [];
    return found.map(function (u) { return u.replace(/\\+$/, ''); });
  }

  function domVideoUrl(el) {
    var tweet = el.closest ? (el.closest('[data-testid="tweet"]') || el.closest('article')) : null;
    if (el.currentSrc && el.currentSrc.indexOf('.mp4') !== -1) return el.currentSrc;
    if (el.src && el.src.indexOf('.mp4') !== -1) return el.src;

    // Only look inside this video's own container, never at the whole page.
    // A document-wide scan picks up MP4s from other tweets and ads.
    var parent = el.parentElement;
    for (var level = 0; level < 3 && parent; level++) {
      var sources = parent.querySelectorAll('source[src]');
      for (var i = 0; i < sources.length; i++) {
        var s = sources[i].getAttribute('src') || '';
        if (s.indexOf('.mp4') !== -1) return s;
      }
      var found = extractMp4Urls(parent.innerHTML || '');
      if (found.length) return pickBestUrl(found);
      if (parent === tweet) break;
      parent = parent.parentElement;
    }
    return null;
  }

  // Author @name and numeric post ID, read from the tweet's permalink first,
  // then from React data attached to the element.
  function tweetInfo(el) {
    var tweet = el.closest ? (el.closest('[data-testid="tweet"]') || el.closest('article')) : null;
    var scope = tweet || document;
    var links = scope.querySelectorAll('a[href*="/status/"]');
    for (var i = 0; i < links.length; i++) {
      var m = (links[i].getAttribute('href') || '').match(/(?:^|\/)([^/]+)\/status\/(\d+)/);
      if (m && m[1] !== 'i' && m[1] !== 'com') {
        var name = m[1];
        try { name = decodeURIComponent(name); } catch (e) {}
        return { id: m[2], screenName: name };
      }
    }
    try {
      var pageEl = el.wrappedJSObject || el;
      var api = window.wrappedJSObject && window.wrappedJSObject.__twTweetInfoForElement;
      var info = api && api(pageEl);
      if (info) return { id: info.id || null, screenName: info.screenName || '' };
    } catch (e) {}
    return { id: null, screenName: '' };
  }

  function safeName(s) {
    return String(s).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  }

  function isVideoPoster(img) {
    var p = img.parentElement;
    if (!p) return false;
    if (p.querySelector('video')) return true;
    var g = p.parentElement;
    return !!(g && g.querySelector('video'));
  }

  function collectMedia(scope) {
    var nodes = scope.querySelectorAll('img[src*="/media/"], video');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.tagName === 'IMG' && isVideoPoster(n)) continue;
      out.push(n);
    }
    return out;
  }

  // Position of this media item among all media in the post (1-based).
  function mediaPosition(el) {
    var tweet = el.closest ? (el.closest('[data-testid="tweet"]') || el.closest('article')) : null;
    var scope = tweet || document;
    var all = collectMedia(scope);
    var p = el.parentElement;
    while (p && p !== scope) {
      var group = collectMedia(p);
      if (group.length > 1 && group.indexOf(el) !== -1) {
        return { index: group.indexOf(el) + 1, total: group.length };
      }
      p = p.parentElement;
    }
    return { index: Math.max(all.indexOf(el) + 1, 1), total: all.length };
  }

  function buildFilename(el, ext, fallbackCode) {
    var info = tweetInfo(el);
    var pos = mediaPosition(el);
    var user = info.screenName ? '@' + safeName(info.screenName) : '@unknown';
    var id = safeName(info.id || fallbackCode || 'post');
    var suffix = pos.total > 1 ? '_' + pos.index : '';
    return user + '_' + id + suffix + '.' + ext;
  }

  function message(action, payload) {
    return new Promise(function (resolve) {
      try {
        browser.runtime.sendMessage({ action: action, payload: payload }, function (resp) {
          if (browser.runtime.lastError) return resolve(null);
          resolve(resp || null);
        });
      } catch (e) { resolve(null); }
    });
  }

  async function resolveVideoUrl(el, elementCodeValue) {
    var code = videoCode(el);
    var index = videoIndex(el);
    console.log('[tw-media] resolve video', { code: code, index: index });

    // 1) Data captured by the page hooks, keyed by THIS media's code.
    var entry = code && MEDIA_MAP[code];
    if (entry && entry.videoUrl) return entry.videoUrl;

    // 2) Same data captured by the background webRequest hook.
    var tweetId = tweetInfo(el).id;
    var bg = await message('getMediaInfo', { code: code, tweetId: tweetId });
    LAST_VIDEO_DEBUG = {
      code: code,
      index: index,
      bg: bg && bg.ok ? (bg.videoUrl ? 'yes' : 'no') : 'off',
      bgList: bg && bg.tweetVideos ? bg.tweetVideos.length : 0
    };
    if (bg && bg.ok && bg.videoUrl) {
      if (code) {
        MEDIA_MAP[code] = MEDIA_MAP[code] || { code: code, type: 'video', imageUrl: bg.imageUrl || '', videoUrl: '' };
        MEDIA_MAP[code].videoUrl = bg.videoUrl;
      }
      return bg.videoUrl;
    }

    // 3) Maps keyed by the tweet id. A tweet with a single video is unambiguous.
    var pageList = tweetId && TWEET_VIDEOS[tweetId];
    var bgList = bg && bg.ok && bg.tweetVideos;
    var list = pageList || bgList;
    if (list && list.length === 1) return list[0];
    if (list && list.length > 1 && index >= 0 && index < list.length) return list[index];

    // 4) React fiber data matched by this media code (or video index).
    var u = reactVideoUrl(el, code, index);
    if (u) return u;

    // 4) MP4 URLs inside this video's own container only.
    u = domVideoUrl(el);
    if (u) return u;

    // 5) Last resort (important on Android, where the page hooks and the
    // GraphQL interception are often unavailable): ask FxTwitter by post ID.
    if (tweetId) {
      var api = await message('videoUrl', { tweetId: tweetId, smaller: isAndroid() });
      if (api && api.ok && api.url) return api.url;
    }

    return null;
  }

  /* ------------------------------------------------------------------ */
  /* DOM scanning & buttons                                              */
  /* ------------------------------------------------------------------ */

  function elementCode(el) {
    var src = '';
    if (el.tagName === 'IMG') src = el.currentSrc || el.src || '';
    else if (el.tagName === 'VIDEO') src = el.poster || el.currentSrc || '';

    var c = extractCode(src);
    if (c) return c;

    var tweet = el.closest ? (el.closest('[data-testid="tweet"]') || el.closest('article')) : null;
    var scope = tweet || document;
    var imgs = scope.querySelectorAll('img[src*="/media/"]');
    for (var i = 0; i < imgs.length; i++) {
      c = extractCode(imgs[i].currentSrc || imgs[i].src || '');
      if (c) return c;
    }
    return null;
  }

  function containerFor(el) {
    var c = el.parentElement;
    if (!c) return null;
    try {
      if (getComputedStyle(c).position === 'static') c.style.position = 'relative';
    } catch (e) {}
    return c;
  }

  function processElement(el) {
    if (el.hasAttribute(PROCESSED_ATTR)) return;
    var isVideo = el.tagName === 'VIDEO';

    if (!isVideo) {
      var src = el.currentSrc || el.src || '';
      if (src.indexOf('/media/') === -1) return;
      // A <video> nearby means this <img> is its poster. Skip it so the video
      // gets the button instead of a duplicate image one.
      if (isVideoPoster(el)) return;
    }

    var container = containerFor(el);
    if (!container) return;
    el.setAttribute(PROCESSED_ATTR, '1');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'twmedia-dl-btn';
    btn.setAttribute(BTN_ATTR, '1');
    btn.setAttribute('aria-label', 'Download media (best quality)');
    btn.title = 'Download (best quality)';
    btn.textContent = '\u21E9';
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      console.log('[tw-media] button clicked', el.tagName);
      download(el, btn);
    }, true);
    container.appendChild(btn);
    if (prefetchObserver) prefetchObserver.observe(el);
  }

  function scan() {
    syncMap();
    var nodes = document.querySelectorAll('img[src*="/media/"], video');
    for (var i = 0; i < nodes.length; i++) {
      try { processElement(nodes[i]); } catch (e) {}
    }
  }

  /* ------------------------------------------------------------------ */
  /* saving                                                              */
  /* ------------------------------------------------------------------ */

  function isAndroid() {
    return /Android/i.test(navigator.userAgent);
  }

  // Prefetch cache: on Android the download prompt must appear inside the
  // tap gesture, so the bytes need to be ready before the user taps.
  var blobCache = Object.create(null);
  var blobCacheCount = 0;
  var PREFETCH_MAX = 8;
  var prefetchObserver = null;

  function cacheKey(el) {
    return elementCode(el) || el.currentSrc || el.src || el.poster || '';
  }

  async function prefetchMedia(el) {
    if (!isAndroid() || blobCacheCount >= PREFETCH_MAX) return;
    if (el.tagName !== 'IMG') return;
    var key = cacheKey(el);
    var src = el.currentSrc || el.src || '';
    if (!key || !src || src.indexOf('/media/') === -1 || blobCache[key]) return;
    try {
      var blob = await toBlob(originalImageUrl(src), 'image/jpeg');
      if (blob.size > 12 * 1024 * 1024) return;
      blobCache[key] = blob;
      blobCacheCount++;
      console.log('[tw-media] prefetched', key, blob.size);
    } catch (e) {}
  }

  // Firefox for Android opens blobs whose type is viewable (image/jpeg,
  // video/mp4) in the built-in viewer instead of downloading them.
  // "application/x-binary" forces a real download there.
  function downloadableBlob(blob) {
    if (!isAndroid()) return blob;
    return new Blob([blob], { type: 'application/x-binary' });
  }

  function fetchWithTimeout(url, ms) {
    if (typeof AbortController === 'undefined') {
      return fetch(url, { credentials: 'omit', mode: 'cors' });
    }
    var controller = new AbortController();
    var timer = window.setTimeout(function () { controller.abort(); }, ms);
    return fetch(url, { credentials: 'omit', mode: 'cors', signal: controller.signal })
      .then(function (res) { window.clearTimeout(timer); return res; })
      ['catch'](function (err) { window.clearTimeout(timer); throw err; });
  }

  async function fetchViaBackground(url) {
    var resp = await message('fetchBinary', { url: url });
    if (!resp || !resp.ok || !resp.data) throw new Error('background fetch failed');
    return new Blob([resp.data], { type: 'application/x-binary' });
  }

  async function toBlob(url, mime) {
    try {
      var res = await fetchWithTimeout(url, 60000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return downloadableBlob(await res.blob());
    } catch (e) {
      console.warn('[tw-media] direct fetch failed, using background:', e);
      return await fetchViaBackground(url);
    }
  }

  function saveBlob(blob, filename) {
    var objectUrl = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    // Some mobile builds ignore a click on a display:none anchor. Keep it in
    // the DOM but move it off-screen instead.
    a.style.position = 'fixed';
    a.style.left = '-1000px';
    a.style.top = '0';
    a.style.width = '1px';
    a.style.height = '1px';
    a.style.opacity = '0';
    document.body.appendChild(a);
    a.click();
    window.setTimeout(function () {
      try { URL.revokeObjectURL(objectUrl); } catch (e) {}
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 60000);
  }

  // Desktop streams via downloads API for images. Videos always go through a
  // Blob: a bare downloads.download() call has no Referer and video.twimg.com
  // frequently answers 403 in that case.
  async function saveFile(url, filename, mime, forceBlob) {
    if (!forceBlob) {
      var native = await message('downloadUrl', { url: url, filename: filename });
      if (native && native.ok) return;
    }
    var blob = await toBlob(url, mime);
    saveBlob(blob, filename);
  }

  async function download(el, btn) {
    syncMap();
    // Re-resolve on every click: Twitter recycles DOM nodes while scrolling.
    var code = elementCode(el);
    var isVideo = el.tagName === 'VIDEO';

    setBusy(btn, true);
    try {
      if (isVideo) {
        feedback(btn, '\u2026');
        var videoUrl = await resolveVideoUrl(el, code);
        if (!videoUrl) {
          btn.title = 'Nie znaleziono linku do filmu';
          feedback(btn, '\u2717');
          showToast('Brak URL filmu · kod:' + (LAST_VIDEO_DEBUG.code || '-') +
            ' · idx:' + (LAST_VIDEO_DEBUG.index < 0 ? '-' : LAST_VIDEO_DEBUG.index) +
            ' · hooki:' + (window.wrappedJSObject && window.wrappedJSObject.__twHooksReady ? 'tak' : 'nie') +
            ' · bg:' + (LAST_VIDEO_DEBUG.bg || '?') + '/' + (LAST_VIDEO_DEBUG.bgList || 0));
          return;
        }
        await saveFile(videoUrl, buildFilename(el, 'mp4', code), 'video/mp4', true);
        feedback(btn, '\u2713');
        return;
      }

      var entry = code && MEDIA_MAP[code];
      var src = (entry && entry.imageUrl) ? entry.imageUrl : (el.currentSrc || el.src || '');
      if (!src || src.indexOf('/media/') === -1) {
        btn.title = 'Nie znaleziono linku do zdjęcia';
        feedback(btn, '\u2717');
        return;
      }
      var url = originalImageUrl(src);
      var ext = fileExtension(src);
      var filename = buildFilename(el, ext, extractCode(src) || code);

      // Instant path: a prefetched blob lets us call saveBlob synchronously in
      // the click handler, so Android shows the download immediately.
      var cached = blobCache[extractCode(src) || code];
      if (cached) {
        saveBlob(cached, filename);
        feedback(btn, '\u2713');
        return;
      }

      feedback(btn, '\u2026');
      await saveFile(url, filename, 'image/jpeg');
      feedback(btn, '\u2713');
    } catch (e) {
      var err = e && e.message ? e.message : String(e);
      console.error('[tw-media] download failed:', e);
      btn.title = 'Błąd pobierania: ' + err;
      feedback(btn, '\u2717');
      showToast('Błąd pobierania: ' + err);
    } finally {
      setBusy(btn, false);
    }
  }

  /* ------------------------------------------------------------------ */
  /* start                                                               */
  /* ------------------------------------------------------------------ */

  installHooks();

  if (isAndroid() && typeof IntersectionObserver === 'function') {
    prefetchObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          prefetchMedia(entry.target);
          prefetchObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '250px' });
  }

  scan();

  var observer = new MutationObserver(function () { scan(); });
  observer.observe(document.documentElement || document, {
    childList: true,
    subtree: true
  });

  window.setInterval(scan, 1000);
})();
