/* Independent catalogue links translated to the installed TV app. Strict ES5. */
var msg = require('./say').msg;
var verified = {};
function words(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9\u00c0-\uffff]+/g, ' ').trim(); }
function httpUrl(v) { return typeof v === 'string' && /^https?:\/\//i.test(v) && v.length < 4096 ? v : ''; }
function nativeObject(v) { try { var p = JSON.parse(v || 'null'); return p && typeof p.id === 'string' && p.params ? p : null; } catch (e) { return null; } }
function providerApp(p) {
  if (/^netflix/.test(p)) return ['netflix'];
  if (/^amazon/.test(p)) return ['amazon'];
  if (p === 'itunes' || p === 'appletvplus') return ['com.apple.appletv'];
  if (/^disneyplus/.test(p)) return ['com.disney.disneyplus-prod'];
  if (p === 'bbc' || p === 'bbciplayer') return ['bbc.iplayer.3.0'];
  if (p === 'itv' || p === 'itvx') return ['com.fvp.itv'];
  if (p === 'all4') return ['com.fvp.ch4'];
  if (p === 'my5') return ['demand5'];
  if (/^paramountplus/.test(p)) return ['com.pplus.webapp.prod-intl', 'com.cbs-all-access.webapp.prod'];
  if (p === 'max' || p === 'hbomax') return ['com.wbd.stream'];
  if (/^plex/.test(p)) return ['cdp-30'];
  if (p === 'skystore') return ['com.bskyb.skystore'];
  return [];
}
function videoUrl(v, host) { return httpUrl(v) && new RegExp('^https?://(?:www\\.)?' + host + '/', 'i').test(v) ? v : ''; }
function candidate(offer, installed) {
  var provider = offer && offer.package && offer.package.technicalName || '';
  var native = nativeObject(offer && offer.webos), ids = providerApp(provider), app = null;
  // Copy only a content target, never arbitrary source-supplied launch fields.
  if (native && Object.prototype.hasOwnProperty.call(installed, native.id)) app = installed[native.id];
  if (!app) for (var i = 0; i < ids.length; i++) if (installed[ids[i]]) { app = installed[ids[i]]; break; }
  if (!app) return null;
  var target = native && native.params && typeof native.params.contentTarget === 'string' ? native.params.contentTarget : '';
  var web = httpUrl(offer.standardWebURL);
  if (app.id === 'youtube.leanback.v4') {
    // Cobalt's running app ignores the catalogue's /tv#/watch URL. Its query
    // form switches from a playing film to the requested video on webOS 9.2.
    var youtube = videoUrl(target, 'youtube\\.com') || videoUrl(web, 'youtube\\.com');
    var video = /[?&]v=([a-zA-Z0-9_-]{11})(?:[&#]|$)/.exec(youtube);
    target = video ? 'v=' + video[1] : /^v=[a-zA-Z0-9_-]{11}$/.test(target) ? target : '';
  }
  if (!target && app.id === 'com.disney.disneyplus-prod') {
    var play = null;
    [offer.tvos, offer.ios, offer.android].some(function (value) {
      play = /disneyplus\.com\/play\/([a-f0-9-]{36})/i.exec(value || '');
      return !!play;
    });
    if (play) target = 'page=play&id=' + play[1] + '&distributionPartner=lg';
  }
  if (!target && app.id === 'bbc.iplayer.3.0') { if (videoUrl(web, 'bbc\\.co\\.uk') && /\/iplayer\/episode\/[a-z0-9]+/i.test(web)) target = web; }
  if (!target && app.id === 'com.fvp.itv') { target = videoUrl(web, 'itv\\.com'); }
  if (!target && app.id === 'com.fvp.ch4') { target = videoUrl(web, 'channel4\\.com'); }
  if (!target && app.id === 'demand5') { target = videoUrl(web, 'my5\\.tv') || videoUrl(web, 'channel5\\.com'); }
  // Availability URLs are not a generic TV launch format. Missing platform
  // links stay unavailable until an app-specific route has been verified.
  if (!target || target.length > 4096 || /[\x00-\x1f]/.test(target)) return { app: app, unavailable: true };
  return { app: app, value: target, web: web, quality: offer.presentationType || '' };
}
function quality(t) { return /4K|UHD/i.test(t.quality) ? 3 : /HD/i.test(t.quality) ? 2 : 1; }
function text(v) {
  return String(v || '').replace(/<[^>]*>/g, '').replace(/&(?:amp|quot|apos|#39|lt|gt);/g, function (s) {
    return { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&lt;': '<', '&gt;': '>' }[s];
  }).replace(/&#(x[0-9a-f]+|\d+);/gi, function (_, n) {
    var code = n.charAt(0).toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : parseInt(n, 10);
    return code > 0 && code <= 65535 ? String.fromCharCode(code) : '';
  });
}
function resolve(targets, title, country, fetch, cb) {
  var unique = [], finished = false, handle = null, timer = null;
  function finish(err, target) {
    if (finished) return;
    finished = true; clearTimeout(timer);
    if (handle && handle.cancel) handle.cancel();
    cb(err, target);
  }
  var control = { cancel: function () { finish(new Error('cancelled')); } };
  targets.forEach(function (t) { if (!unique.some(function (k) { return k.value === t.value; })) unique.push(t); });
  unique.sort(function (a, b) { return quality(b) - quality(a); });
  if (!unique.length) { finish(new Error(msg('srv.home.searchNoLink', 'No verified title link is available for this app.'))); return control; }
  if (unique.length === 1 || unique[0].app.id !== 'netflix') { finish(null, unique[0]); return control; }
  // JustWatch groups the VHS edition with the main series. Its ordering and
  // season counts cannot distinguish them; Netflix's first h1 names the target.
  var candidates = unique.slice(), prefix = country + '|' + words(title) + '|';
  timer = setTimeout(function () { finish(new Error(msg('srv.home.searchEdition', 'The app returned different editions and the title link could not be confirmed.'))); }, 12000);
  function next() {
    if (finished) return;
    var target = candidates.shift();
    if (!target) return finish(new Error(msg('srv.home.searchEdition', 'The app returned different editions and the title link could not be confirmed.')));
    var id = /\/title\/(\d+)/.exec(target.web) || /movies%2[fF](\d+)/.exec(target.value);
    if (!id) return next();
    var key = prefix + id[1], cached = verified[key];
    if (cached && Date.now() - cached.at < 6 * 3600000) return cached.ok ? finish(null, target) : next();
    handle = fetch.getText('https://www.netflix.com/' + country.toLowerCase() + '/title/' + id[1], function (err, body) {
      if (finished) return;
      handle = null;
      var heading = !err && /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(body || '');
      if (!heading) return next();
      var ok = words(text(heading[1])) === words(title);
      verified[key] = { at: Date.now(), ok: ok };
      if (Object.keys(verified).length > 100) verified = {};
      if (ok) finish(null, target); else next();
    });
  }
  next();
  return control;
}
function launch(target) {
  // applicationManager applies the installed app's template, including its
  // handledBy field, which varies between regional apps.
  return { id: target.app.id, replaceParams: { deeplinkingParams: { target: '$CONTENTID', value: target.value } } };
}
module.exports = { candidate: candidate, resolve: resolve, launch: launch };
