/* An idle screen saver refused by panel care is asked for again without its hold. ES5. */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var now = 1000000, timers = [];
function load() {
  var moduleMock = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/lib/idlesaver.js'), 'utf8'), {
    module: moduleMock,
    console: { log: function () {} },
    Date: { now: function () { return now; } },
    setTimeout: function (fn, ms) { timers.push({ fn: fn, at: now + ms }); }
  });
  return moduleMock.exports;
}
function advance(ms) {
  now += ms;
  var due = timers.filter(function (t) { return t.at <= now; });
  timers = timers.filter(function (t) { return t.at > now; });
  due.forEach(function (t) { t.fn(); });
}

var calls, foreground, powerState, setReply, media;
function reset() {
  calls = []; foreground = 'com.webos.app.home'; powerState = 'Screen Saver';
  setReply = { returnValue: true }; media = { state: 'idle', fullScreen: false };
}
function luna(uri, params, cb) {
  calls.push({ uri: uri, params: params });
  if (/getForegroundAppInfo$/.test(uri)) return cb({ returnValue: true, appId: foreground });
  if (/setEplAppInfo$/.test(uri)) return cb(setReply);
  if (/getPowerState$/.test(uri)) return cb({ returnValue: true, state: powerState });
  cb({ returnValue: true });
}
function policies() {
  // Through JSON, as objects made in the module's context have its prototypes.
  return JSON.parse(JSON.stringify(calls.filter(function (c) { return /setEplAppInfo$/.test(c.uri); }).map(function (c) { return c.params; })));
}
function requests() {
  return calls.filter(function (c) { return /turnOnScreenSaver$/.test(c.uri); }).length;
}
function refusal(saver) {
  saver.powerReply({ returnValue: true, state: 'Active', processing: 'Request Screen Saver' });
  saver.powerReply({ returnValue: true, state: 'Active', processing: 'Screen On' });
  saver.powerReply({ returnValue: true, state: 'Active' });
}
function start() {
  reset();
  var saver = load();
  saver.init({ luna: luna, mediaState: function (cb) { cb(media); } });
  return saver;
}

// Refused idle request: lifted for the app in front and asked again; put back when it closes.
var saver = start();
refusal(saver);
assert.deepStrictEqual(policies(), [{ appId: 'com.webos.app.home', supportScreenSaverPolicy: true, screenSaverDelay: 1 }]);
assert.strictEqual(requests(), 1);
advance(1500);
saver.powerReply({ returnValue: true, state: 'Screen Saver' });
assert.strictEqual(policies().length, 1);
saver.powerReply({ returnValue: true, state: 'Active' });
assert.deepStrictEqual(policies()[1], { appId: 'com.webos.app.home', supportScreenSaverPolicy: false });

// The refusal of its own request is not an idle one.
refusal(saver);
assert.strictEqual(requests(), 1);

// Another app in front by the time it closes: screenmanager has handed that one over.
saver = start();
refusal(saver);
advance(1500);
saver.powerReply({ returnValue: true, state: 'Screen Saver' });
foreground = 'youtube.leanback.v4';
saver.powerReply({ returnValue: true, state: 'Active' });
assert.strictEqual(policies().length, 1);

// Still refused, by another service: put back at once.
saver = start();
powerState = 'Active';
refusal(saver);
advance(1500);
assert.deepStrictEqual(policies()[1], { appId: 'com.webos.app.home', supportScreenSaverPolicy: false });

// Playing, or the playback state unknown: left alone.
saver = start();
media = { state: 'playing', fullScreen: true };
refusal(saver);
media = null;
advance(10000);
refusal(saver);
assert.strictEqual(calls.length, 0);

// No setEplAppInfo on this TV: asked once, then never again.
saver = start();
setReply = { returnValue: false, errorText: 'Unknown method "setEplAppInfo" for category "/"' };
refusal(saver);
advance(10000);
refusal(saver);
assert.strictEqual(policies().length, 1);
assert.strictEqual(requests(), 0);

// A slow "Screen On" is a screen saver that closed, not a refusal.
saver = start();
saver.powerReply({ returnValue: true, state: 'Active', processing: 'Request Screen Saver' });
advance(3000);
saver.powerReply({ returnValue: true, state: 'Active', processing: 'Screen On' });
assert.strictEqual(calls.length, 0);

console.log('ALL test-idlesaver.js assertions passed!');
