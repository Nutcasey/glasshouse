/* Audio declarations, the active return channel, and a pinned DTS helper.
 * Strict ES5 for the TV's Node 0.10/0.12 runtime. */
var fs = require('fs');
var os = require('os');
var crypto = require('crypto');
var child = require('child_process');
var children = require('./children');
var util = require('./util');
var names = require('./names');
var msg = require('./say').msg;
var luna = null;
var cached = null;
var clearCache = function () {};
var receiverMap = null;
var changing = false;
var decoderCache = null;
var decoderAt = 0;
var decoderWaiters = null;
var BASE = '/var/lib/lg-dts-core/';
var PROFILE = {
  model: 'OLED77G5RLA', firmware: '33.30.80', kernel: '5.4.268-329.ptl4tv.5', input: 3,
  revision: 'ac5f3e3e1d7f034ad1f35c43ae7c722aeae798ae',
  // Runtime files from the upstream prebuilt package at the pinned revision.
  files: {
    'control.sh': '93b42fc41c5b61fa5d469d4e5a3fa9f2a6deace538efa212b0f6b4341f9306da',
    'watch.sh': '8c202469c97e796a561b18e2c03f7ac0eb06f050f5fb31515317b01f4aa7d931',
    'run-on-tv.sh': '88c6dd4592ed2850ee85df06c15c322e94b45a81221883815c465cad050a3889',
    'lg-dts-core.service': '81924d46322692d0701e443bd8588cf4f9f527ce622149d12784f7ae00efbfcd',
    '90-lg-dts-core': '9482be2b885dc7e9b73791808666afc2904be056498992bc7ae8920e5f1a2497',
    'config-override.py': '05c7d9d4817bb02449b093d8be51eb7218d4577447ae2375b2ed14b0409c06c5',
    'dts_gate.ko': '8db00c1ae49a03cb13985b30d8c35c3a72385ead3dbd5871005229a2e4093246',
    'dts_core_route.ko': '0042c2bd84d7705518d71c80c04acfc7b8dc8c1399be44d00a91eaa15c10d5ac',
    'hd/dts_gate.ko': '8db00c1ae49a03cb13985b30d8c35c3a72385ead3dbd5871005229a2e4093246',
    'hd/dts_core_route.ko': 'e91155f03c47f70f9868ace1a8bf61d07288da83a50de837c5dbab90372aaba0',
    'hd/run-on-tv.sh': '8b51aa182f1330e4b74d5d3c9e6fa145f335860d2416ad351f5bdc5fe10717aa'
  }
};
var FORMATS = [
  { id: 'pcm', label: 'PCM', sad: 1, aliases: ['PCM', 'LPCM'] },
  { id: 'ac3', label: 'Dolby Digital', sad: 2, aliases: ['AC3'] },
  { id: 'eac3', label: 'Dolby Digital Plus', sad: 10, aliases: ['EAC3'] },
  { id: 'mat', label: 'Dolby TrueHD / MAT', sad: 12, aliases: ['TRUEHD', 'MLP'] },
  { id: 'dts', label: 'DTS', sad: 7, aliases: ['DTS'] },
  { id: 'dtshd', label: 'DTS-HD', sad: 11, aliases: ['DTSH'] },
  { id: 'dtsx', label: 'DTS:X', sad: null, aliases: ['DTSX'] }
];

function sectionValues(text) {
  /** @type {Object.<string, any>} */
  var out = { '': {} };
  var section = '';
  String(text || '').split(/\r?\n/).forEach(function (line) {
    var heading = /^\[([^\]]+)\]$/.exec(line.trim());
    if (heading) { section = heading[1]; out[section] = {}; return; }
    var pair = /^([^=]+)=(.*)$/.exec(line);
    if (pair) out[section][pair[1].trim()] = pair[2].trim();
  });
  return out;
}

// SAD strings can include CTA's audio-block header, or be bare triplets.
function sads(text) {
  if (typeof text !== 'string' || !/^[\da-f\s,:]+$/i.test(text)) return null;
  var hex = text.replace(/[\s,:]/g, '');
  if (!hex.length || hex.length % 2) return null;
  var bytes = [];
  for (var i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  if ((bytes[0] >> 5) === 1 && (bytes[0] & 31) === bytes.length - 1) bytes.shift();
  if (!bytes.length || bytes.length % 3) return null;
  var out = {};
  for (i = 0; i < bytes.length; i += 3) {
    var code = (bytes[i] >> 3) & 15;
    if (!code) return null;
    out[code] = Math.max(out[code] || 0, (bytes[i] & 7) + 1);
  }
  return out;
}

// The driver's EDID is what this input actually advertises, including while
// ARC is off. Configd's edidType is only a fallback for its named families.
function inputSads(port, map) {
  if (!port || !map || typeof map[port] !== 'number') return null;
  var raw = util.readTrimmed('/proc/lg/hdmi20/port' + map[port] + '/edid');
  if (!raw) return null;
  var bytes = [];
  raw.split(/\r?\n/).forEach(function (line) {
    var row = /^\[0x[\da-f]+\]\s*\|((?:\s*\[0x[\da-f]{2}\]){16})\s*$/i.exec(line);
    if (row) (row[1].match(/\[0x[\da-f]{2}\]/ig) || []).forEach(function (value) { bytes.push(parseInt(value.slice(3, -1), 16)); });
  });
  var start = -1;
  for (var n = 0; n <= bytes.length - 128; n++) {
    if (bytes.slice(n, n + 8).join(',') === '0,255,255,255,255,255,255,0') { start = n; break; }
  }
  if (start < 0) return null;
  bytes = bytes.slice(start);
  function validBlock(at) {
    if (bytes.length < at + 128) return false;
    var sum = 0;
    for (var i = at; i < at + 128; i++) sum += bytes[i];
    return sum % 256 === 0;
  }
  if (!validBlock(0)) return null;
  var formats = {}, found = false;
  for (n = 1; n <= bytes[126]; n++) {
    var at = n * 128;
    if (!validBlock(at) || bytes[at] !== 2) continue;
    var end = bytes[at + 2] || 4;
    if (end < 4 || end > 127) continue;
    found = true;
    if (bytes[at + 3] & 64) formats[1] = 2;
    for (var pos = 4; pos < end;) {
      var head = bytes[at + pos++], len = head & 31;
      if (pos + len > end) return null;
      if (head >> 5 === 1) {
        if (len % 3) return null;
        for (var j = pos; j < pos + len; j += 3) {
          var code = (bytes[at + j] >> 3) & 15;
          if (code) formats[code] = Math.max(formats[code] || 0, (bytes[at + j] & 7) + 1);
        }
      }
      pos += len;
    }
  }
  return found ? formats : null;
}

function formatId(raw) {
  var key = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return ({ pcm: 'pcm', lpcm: 'pcm', ac3: 'ac3', dolbydigital: 'ac3',
    eac3: 'eac3', ddp: 'eac3', dolbydigitalplus: 'eac3',
    mat: 'mat', truehd: 'mat', dolbytruehd: 'mat', mlp: 'mat',
    dts: 'dts', dtsh: 'dtshd', dtshd: 'dtshd', dtshdma: 'dtshd',
    dtsx: 'dtsx' })[key] || null;
}

function records(value) {
  return Array.isArray(value) ? value.filter(function (x) { return x && typeof x === 'object' && !Array.isArray(x); }) : [];
}

function inspectDts(cb) {
  if (decoderAt && Date.now() - decoderAt < 300000) return cb(decoderCache);
  if (decoderWaiters) { decoderWaiters.push(cb); return; }
  if (!util.existsQuiet('/usr/bin/gst-inspect-1.0')) return cb(null);
  decoderWaiters = [cb];
  children.launch(function () {
    child.execFile('/usr/bin/gst-inspect-1.0', ['dts_audiodec'], { timeout: 3000, maxBuffer: 131072 }, function (err, stdout) {
      // A registered DTS-L-only element is not evidence of a DTS-core decoder.
      var sink = /SINK template:[\s\S]*?(?=Element has|SRC template:|Pads:)/.exec(String(stdout || ''));
      decoderCache = err ? null : !!(sink && /audio\/x-dts(?:\s|$)/m.test(sink[0]));
      decoderAt = Date.now();
      var list = decoderWaiters;
      decoderWaiters = null;
      list.forEach(function (next) { next(decoderCache); });
    });
  });
}

function helperFiles() {
  if (!util.existsQuiet(BASE + 'control.sh')) return { installed: false, verified: false };
  try {
    var manifest = util.readJson(BASE + 'manifest.json', {});
    if (manifest.target !== PROFILE.model + ' ' + PROFILE.firmware || manifest.kernel !== PROFILE.kernel ||
        manifest.input !== 'HDMI3' || manifest.output !== 'eARC') return { installed: true, verified: false };
    for (var file in PROFILE.files) {
      var hash = crypto.createHash('sha256').update(fs.readFileSync(BASE + file)).digest('hex');
      if (hash !== PROFILE.files[file]) return { installed: true, verified: false };
    }
    // enable invokes the installed boot hook, not the copy inside the payload.
    var boot = crypto.createHash('sha256').update(fs.readFileSync('/var/lib/webosbrew/init.d/90-lg-dts-core')).digest('hex');
    return { installed: true, verified: boot === PROFILE.files['90-lg-dts-core'] };
  } catch (e) { return { installed: true, verified: false }; }
}

function helperStatus(identity, cb) {
  var files = helperFiles();
  var matched = identity.model === PROFILE.model && identity.firmware === PROFILE.firmware && identity.kernel === PROFILE.kernel;
  var enabled = util.existsQuiet(BASE + 'enabled');
  var reason = !matched ? msg('srv.audio.override.incompatible', 'No DTS forwarding profile has been validated for this TV and firmware.')
    : !files.installed ? msg('srv.audio.override.missing', 'Install the matching lg-g5-dts helper before enabling the experimental override.')
    : !files.verified ? msg('srv.audio.override.unverified', 'The installed DTS helper does not match the pinned, checked package.') : null;
  var result = { available: matched && files.verified, installed: files.installed, verified: files.verified,
    enabled: enabled, running: null, active: null, busy: changing, reason: reason,
    canDisable: enabled && files.verified, profile: PROFILE.model + ' / ' + PROFILE.firmware,
    input: PROFILE.input, transport: 'eARC', revision: PROFILE.revision };
  if (!files.verified) return cb(result);
  children.launch(function () {
    child.execFile('/bin/systemctl', ['is-active', 'lg-dts-core.service'], { timeout: 3000, maxBuffer: 4096 }, function (err, stdout) {
      result.running = String(stdout || '').trim() === 'active';
      var hdmi = sectionValues(util.readTrimmed('/proc/lgtv-driver/audio/hdmi'))[''];
      var adec = sectionValues(util.readTrimmed('/proc/lgtv-driver/audio/adec.p1'))[''];
      var sound = sectionValues(util.readTrimmed('/proc/lgtv-driver/audio/sndout'));
      var graph = util.readTrimmed('/proc/aaudio/dot_block_connection') || '';
      result.active = result.running && /^(Y|1)$/i.test(util.readTrimmed('/sys/module/dts_core_route/parameters/enable') || '') &&
        hdmi.AudioData === '1' && /^(DTS|DTS_HD)$/.test(hdmi.Codec || '') &&
        adec.Start === '1' && adec.Connect === 'HDMI_PORT2' && sound.EARC && sound.EARC.EArcOnOff === 'On' &&
        /renderer_1_out100\s*->\s*mixer_0_in100/.test(graph) && /mixer_0_out100\s*->\s*output_3_in0/.test(graph);
      result.active = !!result.active;
      result.canDisable = files.verified && (enabled || result.running);
      cb(result);
    });
  });
}

/** @returns {Object.<string, any>} */
function build(replies, decoder) {
  var cfg = replies.config && replies.config.returnValue !== false && replies.config.configs || {};
  var info = replies.identity && replies.identity.returnValue !== false && replies.identity || {};
  var sr = replies.settings && replies.settings.returnValue !== false && replies.settings || {};
  var settings = sr.settings && typeof sr.settings === 'object' ? sr.settings : {};
  var arc = replies.arc && replies.arc.returnValue !== false ? replies.arc : null;
  var edid = replies.edid && replies.edid.returnValue !== false ? replies.edid : null;
  var inputPort = /^hdmi([1-9])$/.exec(String(sr.dimension && sr.dimension.audioInput || ''));
  var port = inputPort ? Number(inputPort[1]) : null;
  var edids = records(edid && edid.edidInfo);
  var chosen = edids.filter(function (x) { return x.inputType === 'hdmi' && x.port === port; })[0];
  var advertised = inputSads(port, replies.receiverMap) || (chosen ? sads(chosen.SADs) : null);
  var edidType = typeof cfg['tv.model.edidType'] === 'string' ? cfg['tv.model.edidType'] : null;
  var knownType = /^(TrueHD|ac3)(\+dts)?$/.test(edidType || '');
  var receiverFormats = null;
  var receiverComplete = true;
  var details = records(arc && arc.advancedEarcCapability);
  if (arc && Array.isArray(arc.advancedEarcCapability) && details.length !== arc.advancedEarcCapability.length) receiverComplete = false;
  var arcActive = arc ? /^(e?arc)$/i.test(String(arc.arcActivation || '')) : false;
  if (arcActive && details.length) {
    receiverFormats = {};
    details.forEach(function (x) {
      var id = formatId(x.audioCodingType);
      if (id) receiverFormats[id] = x.maxChannelNumber || true;
      else receiverComplete = false;
    });
  } else if (arcActive && arc && Array.isArray(arc.earcCapability) && arc.earcCapability.length) {
    receiverFormats = {};
    arc.earcCapability.forEach(function (x) {
      var id = formatId(x);
      if (id) receiverFormats[id] = true;
      else receiverComplete = false;
    });
  }
  if (receiverFormats && !Object.keys(receiverFormats).length) receiverFormats = null;
  var file = util.readJson('/etc/umediaserver/device_codec_capability_config.json', null);
  var declarations = file && Array.isArray(file.audioCodecs) ? records(file.audioCodecs).filter(function (x) { return typeof x.name === 'string' && x.name.length > 0; }) : null;
  var rows = FORMATS.map(function (f) {
    var tv = advertised && f.sad !== null ? !!advertised[f.sad] : null;
    if (tv === null && knownType && f.id === 'dts') tv = /\+dts$/.test(edidType);
    if (tv === null && knownType && f.id === 'mat') tv = /^TrueHD/.test(edidType);
    var declared = declarations ? declarations.filter(function (x) { return f.aliases.indexOf(String(x.name).toUpperCase()) !== -1; }) : [];
    return { id: f.id, name: f.label, advertised: tv,
      receiver: receiverFormats && receiverFormats[f.id] ? true : receiverFormats && receiverComplete ? false : null,
      playback: declarations ? declared.length > 0 : null,
      playbackChannels: declared.length ? declared[0].channels || null : null };
  });
  var sound = sectionValues(util.readTrimmed('/proc/lgtv-driver/audio/sndout'));
  var hdmi = sectionValues(util.readTrimmed('/proc/lgtv-driver/audio/hdmi'))[''];
  var adecs = [0, 1].map(function (n) { return sectionValues(util.readTrimmed('/proc/lgtv-driver/audio/adec.p' + n))['']; });
  var audio = replies.input && replies.input.returnValue !== false && replies.input.audioInputProperty;
  var activeInput = Array.isArray(audio) && audio[0] && audio[0].codec ? audio[0] : null;
  var started = adecs.some(function (a) { return a.Start === '1' && /^HDMI_PORT/.test(a.Connect || ''); });
  var liveInput = activeInput ? { codec: names.audioCodec(activeInput.codec).display,
    immersive: activeInput.immersive ? names.audioImmersive(activeInput.immersive) : null } :
    started && hdmi.AudioData === '1' && Number(hdmi.SamplingRate) > 0 ?
      { codec: names.audioCodec(hdmi.Codec).display, sampleRate: Number(hdmi.SamplingRate) } : null;
  // getARCEDIDInfo.eARC describes EDID policy, not the negotiated link. The
  // G3 returned true there while getARCState and its driver reported ARC.
  var earc = sound.EARC && sound.EARC.EArcOnOff === 'On';
  var link = earc ? 'eARC' : arcActive ? 'ARC' : arc ? 'inactive' : 'unknown';
  var arcPort = edid && Number(edid.arcHDMIPort) || null;
  var devices = records(replies.devices && replies.devices.devices);
  var receiverName = null;
  devices.forEach(function (d) {
    if (Number(d.port) !== arcPort) return;
    records(d.subList).forEach(function (s) {
      if (s.id === 'SIMPLINK' && s.cecpDevType === 5 && s.osdName) receiverName = s.osdName;
    });
  });
  return {
    ok: true, capturedAt: Date.now(),
    identity: { model: info.modelName || cfg['tv.model.modelname'] || null,
      firmware: info.firmwareVersion || null, webos: info.sdkVersion || null, kernel: os.release() },
    tv: { edidType: edidType, input: port, dtsDecoder: decoder, formats: rows,
      playbackDeclarations: declarations ? declarations.map(function (x) { return { name: String(x.name), channels: x.channels || null }; }) : null },
    receiver: { name: receiverName, connected: arc ? arcActive : null, link: link, port: arcPort,
      formatsKnown: receiverFormats !== null },
    settings: settings,
    outputName: settings.soundOutput ? names.soundOutput(settings.soundOutput).display : null,
    live: { input: liveInput,
      output: liveInput && settings.soundOutput === 'external_arc' && link !== 'inactive' && link !== 'unknown' && sound.ARC && Number(sound.ARC.OutputChannel) > 0 ? sound.ARC.OutputCodec : null }
  };
}

function status(cb, force) {
  /** @type {Object.<string, any>} */
  var replies = {};
  var left = 9;
  var decoder = null;
  function done() {
    if (--left) return;
    var result = build(replies, decoder);
    helperStatus(result.identity, function (helper) { result.override = helper; cb(result); });
  }
  function ask(key, uri, params, ttl) {
    var next = function (r) { replies[key] = r; done(); };
    if (force) luna(uri, params, next);
    else cached(uri, params, ttl, next);
  }
  ask('config', 'com.webos.service.config/getConfigs', { configNames: ['tv.model.edidType', 'tv.model.modelname'] }, 300000);
  ask('identity', 'com.webos.service.tv.systemproperty/getSystemInfo', { keys: ['modelName', 'firmwareVersion', 'sdkVersion'] }, 300000);
  ask('arc', 'com.webos.service.arccontroller/getARCState', {}, 3000);
  ask('edid', 'com.webos.service.arccontroller/getARCEDIDInfo', {}, 3000);
  ask('devices', 'com.webos.service.eim/getAllInputStatus', {}, 10000);
  ask('settings', 'com.webos.service.settings/getSystemSettings', { category: 'sound', keys: ['soundOutput', 'soundOutputDigital', 'eArcSupport', 'inputAudioFormatHDMI1', 'inputAudioFormatHDMI2', 'inputAudioFormatHDMI3', 'inputAudioFormatHDMI4'] }, 3000);
  ask('input', 'com.webos.service.audio/tv/getAudioInputProperty', {}, 3000);
  inspectDts(function (value) { decoder = value; done(); });
  if (receiverMap) receiverMap(function (map) { replies.receiverMap = map; done(); });
  else done();
}

function setOverride(on, cb) {
  if (typeof on !== 'boolean') return cb({ ok: false, error: msg('srv.audio.override.boolean', 'Enabled must be true or false.') });
  if (changing) return cb({ ok: false, error: msg('srv.audio.override.busy', 'An audio change is still in progress.') });
  changing = true;
  status(function (st) {
    var helper = st.override;
    var error = null;
    if (on && !helper.available) error = helper.reason;
    else if (!on && !helper.canDisable) error = msg('srv.audio.override.notEnabled', 'No verified DTS override is enabled.');
    else if (on && (st.receiver.link !== 'eARC' || st.settings.soundOutput !== 'external_arc' || st.settings.soundOutputDigital !== 'passThrough'))
      error = msg('srv.audio.override.setup', 'Choose HDMI ARC output, enable eARC and select Pass Through before enabling the override.');
    // This pinned watcher can start core and HD sessions. A core-only sink
    // needs a separately qualified core-only helper, not this combined one.
    else if (on && st.tv.formats.filter(function (f) { return (f.id === 'dts' || f.id === 'dtshd') && f.receiver === true; }).length !== 2)
      error = msg('srv.audio.override.receiver', 'The installed helper handles DTS and DTS-HD. The receiver must advertise both formats.');
    if (error) { changing = false; return cb({ ok: false, error: error }); }
    children.launch(function () {
      child.execFile('/bin/sh', [BASE + 'control.sh', on ? 'enable' : 'disable'], { timeout: 180000, maxBuffer: 32768 }, function (err) {
        changing = false;
        clearCache();
        status(function (after) {
          var confirmed = !err && after.override.enabled === on && after.override.running === on;
          cb({ ok: confirmed, status: after, error: confirmed ? null : msg('srv.audio.override.failed', 'The DTS helper did not confirm the change. Check its status before retrying.') });
        }, true);
      });
    });
  }, true);
}

function init(opts) {
  luna = opts.luna;
  cached = opts.lunaCached;
  clearCache = opts.clearLunaCache || function () {};
  receiverMap = opts.hdmiReceiverMap || null;
}

module.exports = { init: init, status: status, setOverride: setOverride };
