/* JustWatch title search and local webOS launches. Strict ES5 for node 0.10. */
var msg = require('./say').msg;
var links = require('./home-search-links');
var ENDPOINT = 'https://apis.justwatch.com/graphql';
var SEARCH_TIMEOUT_MS = 10000, CACHE_MS = 60000, RESULT_MS = 30 * 60000;
var lunaFn = null;
/** @type {typeof import('./fetch')} */
var fetchLib = null;
var appsFn = null, enabledFn = null, countryFn = null, openedFn = null;
var current = null, generation = 0, epoch = 0, opening = null;
var listed = {}, cache = {}, localeCache = null, localeAt = 0, localeWaiters = null;

function init(opts) {
  opts = opts || {};
  invalidate();
  lunaFn = opts.luna || null;
  fetchLib = opts.fetch || null;
  appsFn = opts.apps || function (cb) { cb([]); };
  enabledFn = opts.enabled || function () { return true; };
  countryFn = opts.country || function () { return ''; };
  openedFn = opts.opened || function () {};
  cache = {}; localeCache = null; localeAt = 0;
}
function luna(uri, body, cb) { if (!lunaFn) return cb(null); lunaFn(uri, body, function (r) { cb(r || null); }); }
function failure(error) { return { ok: false, error: error && error.message || msg('srv.home.searchFailed', 'JustWatch did not answer. Check the TV is online and try again.') }; }
function off() { return { ok: false, error: msg('srv.home.searchOff', 'Search is switched off in Glasshouse Home settings.') }; }
function normalCountry(v) { v = String(v || '').trim().toUpperCase(); return v === 'UK' ? 'GB' : v; }

function request(query, variables, cb) {
  if (!fetchLib) { cb(new Error('no HTTP transport')); return null; }
  return fetchLib.postJson(ENDPOINT, { query: query, variables: variables || {} }, function (err, doc) {
    if (err) return cb(err);
    if (!doc || (doc.errors && doc.errors.length) || !doc.data) return cb(new Error(msg('srv.home.searchProviderError', 'JustWatch could not answer this request. The selected country may not be supported.')));
    cb(null, doc.data);
  });
}
function countries(cb) {
  if (localeCache && Date.now() - localeAt < 24 * 3600000) return cb({ ok: true, countries: localeCache });
  if (localeWaiters) { localeWaiters.push(cb); return; }
  localeWaiters = [cb];
  var ended = false, handle = null;
  var timer = setTimeout(function () { finish(new Error(msg('srv.home.searchFailed', 'JustWatch did not answer. Check the TV is online and try again.'))); }, SEARCH_TIMEOUT_MS);
  function finish(err, data) {
    if (ended) return;
    ended = true; clearTimeout(timer);
    if (handle && handle.cancel) handle.cancel();
    var out = [], seen = {};
    if (!err && data && Array.isArray(data.locales)) data.locales.forEach(function (row) {
      if (!row || typeof row.country !== 'string') return;
      var code = normalCountry(row.country);
      if (!/^[A-Z]{2}$/.test(code) || seen[code]) return;
      seen[code] = true; out.push({ code: code, name: String(row.countryName || code) });
    });
    if (!err && !out.length) err = new Error('empty country list');
    if (!err) { localeCache = out; localeAt = Date.now(); }
    var waiting = localeWaiters; localeWaiters = null;
    waiting.forEach(function (done) { done(err ? failure(err) : { ok: true, countries: out }); });
  }
  handle = request('{ locales { country countryName(language: en) } }', null, finish);
}
function context(cb) {
  var override = normalCountry(countryFn());
  function validate(value) {
    var country = normalCountry(value);
    if (!/^[A-Z]{2}$/.test(country)) return cb(new Error(msg('srv.home.searchCountryUnknown', 'The TV did not report its LG Apps country. Choose a search country on the Home tab.')));
    countries(function (r) {
      if (!r.ok) return cb(new Error(r.error));
      if (!r.countries.some(function (c) { return c.code === country; })) return cb(new Error(msg('srv.home.searchCountryUnsupported', 'JustWatch does not support the selected country ({country}).', { country: country })));
      cb(null, { country: country, key: country + '|en', epoch: epoch });
    });
  }
  if (override) return validate(override);
  luna('com.webos.service.settings/getSystemSettings', { category: 'option', keys: ['smartServiceCountryCode2'] }, function (r) {
    validate(r && r.returnValue !== false && r.settings && r.settings.smartServiceCountryCode2);
  });
}
function stopCurrent() {
  if (!current) return;
  var mine = current; current = null; clearTimeout(mine.timer);
  if (mine.handle && mine.handle.cancel) mine.handle.cancel();
}
function invalidate() {
  epoch++; listed = {};
  if (current) { var cb = current.cb; stopCurrent(); cb({ ok: false, superseded: true }); }
  if (opening) opening.cancel();
}
function words(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9\u00c0-\uffff]+/g, ' ').trim(); }
var PROMO = /\b(trailers?|teasers?|sneak peeks?|previews?|first look)\b/i;
var PROMO_PLACED = /\b(trailers?|teasers?|sneak peeks?|previews?|first look)\s*\d*\s*(\)\s*)?($|[:\-\u2013\u2014])/i;
function isTrailer(title, minutes) { return PROMO.test(title) && (typeof minutes === 'number' && minutes > 0 ? minutes <= 15 : PROMO_PLACED.test(title)); }
function query(country) {
  return 'query Search($text: String!) { popularTitles(country: ' + country + ', first: 24, filter: {searchQuery: $text}) { edges { node { id objectId objectType ' +
    'content(country: ' + country + ', language: en) { title originalReleaseYear fullPath runtime posterUrl(profile: S332, format: JPG) genres { translation(language: en) } ageCertification } ' +
    'offers(country: ' + country + ', platform: WEB) { standardWebURL webos: deeplinkURL(platform: WEBOS) android: deeplinkURL(platform: ANDROID_TV) ' +
    'tvos: deeplinkURL(platform: TVOS) ios: deeplinkURL(platform: IOS) monetizationType presentationType package { clearName technicalName } } } } } }';
}
function find(value, cb) {
  var text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!enabledFn()) return cb(off());
  if (text.length < 2) return cb({ ok: false, error: msg('srv.home.searchShort', 'Type two letters or more.') });
  if (current) { var previous = current.cb; stopCurrent(); previous({ ok: false, superseded: true }); }
  if (opening) opening.cancel();
  listed = {};
  var mine = { cb: cb, timer: null, handle: null, epoch: epoch }; current = mine;
  function finish(result) { if (current !== mine) return; stopCurrent(); cb(enabledFn() ? result : off()); }
  mine.timer = setTimeout(function () { finish(failure(null)); }, SEARCH_TIMEOUT_MS);
  context(function (err, ctx) {
    if (current !== mine || mine.epoch !== epoch) return;
    if (err) return finish(failure(err));
    var key = ctx.key + '|' + text.toLowerCase(), hit = cache[key];
    function answer(doc) {
      if (current !== mine) return;
      appsFn(function (apps) { if (current === mine && mine.epoch === epoch) finish(results(text, doc, apps, ctx)); });
    }
    if (hit && Date.now() - hit.at < CACHE_MS) return answer(hit.data);
    mine.handle = request(query(ctx.country), { text: text }, function (error, data) {
      if (current !== mine) return;
      if (error) return finish(failure(error));
      if (!data.popularTitles || !Array.isArray(data.popularTitles.edges)) return finish(failure(null));
      if (Object.keys(cache).length >= 20) cache = {};
      cache[key] = { at: Date.now(), data: data }; answer(data);
    });
  });
}
function results(text, doc, apps, ctx) {
  var installed = {}, out = [], elsewhere = 0, unavailable = 0, gen = ++generation;
  (apps || []).forEach(function (app) { installed[app.id] = app; }); listed = {};
  doc.popularTitles.edges.forEach(function (edge) {
    var node = edge && edge.node, content = node && node.content;
    if (!node || !content || typeof content.title !== 'string' || ['MOVIE', 'SHOW'].indexOf(node.objectType) === -1 || isTrailer(content.title, content.runtime)) return;
    var byApp = {}, missing = {};
    (Array.isArray(node.offers) ? node.offers : []).forEach(function (offer) {
      if (!offer || /BLURAY|DVD/i.test(offer.presentationType || '') || offer.monetizationType === 'CINEMA') return;
      var target = links.candidate(offer, installed); if (!target) return;
      if (target.unavailable) { missing[target.app.id] = target.app.title; return; }
      if (!byApp[target.app.id]) byApp[target.app.id] = [];
      byApp[target.app.id].push(target);
    });
    var appIds = Object.keys(byApp);
    if (!appIds.length) { if (Object.keys(missing).length) unavailable++; else elsewhere++; return; }
    var id = gen + '.' + out.length; listed[id] = { apps: byApp, title: content.title, context: ctx, at: Date.now() };
    var fullPath = /^\/[a-z]{2}\//.test(content.fullPath || '') ? content.fullPath : '';
    out.push({ id: id, title: content.title, kind: node.objectType === 'MOVIE' ? 'film' : 'series', year: content.originalReleaseYear || null,
      minutes: content.runtime || null, genre: (Array.isArray(content.genres) ? content.genres : []).map(function (g) { return g && g.translation; }).filter(Boolean).join(', '),
      rating: content.ageCertification || '', poster: /^\/poster\//.test(content.posterUrl || '') ? 'https://images.justwatch.com' + content.posterUrl : '',
      source: fullPath ? 'https://www.justwatch.com' + fullPath : '',
      unavailableApps: Object.keys(missing).filter(function (appId) { return !byApp[appId]; }).map(function (appId) { return missing[appId]; }),
      apps: appIds.map(function (appId) { var app = installed[appId]; return { id: app.id, title: app.title, icon: app.icon ? '/api/home/icon?id=' + encodeURIComponent(app.id) : null }; }) });
  });
  var needle = words(text);
  out.sort(function (a, b) { return (words(b.title) === needle ? 1 : 0) - (words(a.title) === needle ? 1 : 0); });
  return { ok: true, query: text, country: ctx.country, results: out, elsewhere: elsewhere, unavailable: unavailable };
}
function open(body, cb) {
  var id = body && typeof body.id === 'string' ? body.id : '', appId = body && typeof body.app === 'string' ? body.app : '';
  if (!enabledFn()) return cb(off());
  var record = listed[id];
  function stale() { return !enabledFn() || listed[id] !== record || record.context.epoch !== epoch || Date.now() - record.at > RESULT_MS; }
  if (!record || !record.apps[appId] || stale()) return cb({ ok: false, error: msg('srv.home.searchGone', 'That title is no longer in the current results. Search again.') });
  if (opening) return cb({ ok: false, error: msg('srv.home.searchOpening', 'A title is already opening.') });
  var mine = { handle: null, timer: null, cancel: null }; opening = mine;
  function done(result) {
    if (opening !== mine) return;
    opening = null; clearTimeout(mine.timer);
    if (mine.handle && mine.handle.cancel) mine.handle.cancel();
    cb(result);
  }
  mine.cancel = function () { done({ ok: false, superseded: true }); };
  mine.timer = setTimeout(function () { done(failure(null)); }, 18000);
  context(function (err, ctx) {
    if (opening !== mine) return;
    if (err) return done(failure(err));
    if (stale() || ctx.key !== record.context.key) return changed();
    mine.handle = links.resolve(record.apps[appId], record.title, ctx.country, fetchLib, function (error, target) {
      if (opening !== mine) return;
      if (error) return done(failure(error));
      // The TV's service country may change while a provider page is checked.
      context(function (countryError, latest) {
        if (opening !== mine) return;
        if (countryError) return done(failure(countryError));
        if (stale() || latest.key !== record.context.key) return changed();
        luna('com.webos.applicationManager/launch', links.launch(target), function (r) {
          if (opening !== mine) return;
          if (!r || r.returnValue !== true) return done({ ok: false, error: msg('srv.home.launchRefused', 'the TV would not open it') });
          openedFn(appId); done({ ok: true });
        });
      });
    });
  });
  function changed() {
    epoch++; listed = {};
    done({ ok: false, error: msg('srv.home.searchCountryChanged', 'The search country changed. Search again before opening a title.') });
  }
}
module.exports = { init: init, find: find, open: open, countries: countries, invalidate: invalidate };
