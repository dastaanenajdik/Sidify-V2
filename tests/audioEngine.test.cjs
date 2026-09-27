const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the actual transport with deterministic browser/store doubles. No network,
// real timers, React mount, or AudioContext is needed for these lifecycle regressions.
function compile(name) {
  return ts.transpileModule(fs.readFileSync(path.resolve(__dirname, `../src/lib/${name}.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const engineCode = compile('audioEngine');
const policyExports = {};
vm.runInNewContext(compile('engineMode'), { exports: policyExports });
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

function harness({ video = false, native = true, failVideo = false, ua = '' } = {}) {
  const audios = [], intervals = new Map(), timeouts = new Map();
  let now = 100_000, timerId = 0, frame;
  function events(target = {}) {
    const listeners = new Map();
    target.addEventListener = (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    };
    target.removeEventListener = () => {};
    target.emit = (type) => { for (const fn of listeners.get(type) || []) fn(); };
    return target;
  }
  class Audio {
    constructor() {
      events(this);
      Object.assign(this, {
        src: '', currentTime: 0, duration: 240, paused: true, ended: false,
        readyState: 4, seekable: { length: 1 }, volume: 1, playbackRate: 1,
      });
      audios.push(this);
    }
    play() { this.paused = false; this.ended = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    load() {}
  }
  const param = () => ({
    value: 0, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {},
    setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; },
  });
  let ctx;
  class AudioContext {
    constructor() {
      ctx = this;
      events(this);
      this.state = 'running'; this.currentTime = 0; this.sources = [];
      this.resumeCalls = 0;
    }
    resume() { this.resumeCalls++; this.state = 'running'; return Promise.resolve(); }
    createGain() { return { connect() {}, gain: param() }; }
    createStereoPanner() { return { connect() {}, pan: param() }; }
    createBiquadFilter() { return { connect() {}, frequency: param(), Q: param(), gain: param() }; }
    createMediaElementSource(el) { this.sources.push(el); return { connect() {} }; }
  }
  const document = events({ visibilityState: 'visible' });
  const window = events({ AudioContext });
  const subscribers = [];
  const track = { id: 'one', videoId: 'video-one', title: 'One', artist: 'Artist', durationMs: 240000 };
  let state = {
    queue: [track, { ...track, id: 'two', videoId: 'video-two' }], index: 0,
    isPlaying: false, isLoading: false, engineMode: null, positionMs: 0,
    durationMs: 240000, resumeFromMs: 0, downloadedIds: {}, videoMode: video,
    fullPlayerOpen: video, volume: 0.8, speed: 1, repeat: 'off', contextLabel: '',
    set(patch) {
      const prev = state;
      state = { ...state, ...patch };
      for (const fn of subscribers) fn(state, prev);
    },
  };
  const settings = { normalization: false, balance: 0, crossfadeSecs: 0, gapless: false, autoplay: false };
  let callbacks = {};
  const yt = {
    state: 1, time: 0, plays: [], resumes: 0, currentVideoId: null,
    warm() {}, setVolume() {}, setRate() {},
    setCallbacks(cbs) { callbacks = cbs; },
    async playVideo(id, position) {
      this.plays.push({ id, position });
      if (failVideo) throw new Error('embed blocked');
      this.currentVideoId = id; this.time = position; this.state = 1;
    },
    pause() { this.state = 2; callbacks.onState?.(false); },
    resume() { this.resumes++; this.state = 1; },
    seekTo(position) { this.time = position; },
    getTime() { return this.time; }, getDuration() { return 240; },
    getPlayerState() { return this.state; }, isPlaying() { return this.state === 1; },
  };
  const modules = {
    '@/store/player': { usePlayer: { getState: () => state, subscribe: fn => subscribers.push(fn) },
      currentTrack: s => s.queue[s.index] || null },
    '@/store/settings': { useSettings: { getState: () => settings, subscribe() {} }, effectiveGains: () => [0], EQ_BANDS: [60] },
    '@/store/ui': { useUi: { getState: () => ({ pushToast() {} }) } },
    './offlineDb': { offlineObjectUrl: async () => null },
    './clientApi': { api: { pushRecent() {}, search: async () => ({ songs: [] }) } },
    './refreshBus': { emitRefresh() {} },
    './ytPlayer': { ytController: yt }, './engineMode': policyExports,
    './playbackDiag': { diagLog() {}, buildReport: () => '' },
  };
  const exports = {};
  vm.runInNewContext(engineCode, {
    exports, require: name => { assert.ok(modules[name], name); return modules[name]; },
    Audio, window, document, navigator: { userAgent: ua, maxTouchPoints: 0 }, AbortController, queueMicrotask,
    fetch: async () => ({ ok: native }),
    Date: class extends Date { static now() { return now; } },
    performance: { now: () => now },
    requestAnimationFrame: fn => { frame = fn; return 1; },
    setInterval: (fn, ms) => { const id = ++timerId; intervals.set(id, { fn, ms }); return id; },
    clearInterval: id => intervals.delete(id),
    setTimeout: (fn, ms) => { const id = ++timerId; timeouts.set(id, { fn, ms }); return id; },
    clearTimeout: id => timeouts.delete(id),
  });
  exports.initEngine();
  return {
    engine: exports, audios, yt, settings, intervals,
    get ctx() { return ctx; }, get state() { return state; },
    set: patch => state.set(patch),
    async visibility(visible) {
      document.visibilityState = visible ? 'visible' : 'hidden';
      document.emit('visibilitychange'); await flush();
    },
    suspend() { ctx.state = 'suspended'; ctx.emit('statechange'); },
    iframePause() { yt.state = 2; callbacks.onState?.(false); },
    async tick(ms) {
      now += ms;
      for (const timer of [...intervals.values()]) if (timer.ms === ms) timer.fn();
      await flush();
    },
    frame() { now += 300; frame(); },
    async watchdog() {
      for (const timer of intervals.values()) if (timer.ms === 2500) timer.fn();
      await flush();
    },
    async sleepTimer(ms) {
      for (const timer of [...timeouts.values()]) if (timer.ms === ms) timer.fn();
      await flush();
    },
  };
}

test('Back closes video player: native handoff preserves position and preference; reopen restores video', async () => {
  const h = harness({ video: true });
  await h.engine.playIndex(0, { resumeMs: 42000 });
  h.set({ fullPlayerOpen: false });
  h.iframePause(); // Browser pause during the async switch must not erase play intent.
  await flush();
  assert.equal(h.state.engineMode, 'native');
  assert.equal(h.state.isPlaying, true);
  assert.equal(h.state.videoMode, true);
  assert.equal(h.audios[0].currentTime, 42);
  assert.equal(h.audios[0].paused, false);
  h.set({ fullPlayerOpen: true });
  await flush();
  assert.equal(h.state.engineMode, 'iframe');
  assert.equal(h.yt.plays.at(-1).position, 42);
  assert.equal(h.audios[0].paused, true);
});

test('screen off hands iframe to native even when full player is still open', async () => {
  const h = harness({ video: true });
  await h.engine.playIndex(0, { resumeMs: 31500 });
  h.yt.time = 31.5;
  await h.visibility(false);
  assert.equal(h.state.engineMode, 'native');
  assert.equal(h.audios[0].currentTime, 31.5);
  assert.equal(h.audios.length, 2); // Running graph: no needless third element/refetch.
  await h.visibility(true);
  assert.equal(h.state.engineMode, 'iframe');
});

test('suspended hidden graph hands off once; controls/progress/settings and visible restore use live position', async () => {
  const h = harness();
  await h.engine.playIndex(0, { resumeMs: 45000 });
  await h.visibility(false);
  assert.equal(h.audios.length, 2);
  h.suspend(); await flush();
  const plain = h.audios[2];
  assert.ok(plain);
  assert.equal(h.ctx.sources.includes(plain), false);
  assert.equal(plain.src, h.audios[0].src);
  assert.equal(plain.currentTime, 45);
  assert.equal(h.audios[0].paused, true);
  assert.equal(plain.paused, false);
  await h.tick(3000);
  assert.equal(h.audios.length, 3);
  h.engine.setVolume(0.5); h.engine.setSpeed(1.5);
  h.settings.normalization = true; h.engine.applySettings();
  assert.equal(plain.volume, 0.5 * 0.82);
  assert.equal(plain.playbackRate, 1.5);
  h.engine.seekTo(70000);
  assert.equal(plain.currentTime, 70);
  plain.currentTime = 72; h.frame();
  assert.equal(h.state.positionMs, 72000);
  plain.currentTime = 74; await h.tick(3000);
  assert.equal(h.state.positionMs, 74000);
  await h.engine.togglePlay();
  assert.equal(plain.paused, true);
  assert.equal(h.state.isPlaying, false);
  await h.engine.togglePlay();
  assert.equal(plain.paused, false);
  assert.equal(h.state.isPlaying, true);
  await h.visibility(true);
  assert.equal(plain.paused, true);
  assert.equal(plain.src, '');
  assert.equal(h.audios[0].currentTime, 74);
  assert.equal(h.audios[0].paused, false);
  assert.equal(h.ctx.state, 'running');
  assert.equal([...h.intervals.values()].some(t => t.ms === 3000), false);
});

test('3s hidden watch catches suspension even without an AudioContext state event', async () => {
  const h = harness();
  await h.engine.playIndex(0);
  await h.visibility(false);
  h.ctx.state = 'suspended';
  await h.tick(3000);
  assert.equal(h.audios.length, 3);
  assert.equal(h.audios[2].paused, false);
});

test('paused transport never starts a background handoff; visible restore stays paused', async () => {
  const h = harness();
  await h.engine.playIndex(0);
  await h.engine.togglePlay();
  await h.visibility(false); h.suspend(); await h.tick(3000);
  assert.equal(h.audios.length, 2);
  await h.engine.togglePlay();
  const plain = h.audios[2];
  assert.ok(plain);
  await h.engine.togglePlay();
  plain.currentTime = 55;
  await h.visibility(true);
  assert.equal(h.audios[0].currentTime, 55);
  assert.equal(h.audios[0].paused, true);
  assert.equal(h.state.isPlaying, false);
});

test('new native track while hidden uses plain element without awaiting a suspended context', async () => {
  const h = harness({ video: true });
  await h.engine.playIndex(0, { resumeMs: 35000 });
  h.ctx.state = 'suspended';
  // Real mobile browsers may leave resume() pending until the tab is foregrounded.
  h.ctx.resume = () => new Promise(() => {});
  await h.visibility(false);
  assert.equal(h.state.engineMode, 'native');
  assert.equal(h.state.isLoading, false);
  assert.equal(h.audios[2].currentTime, 35);
  assert.equal(h.audios[2].paused, false);
});

test('watchdog advances ended plain audio and stops/clears the old element', async () => {
  const h = harness();
  await h.engine.playIndex(0);
  await h.visibility(false); h.suspend(); await flush();
  const plain = h.audios[2];
  plain.ended = true; plain.paused = true;
  await h.tick(2500);
  assert.equal(h.state.index, 1);
  assert.equal(plain.src, '');
  assert.equal(h.audios[3].paused, false);
  h.audios[3].ended = true; h.audios[3].paused = true;
  await h.tick(2500);
  assert.equal(h.state.isPlaying, false);
  assert.equal(h.audios[3].src, '');
});

test('plain ended handles repeat-one and sleep-at-end; timer never resumes paused audio', async () => {
  const h = harness();
  await h.engine.playIndex(0);
  await h.visibility(false); h.suspend(); await flush();
  const plain = h.audios[2];
  h.set({ repeat: 'one' });
  plain.currentTime = 240; plain.ended = true; plain.emit('ended'); await flush();
  assert.equal(plain.currentTime, 0);
  assert.equal(h.state.index, 0);
  h.engine.setSleepTimer('eot');
  plain.emit('ended'); await flush();
  assert.equal(plain.paused, true);
  assert.equal(h.state.isPlaying, false);
  h.engine.setSleepTimer(1);
  await h.sleepTimer(60000);
  assert.equal(plain.paused, true);
  assert.equal(h.state.isPlaying, false);
});

test('iframe fallback counts as a failed switch and respects 30s cooldown, even on forced changes', async () => {
  const h = harness({ video: true, native: false });
  await h.engine.playIndex(0);
  h.set({ fullPlayerOpen: false }); await flush();
  assert.equal(h.state.engineMode, 'iframe');
  const count = h.yt.plays.length;
  h.set({ fullPlayerOpen: true }); h.set({ fullPlayerOpen: false }); await flush();
  await h.tick(2500);
  assert.equal(h.yt.plays.length, count);
  await h.tick(30000); await h.tick(2500);
  assert.equal(h.yt.plays.length, count + 1);
});

test('failed embed falls back to correctly-labelled native and blocks video for 60s', async () => {
  const h = harness({ video: true, failVideo: true });
  await h.engine.playIndex(0, { resumeMs: 12000 }); await flush();
  assert.equal(h.state.engineMode, 'native');
  assert.equal(h.state.isPlaying, true);
  assert.equal(h.audios[0].currentTime, 12);
  h.set({ fullPlayerOpen: false }); h.set({ fullPlayerOpen: true }); await flush();
  await h.tick(30000); await h.tick(2500);
  assert.equal(h.yt.plays.length, 1);
  await h.tick(30000); await h.tick(2500);
  assert.equal(h.yt.plays.length, 2);
});

test('video preference changed during loading is reconciled after completion', async () => {
  const h = harness({ video: true });
  const pending = h.engine.playIndex(0, { resumeMs: 19000 });
  h.set({ fullPlayerOpen: false });
  await pending; await flush();
  assert.equal(h.state.engineMode, 'native');
  assert.equal(h.state.isLoading, false);
  assert.equal(h.audios[0].currentTime, 19);
});


test('mode reconciliation throttles ordinary resumes for 1200ms but forced visibility bypasses the gap', async () => {
  const h = harness({ video: true });
  await h.engine.playIndex(0); await flush();
  h.yt.state = 2; // OS pause not yet reported through the iframe callback.
  await h.watchdog();
  assert.equal(h.yt.resumes, 1);
  h.yt.state = 2;
  await h.watchdog();
  assert.equal(h.yt.resumes, 1);
  await h.tick(1199); await h.watchdog();
  assert.equal(h.yt.resumes, 1);
  await h.tick(1); await h.watchdog();
  assert.equal(h.yt.resumes, 2);
  h.yt.state = 2;
  await h.visibility(true);
  assert.equal(h.yt.resumes, 3);
});

test('foreground video handoff samples the plain element, not stale hidden UI progress', async () => {
  const h = harness({ video: true });
  await h.engine.playIndex(0, { resumeMs: 30000 });
  h.ctx.state = 'suspended';
  await h.visibility(false);
  const plain = h.audios[2];
  plain.currentTime = 38;
  assert.equal(h.state.positionMs, 30000);
  await h.visibility(true);
  assert.equal(h.yt.plays.at(-1).position, 38);
  assert.equal(plain.paused, true);
  assert.equal(plain.src, '');
});

test('pending foreground restore cannot revive an old track after another play request', async () => {
  const h = harness();
  await h.engine.playIndex(0);
  await h.visibility(false); h.suspend(); await flush();
  const plain = h.audios[2];
  plain.currentTime = 58;
  let resolveResume;
  h.ctx.resume = () => new Promise(resolve => { resolveResume = resolve; });
  await h.visibility(true); // Graph resume is still pending; plain audio remains live.
  assert.equal(plain.paused, false);
  const oldResume = resolveResume;
  await h.visibility(false);
  await h.engine.playIndex(1);
  const replacement = h.audios[3];
  h.ctx.state = 'running'; oldResume(); await flush();
  assert.equal(h.state.index, 1);
  assert.equal(plain.src, '');
  assert.equal(replacement.paused, false);
  assert.equal(h.audios[0].paused, true);
});

/* ---------- mobile background: proactive plain handoff + recovery ---------- */

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36';

test('mobile screen-off hands off to the plain element even while the graph still reports running', async () => {
  const h = harness({ ua: ANDROID_UA });
  await h.engine.playIndex(0, { resumeMs: 30000 });
  await h.visibility(false);
  // Desktop would keep the Web Audio graph here ("Running graph: no needless third
  // element"); a phone must not, because Android stops rendering graph-routed media.
  const plain = h.audios[2];
  assert.ok(plain);
  assert.equal(h.ctx.sources.includes(plain), false);
  assert.equal(plain.src, h.audios[0].src);
  assert.equal(plain.currentTime, 30);
  assert.equal(plain.paused, false);
  assert.equal(h.audios[0].paused, true);
  plain.currentTime = 34;
  await h.visibility(true);
  assert.equal(plain.paused, true);
  assert.equal(h.audios[0].currentTime, 34);
  assert.equal(h.audios[0].paused, false);
});

test('mobile: a browser-initiated pause of the plain element is resumed, twice per hidden window', async () => {
  const h = harness({ ua: ANDROID_UA });
  await h.engine.playIndex(0);
  await h.visibility(false);
  const plain = h.audios[2];
  assert.equal(plain.paused, false);

  const osPause = async () => { plain.pause(); plain.emit('pause'); await flush(); };
  await osPause();
  assert.equal(plain.paused, false); // recovered
  await osPause();
  assert.equal(plain.paused, false); // second attempt
  await osPause();
  assert.equal(plain.paused, true); // third: give up instead of spinning
  assert.equal(h.state.isPlaying, true); // play intent is preserved for the next unlock
  await h.visibility(true);
  const attemptsReset = h.audios[3];
  assert.equal(attemptsReset, undefined); // restore reuses the deck, no extra element
});

test('mobile: a user pause in the notification is never fought by the recovery', async () => {
  const h = harness({ ua: ANDROID_UA });
  await h.engine.playIndex(0);
  await h.visibility(false);
  const plain = h.audios[2];
  await h.engine.togglePlay(); // lock-screen pause arrives through the media session
  assert.equal(h.state.isPlaying, false);
  plain.emit('pause');
  await flush();
  assert.equal(plain.paused, true);
});

test('hidden iframe pause is resumed when native extraction is unavailable', async () => {
  const h = harness({ video: true, native: false });
  await h.engine.playIndex(0);
  h.set({ fullPlayerOpen: false });
  await flush();
  assert.equal(h.state.engineMode, 'iframe');
  await h.visibility(false);
  const before = h.yt.resumes;
  h.iframePause();
  await flush();
  assert.ok(h.yt.resumes > before);
  assert.equal(h.state.isPlaying, true); // keep the intent: Brave/Chrome may resume later
});

test('a media error mid-track re-opens the same URL at the current position instead of skipping', async () => {
  const h = harness();
  await h.engine.playIndex(0);
  const deck = h.audios[0];
  const src = deck.src;
  assert.match(src, /video-one/);
  deck.currentTime = 97; deck.paused = false;
  let loads = 0; deck.load = () => { loads++; };
  deck.emit('error'); await flush();
  assert.equal(h.state.index, 0, 'still the same track');
  assert.equal(h.state.isPlaying, true);
  assert.equal(loads, 1, 'source reloaded once');
  assert.equal(deck.src, src);
  assert.equal(deck.currentTime, 97, 'resumes where it stalled');
  assert.equal(deck.paused, false);
});

test('an error before playback ever progressed still skips; recoveries are capped per track', async () => {
  const h = harness();
  await h.engine.playIndex(0);
  const deck = h.audios[0];
  deck.currentTime = 0;
  deck.emit('error'); await flush();
  assert.equal(h.state.index, 1, 'a track that never started is unavailable → next');

  // Fresh track (same deck — decks only swap on crossfade): three mid-track
  // recoveries, then the fourth error skips.
  const deck2 = h.audios[0];
  assert.match(deck2.src, /video-two/);
  h.set({ queue: [...h.state.queue, { ...h.state.queue[0], id: 'three', videoId: 'video-three' }] });
  for (let i = 1; i <= 3; i++) {
    deck2.currentTime = 30 * i; deck2.paused = false;
    deck2.emit('error'); await flush();
    assert.equal(h.state.index, 1, `recovery #${i} keeps the track`);
  }
  deck2.currentTime = 120;
  deck2.emit('error'); await flush();
  assert.equal(h.state.index, 2, 'gives up after the cap');
});

test('the stall watchdog reloads a starved element only after it stopped moving for 12s', async () => {
  const h = harness();
  await h.engine.playIndex(0);
  const deck = h.audios[0];
  let loads = 0; deck.load = () => { loads++; };
  deck.currentTime = 40; deck.paused = false; deck.readyState = 2; // HAVE_CURRENT_DATA: starving
  await h.tick(2500); // records the position
  for (let t = 0; t < 12_500; t += 2500) await h.tick(2500);
  assert.equal(loads, 1, 'one recovery after the stall window');
  assert.equal(deck.currentTime, 40);
  // A healthy element (readyState 4) that simply moves is never touched.
  deck.readyState = 4;
  for (let t = 0; t < 20_000; t += 2500) { deck.currentTime += 2.5; await h.tick(2500); }
  assert.equal(loads, 1);
});

test('the next track is not preloaded the moment playback starts (no bandwidth contest)', async () => {
  const h = harness();
  await h.engine.playIndex(0);
  assert.match(h.audios[0].src, /video-one/);
  assert.equal(h.audios[1].src, '', 'idle deck stays empty until the current track is buffered');
});
