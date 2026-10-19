/*
 * lib/home-recent-apps.js - the recent apps panel Back opens on Glasshouse
 * Home, in place of the one inside LG's Home (lib/home)
 *
 * LG's panel is a view of its own Home app with no way in from outside, so
 * Glasshouse draws its own from the same source: the surface manager's
 * com.webos.service.recent, newest first, with each app's snapshot. Its
 * removeRecent and removeAllRecents close the apps they remove on a G3
 * (webOS 9.2.2) but only take them off the list on a G5 (webOS 10.3.1), so an
 * app still running afterwards is closed through the application manager.
 * Apps kept running in the background without a card (YouTube, the browser)
 * are not on the list.
 *
 * Strict ES5: runs on node 0.12.
 */
var msg = require('./say').msg;

var SERVICE = 'com.webos.service.recent/';
// The view and the app it runs as are never offered.
var LEFT_OUT = ['com.webos.app.home', 'com.tvweb.home'];
var IMAGE_RE = /\.(jpe?g|png)$/i;

var lunaFn = null;
// appId to image path, from the last list: only those are served.
var images = {};

function init(opts) {
  opts = opts || {};
  lunaFn = opts.luna || null;
  images = {};
}

function luna(uri, payload, cb) {
  if (!lunaFn) return cb(null);
  lunaFn(uri, payload, function (r) { cb(r || null); });
}

function list(cb) {
  luna(SERVICE + 'listRecents', {}, function (r) {
    if (!r || r.returnValue === false || Object.prototype.toString.call(r.recentsAppList) !== '[object Array]') {
      return cb({ ok: false, error: msg('srv.home.recentsUnavailable', 'the TV did not list its recent apps') });
    }
    var apps = [], seen = {};
    images = {};
    r.recentsAppList.forEach(function (a) {
      var id = a && typeof a.appId === 'string' ? a.appId : '';
      if (!id || seen[id] || LEFT_OUT.indexOf(id) !== -1) return;
      seen[id] = true;
      // Netflix names a picture of its own; the others have the snapshot taken
      // as they were left. Snapshots are in /tmp, so an app left before the TV
      // restarted has none, and shows its splash.
      var image = [a.customImageFilePath, a.cardSnapShotFilePath, a.splashBackground].filter(function (p) {
        return typeof p === 'string' && p.charAt(0) === '/' && IMAGE_RE.test(p);
      })[0];
      if (image) images[id] = image;
      apps.push({ id: id, title: String(a.title || id), image: !!image });
    });
    cb({ ok: true, apps: apps });
  });
}

function imagePath(id) {
  return typeof id === 'string' && images.hasOwnProperty(id) ? images[id] : null;
}

// Only an app on the list now can be opened or closed through it.
function listed(id, cb) {
  list(function (r) {
    if (!r.ok) return cb(r);
    var known = r.apps.some(function (a) { return a.id === id; });
    cb(known ? { ok: true } : { ok: false, error: msg('srv.home.notRecent', 'that app is not in recent apps') });
  });
}

function open(id, cb) {
  listed(id, function (r) {
    if (!r.ok) return cb(r);
    luna('com.webos.applicationManager/launch', { id: id }, function (l) {
      cb(l && l.returnValue ? { ok: true } : { ok: false, error: msg('srv.home.launchRefused', 'the TV would not open it') });
    });
  });
}

function close(id, cb) {
  listed(id, function (r) {
    if (!r.ok) return cb(r);
    luna(SERVICE + 'removeRecent', { appId: id }, done([id], cb));
  });
}

function closeAll(cb) {
  list(function (r) {
    if (!r.ok) return cb(r);
    var ids = r.apps.map(function (a) { return a.id; });
    luna(SERVICE + 'removeAllRecents', {}, done(ids, cb));
  });
}

// Once removed, closes those of ids still running, then answers with the list.
function done(ids, cb) {
  return function (r) {
    if (!r || r.returnValue === false) return cb({ ok: false, error: msg('srv.home.closeRefused', 'the TV would not close it') });
    luna('com.webos.applicationManager/running', {}, function (run) {
      var running = (run && run.running || []).map(function (a) { return a && a.id; });
      var left = ids.filter(function (id) { return running.indexOf(id) !== -1; });
      (function next() {
        if (!left.length) return list(cb);
        luna('com.webos.applicationManager/closeByAppId', { id: left.shift() }, next);
      })();
    });
  };
}

module.exports = {
  init: init,
  list: list,
  imagePath: imagePath,
  open: open,
  close: close,
  closeAll: closeAll
};
