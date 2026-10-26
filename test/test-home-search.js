/* JustWatch's captured GB response, local country selection and title launches.
 * No LG catalogue mocks: only settings and applicationManager are permitted.
 * Fixture captured 26 October 2026; duplicate offers and unrelated providers trimmed. */
var assert = require('assert');
var search = require('../server/lib/home-search');
var fixture = require('./fixtures/search-justwatch-gb.json');
var installed = ['amazon', 'netflix', 'com.apple.appletv', 'com.disney.disneyplus-prod', 'bbc.iplayer.3.0', 'com.wbd.stream', 'com.bskyb.skystore', 'youtube.leanback.v4'];
var tv;
function copy(v) { return JSON.parse(JSON.stringify(v)); }
function later(cb, a, b) { process.nextTick(function () { cb(a, b); }); }
function setup(options) {
  options = options || {};
  tv = { country: 'GB', override: '', enabled: true, requests: [], launches: [], pages: [], apps: [], pending: [],
    doc: copy(fixture), deferApps: false, deferSearch: false, deferPage: false, pageReply: null, error: null };
  search.init({
    enabled: function () { return tv.enabled; },
    country: function () { return tv.override; },
    luna: function (uri, body, cb) {
      if (uri === 'com.webos.service.settings/getSystemSettings') return later(cb, { returnValue: true, settings: { smartServiceCountryCode2: tv.country } });
      assert.equal(uri, 'com.webos.applicationManager/launch', 'no LG catalogue calls');
      tv.launches.push(body); later(cb, { returnValue: true });
    },
    fetch: {
      postJson: function (url, body, cb) {
        assert.equal(url, 'https://apis.justwatch.com/graphql');
        if (/locales/.test(body.query)) {
          later(cb, null, { data: { locales: ['GB', 'US', 'DE'].map(function (c) { return { country: c, countryName: c }; }) } });
        } else {
          tv.requests.push(body);
          if (tv.deferSearch) tv.pending.push(cb); else later(cb, null, tv.error || copy(tv.doc));
        }
        return { cancel: function () {} };
      },
      getText: function (url, cb) {
        tv.pages.push(url);
        if (tv.deferPage) tv.pageReply = cb;
        else later(cb, null, /80057281$/.test(url) && !options.rejectEdition ? '<h1>Stranger Things</h1>' : '<h1>Stranger Things: VHS Special Edition</h1><h1>Stranger Things</h1>');
        return { cancel: function () {} };
      }
    },
    apps: function (cb) {
      if (tv.deferApps) tv.apps.push(cb);
      else later(cb, installed.map(function (id) { return { id: id, title: id }; }));
    }
  });
}
function title(result, name, year) { assert.ok(result.ok, result.error); return result.results.filter(function (r) { return r.title === name && r.year === year; })[0]; }
function open(hit, app, cb) { assert.ok(hit); search.open({ id: hit.id, app: app }, cb); }
var tests = [
  function digitalTitlesAndIndependentLinks(done) {
    setup();
    search.find('Dune', function (r) {
      var dune = title(r, 'Dune', 2021), original = title(r, 'Dune', 1984);
      assert.ok(dune && original && dune.id !== original.id, 'remakes stay separate');
      assert.ok(dune.apps.some(function (a) { return a.id === 'com.apple.appletv'; }), 'digital purchases remain eligible');
      assert.ok(dune.apps.every(function (a) { return a.id !== 'com.wbd.stream' && a.id !== 'com.bskyb.skystore'; }));
      assert.ok(dune.unavailableApps.indexOf('com.wbd.stream') !== -1, 'availability without a native title link is labelled');
      assert.equal(r.country, 'GB');
      assert.equal(dune.poster, 'https://images.justwatch.com/poster/249473713/s332/dune-2020.jpg');
      assert.ok(dune.source.indexOf('https://www.justwatch.com/uk/') === 0);
      assert.equal(tv.requests[0].variables.text, 'Dune');
      assert.equal((tv.requests[0].query.match(/country: GB/g) || []).length, 3, 'discovery, content and offers use one country');
      assert.ok(/platform: WEB\)/.test(tv.requests[0].query), 'availability is not limited to WEBOS offers');
      open(dune, 'amazon', function (a) {
        assert.ok(a.ok);
        assert.equal(tv.launches[0].replaceParams.deeplinkingParams.value, 'amzn1.dv.gti.a8025548-3908-4562-8896-8fffd945cfb6');
        search.open({ id: dune.id, app: 'com.example.arbitrary' }, function (b) {
          assert.ok(!b.ok); assert.equal(tv.launches.length, 1); done();
        });
      });
    });
  },
  function youtubeUsesTheVideoQueryForAWarmApp(done) {
    setup();
    search.find('Dune', function (r) {
      open(title(r, 'Dune', 1984), 'youtube.leanback.v4', function (a) {
        assert.ok(a.ok);
        assert.equal(tv.launches[0].replaceParams.deeplinkingParams.value, 'v=kzrcf5ph0EI'); done();
      });
    });
  },
  function rejectsPhysicalOffers(done) {
    setup();
    var dune = tv.doc.data.popularTitles.edges[0].node;
    dune.offers.forEach(function (o) { o.presentationType = 'BLURAY'; });
    search.find('Dune', function (r) {
      assert.ok(!title(r, 'Dune', 2021), 'an installed app does not turn a disc offer into a launch');
      assert.ok(title(r, 'Dune', 1984)); done();
    });
  },
  function opensDisneyAndBbcAtIndependentEpisodeLinks(done) {
    setup();
    var bear = tv.doc.data.popularTitles.edges.filter(function (e) { return e.node.content.title === 'The Bear'; })[0].node;
    // A non-play TVOS link must not hide the usable IOS episode identifier.
    bear.offers[0].tvos = bear.offers[0].standardWebURL;
    search.find('The Bear', function (r) {
      open(title(r, 'The Bear', 2022), 'com.disney.disneyplus-prod', function (a) {
        assert.ok(a.ok);
        assert.deepEqual(tv.launches[0], { id: 'com.disney.disneyplus-prod', replaceParams: { deeplinkingParams: {
          target: '$CONTENTID', value: 'page=play&id=60da223c-d2a0-411a-95c9-665a839371f9&distributionPartner=lg' } } });
        open(title(r, 'Doctor Who', 2005), 'bbc.iplayer.3.0', function (b) {
          assert.ok(b.ok);
          assert.equal(tv.launches[1].replaceParams.deeplinkingParams.value, 'http://www.bbc.co.uk/iplayer/episode/b0074dlv'); done();
        });
      });
    });
  },
  function filtersShortPromosWithoutHidingRealProgrammes(done) {
    setup();
    var node = tv.doc.data.popularTitles.edges[0].node;
    tv.doc.data.popularTitles.edges = [
      ['Dune: Trailer', 2], ['Dune: Sneak Peek', 5], ['Teaser: Dune', null],
      ['Trailer Park Boys', 25], ['Trailer War', 113]
    ].map(function (item) { var n = copy(node); n.content.title = item[0]; n.content.runtime = item[1]; return { node: n }; });
    search.find('trailer', function (r) {
      assert.deepEqual(r.results.map(function (n) { return n.title; }), ['Trailer Park Boys', 'Trailer War']); done();
    });
  },
  function verifiesTheNetflixEditionAndFailsClosed(done) {
    setup();
    search.find('Stranger Things', function (r) {
      open(title(r, 'Stranger Things', 2016), 'netflix', function (a) {
        assert.ok(a.ok);
        assert.ok(/80057281/.test(tv.launches[0].replaceParams.deeplinkingParams.value));
        setup({ rejectEdition: true }); tv.override = 'US';
        search.find('Stranger Things', function (s) {
          open(title(s, 'Stranger Things', 2016), 'netflix', function (b) {
            assert.ok(!b.ok, 'a matching heading for related content must not validate a different first heading');
            assert.equal(tv.launches.length, 0); done();
          });
        });
      });
    });
  },
  function requiresAKnownCountryAndSeparatesRegionalCaches(done) {
    setup(); tv.country = '';
    search.find('Dune', function (unknown) {
      assert.ok(!unknown.ok); assert.equal(tv.requests.length, 0, 'no silent US default');
      tv.override = 'UK';
      search.find('Dune', function (gb) {
        assert.equal(gb.country, 'GB'); var old = gb.results[0]; tv.override = 'US';
        open(old, old.apps[0].id, function (stale) {
          assert.ok(!stale.ok); assert.equal(tv.launches.length, 0);
          search.find('Dune', function (us) {
            assert.equal(us.country, 'US'); assert.equal(tv.requests.length, 2, 'GB cache is not reused for US');
            tv.override = 'XZ';
            search.find('Dune', function (unsupported) {
              assert.ok(!unsupported.ok); assert.equal(tv.requests.length, 2); done();
            });
          });
        });
      });
    });
  },
  function providerErrorsAndDisabledSearch(done) {
    setup(); tv.error = { data: { popularTitles: { edges: [] } }, errors: [{ message: 'invalid country' }] };
    search.find('Dune', function (r) {
      assert.ok(!r.ok, 'GraphQL errors are failures even with HTTP 200 and data');
      tv.error = null;
      search.find('Dune', function (valid) {
        tv.enabled = false;
        search.find('Dune', function (disabled) {
          assert.ok(!disabled.ok); assert.equal(tv.requests.length, 2);
          open(title(valid, 'Dune', 2021), 'amazon', function (refused) {
            assert.ok(!refused.ok && /switched off/.test(refused.error)); assert.equal(tv.launches.length, 0); done();
          });
        });
      });
    });
  },
  function lateAppListsCannotReplaceCurrentLaunchTargets(done) {
    setup(); tv.deferApps = true;
    search.find('du', function (r) { assert.ok(r.superseded); });
    setImmediateCompat(function () {
      search.find('dune', function (r) {
        var hit = title(r, 'Dune', 2021);
        tv.apps[0](installed.map(function (id) { return { id: id, title: id }; }));
        open(hit, 'amazon', function (a) {
          assert.ok(a.ok); tv.deferApps = false;
          tv.doc.data.popularTitles.edges = [];
          search.find('absent', function (empty) {
            assert.ok(empty.ok && !empty.results.length);
            open(hit, 'amazon', function (old) { assert.ok(!old.ok); assert.equal(tv.launches.length, 1); done(); });
          });
        });
      });
      setImmediateCompat(function () { tv.apps[1](installed.map(function (id) { return { id: id, title: id }; })); });
    });
  },
  function pendingOpensAreCancelledAndCountryIsRechecked(done) {
    setup(); tv.override = 'DE'; tv.deferPage = true;
    search.find('Stranger Things', function (r) {
      open(title(r, 'Stranger Things', 2016), 'netflix', function (a) { assert.ok(a.superseded); });
      setImmediateCompat(function () {
        var late = tv.pageReply;
        search.find('Dune', function (s) {
          late(null, '<h1>Stranger Things</h1>');
          open(title(s, 'Dune', 2021), 'amazon', function (b) {
            assert.ok(b.ok); assert.equal(tv.launches.length, 1); assert.equal(tv.launches[0].id, 'amazon');
            search.find('Stranger Things', function (again) {
              open(title(again, 'Stranger Things', 2016), 'netflix', function (changed) {
                assert.ok(!changed.ok); assert.equal(tv.launches.length, 1, 'country changed during resolution: no further launch'); done();
              });
              setImmediateCompat(function () { tv.override = 'GB'; tv.pageReply(null, '<h1>Stranger Things</h1>'); });
            });
          });
        });
      });
    });
  }
];
function setImmediateCompat(cb) { setTimeout(cb, 10); }
(function next(i) {
  if (i === tests.length) return console.log('test-home-search: ' + tests.length + ' passed');
  tests[i](function () { next(i + 1); });
})(0);
