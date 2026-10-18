/**
 * test/test-screensaver-dropped.js - Start screensaver where tvpower accepts
 * the request and then drops it, as a G3 on webOS 9.2.2 does: the app is
 * launched instead, reported as showing, and the next press closes it
 *
 * Strict ES5: runs on node 0.12.
 */

var assert = require('assert');
var screensavers = require('../server/lib/screensavers');

console.log('Running test-screensaver-dropped.js ...');

var realLog = console.log;
console.log = function () {};

// tvpower answers true and goes back to Active, unless startsItself.
function tv(startsItself, playing) {
  var state = { requested: false, launched: 0, closed: 0, running: false };
  state.luna = function (uri, params, cb) {
    if (uri === 'com.webos.service.tvpower/power/getPowerState') {
      return cb({ returnValue: true, state: startsItself && state.requested ? 'Screen Saver' : 'Active' });
    }
    if (uri === 'com.webos.applicationManager/getForegroundAppInfo') return cb({ returnValue: true, appId: 'com.webos.app.home' });
    if (uri === 'com.webos.applicationManager/getAppInfo') return cb({ returnValue: true, appInfo: { id: params.id } });
    if (uri === 'com.webos.service.tvpower/power/turnOnScreenSaver') { state.requested = true; return cb({ returnValue: true }); }
    if (uri === 'com.webos.applicationManager/launch') { state.launched++; state.running = true; return cb({ returnValue: true }); }
    if (uri === 'com.webos.applicationManager/closeByAppId') { state.closed++; state.running = false; return cb({ returnValue: true }); }
    if (uri === 'com.webos.applicationManager/running') {
      return cb({ returnValue: true, running: state.running ? [{ id: 'com.webos.app.screensaver' }] : [] });
    }
    cb({ returnValue: true });
  };
  screensavers.init({ luna: state.luna, assetPath: null, config: {}, injectKey: function (k, cb) { cb(true); }, KEY_BACK: 412,
                      inputKey: function (id) { return id; },
                      mediaState: function (cb) { cb(playing ? { state: 'playing', fullScreen: true } : { state: 'idle', fullScreen: false }); } });
  return state;
}

var dropped = tv(false);
screensavers.trigger(function (r) {
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(dropped.launched, 1, 'the app is launched when tvpower drops the request');
  assert.strictEqual(screensavers.launchedShowing(), true, 'and reported as showing');
  realLog('  ✓ a dropped request launches the screen saver app');

  screensavers.trigger(function (r2) {
    assert.strictEqual(r2.ok, true, r2.error);
    assert.strictEqual(dropped.closed, 1, 'the next press closes it');
    assert.strictEqual(screensavers.launchedShowing(), false);
    realLog('  ✓ the next press closes it');

    // Closed by the remote: the next press starts one rather than closing.
    screensavers.trigger(function () {
      dropped.running = false;
      screensavers.launchedShowing();
      assert.strictEqual(screensavers.launchedShowing(), false, 'cleared once sam no longer runs it');
      realLog('  ✓ one closed by the remote is no longer reported');

      var own = tv(true);
      screensavers.trigger(function (r3) {
        assert.strictEqual(r3.ok, true, r3.error);
        assert.strictEqual(own.launched, 0, 'nothing is launched where tvpower starts it');
        assert.strictEqual(screensavers.launchedShowing(), false);
        realLog('  ✓ a screen saver tvpower starts itself is left to it');

        var film = tv(false, true);
        screensavers.trigger(function (r4) {
          assert.strictEqual(r4.ok, false);
          assert.ok(/playing/.test(r4.error), r4.error);
          assert.strictEqual(film.launched, 0, 'nothing is launched over playback');
          realLog('  ✓ a refusal over full-screen playback stands');
          console.log = realLog;
          console.log('ALL test-screensaver-dropped.js assertions passed!\n');
        });
      });
    });
  });
});
