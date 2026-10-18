/*
 * LG's idle screen saver where the panel care service holds it back.
 *
 * tvpower asks the services registered for it before it starts a screen
 * saver. On a G3 (webOS 9.2.2) eplmanager (com.webos.service.oledepl) refuses
 * for 30 minutes after every key press and every change of app, while it dims
 * the static parts of the picture itself: screenmanager hands it each app in
 * front with supportScreenSaverPolicy false, and for those the hold is a
 * fixed 30 minutes. LG's idle timer asks every 3 minutes and is refused each
 * time. An app handed over with the policy on and a screenSaverDelay of 3
 * minutes or less is not held at all.
 *
 * So when an idle request is refused, the app in front is handed over that
 * way and the request made again. screenmanager's setting is put back when
 * the screen saver closes, or at once if the request is still refused, so the
 * dimming goes on while the TV is watched. The other services that can
 * refuse one still do.
 *
 * Strict ES5 for Node 0.12.2 on webOS 4.
 */

var SET_APP_INFO = 'com.webos.service.oledepl/setEplAppInfo';
var POWER = 'com.webos.service.tvpower/power/';
// eplmanager starts no hold for 3 minutes or less, and reads 0 as not set.
var NO_HOLD_DELAY = 1;
// A refusing service turns "Request Screen Saver" into "Screen On" within
// 10 to 30 ms (G3).
var REFUSAL_MS = 2000;
// A request made here, by the dashboard or by this module, is refused or
// shown by then; its refusal is not an idle one.
var OWN_REQUEST_MS = 5000;

var lunaFn = null;
/** @type {function(function(?{state: string, fullScreen: boolean}): void, boolean=): void} */
var mediaStateFn = function (cb) { cb(null); };
var requestSeenAt = 0;
var ownRequestAt = 0;
var lastState = '';
// The app handed over without a hold, until screenmanager's setting is back.
var liftedApp = '';
// No setEplAppInfo on this TV: nothing to lift.
var unsupported = false;

function init(opts) {
  opts = opts || {};
  lunaFn = opts.luna;
  mediaStateFn = opts.mediaState || function (cb) { cb(null); };
}

function foregroundApp(cb) {
  lunaFn('com.webos.applicationManager/getForegroundAppInfo', {}, function (fg) {
    cb(fg && fg.returnValue !== false && fg.appId ? String(fg.appId) : '');
  });
}

function setPolicy(appId, lifted, cb) {
  var params = lifted
    ? { appId: appId, supportScreenSaverPolicy: true, screenSaverDelay: NO_HOLD_DELAY }
    : { appId: appId, supportScreenSaverPolicy: false };
  lunaFn(SET_APP_INFO, params, function (r) {
    var ok = !!(r && r.returnValue);
    if (!ok && /unknown method|service does not exist/i.test(String((r && r.errorText) || ''))) unsupported = true;
    cb(ok);
  });
}

/*
 * Hands the app in front to eplmanager without a hold, ahead of a screen
 * saver request. cb(true) once it has taken it.
 */
function lift(cb) {
  ownRequestAt = Date.now();
  if (!lunaFn || unsupported) return cb(false);
  foregroundApp(function (appId) {
    if (!appId) return cb(false);
    setPolicy(appId, true, function (ok) {
      if (ok) liftedApp = appId;
      cb(ok);
    });
  });
}

// Puts screenmanager's setting back, unless another app has come to the front
// since, which screenmanager has handed over itself.
function restore() {
  var appId = liftedApp;
  if (!appId || !lunaFn) return;
  liftedApp = '';
  foregroundApp(function (current) {
    if (current !== appId) return;
    setPolicy(appId, false, function (ok) {
      if (ok) console.log('idlesaver: panel care holds the screen saver again for ' + appId);
    });
  });
}

function idleRequestRefused() {
  mediaStateFn(function (media) {
    // Playback refuses a screen saver for its own reasons.
    if (!media || media.state === 'playing') return;
    lift(function (ok) {
      if (!ok) return;
      console.log('idlesaver: panel care refused the idle screen saver; asking again without its hold on ' + liftedApp);
      lunaFn(POWER + 'turnOnScreenSaver', {}, function () {
        setTimeout(function () {
          lunaFn(POWER + 'getPowerState', {}, function (pw) {
            if (!pw || pw.state !== 'Screen Saver') restore();
          });
        }, 1500);
      });
    });
  }, true);
}

// Every reply of the power state subscription, "processing" steps included.
function powerReply(response) {
  var state = response && response.state;
  if (!state) return;
  var wasScreenSaver = lastState === 'Screen Saver';
  lastState = state;
  if (response.processing === 'Request Screen Saver') {
    requestSeenAt = Date.now();
    return;
  }
  if (state === 'Screen Saver') {
    requestSeenAt = 0;
    return;
  }
  if (wasScreenSaver) restore();
  var refused = requestSeenAt && response.processing === 'Screen On' && state === 'Active' &&
    Date.now() - requestSeenAt < REFUSAL_MS;
  if (!refused) return;
  requestSeenAt = 0;
  if (!lunaFn || unsupported || Date.now() - ownRequestAt < OWN_REQUEST_MS) return;
  idleRequestRefused();
}

module.exports = {
  init: init,
  lift: lift,
  restore: restore,
  powerReply: powerReply
};
