const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const filename = path.resolve(__dirname, '../src/lib/rooms/logic.ts');
const compiled = new Module(filename, module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const L = compiled.exports;

const T = (id, durationMs = 200_000) => ({
  id, videoId: id, title: `Song ${id}`, artist: 'Artist', artwork: '', durationMs,
});
const ID = (c) => c.repeat(11);

function room(opts = {}) {
  const now = opts.now ?? 1_000_000;
  const rec = L.newRoom({
    code: 'ABC123', hostId: 'host', hostName: 'Sid', token: 'tok-host', now,
    seed: opts.seed ?? { queue: [T(ID('a')), T(ID('b'))], index: 0, positionMs: 0, isPlaying: true },
    hostOnly: opts.hostOnly, autoplay: opts.autoplay,
  });
  L.addMember(rec, { id: 'guest', name: 'Aman', token: 'tok-guest' }, now);
  return rec;
}
const member = (rec, id) => rec.members.find((m) => m.id === id);

test('codes: normalised for speech (I/L → 1, O → 0) and drawn from the safe alphabet', () => {
  assert.equal(L.normalizeCode(' ab-c1o9 '), 'ABC109');
  assert.equal(L.normalizeCode('lil0io'), '111010');
  for (let i = 0; i < 50; i++) {
    const c = L.randomCode();
    assert.ok(L.isValidCode(c), c);
    assert.doesNotMatch(c, /[ILO]/);
  }
});

test('expected position follows the anchor while playing and clamps to the track', () => {
  const r = { isPlaying: true, positionMs: 10_000, anchorMs: 5_000, queue: [T(ID('a'), 60_000)], queueIndex: 0 };
  assert.equal(L.expectedPosition(r, 4_000), 10_000); // before the anchor: no movement yet
  assert.equal(L.expectedPosition(r, 8_000), 13_000);
  assert.equal(L.expectedPosition(r, 500_000), 60_000);
  assert.equal(L.expectedPosition({ ...r, isPlaying: false }, 500_000), 10_000);
});

test('a seeded room starts on the host\'s song, scheduled slightly ahead', () => {
  const rec = room();
  assert.equal(L.currentOf(rec).id, ID('a'));
  assert.equal(rec.isPlaying, true);
  assert.equal(rec.anchorMs, 1_000_000 + L.ROOM_LIMITS.startLeadMs);
  assert.deepEqual(rec.members.map((m) => m.name), ['Sid', 'Aman']);
  assert.equal(L.publicRoom(rec).tokens, undefined, 'tokens never leave the server');
});

test('play / pause / seek bump seq and move the clock', () => {
  const rec = room();
  const seq = rec.seq;
  assert.deepEqual(L.applyControl(rec, member(rec, 'guest'), { type: 'pause', positionMs: 42_000 }, 2_000_000), { ok: true });
  assert.equal(rec.isPlaying, false);
  assert.equal(rec.positionMs, 42_000);
  assert.ok(rec.seq > seq);
  L.applyControl(rec, member(rec, 'host'), { type: 'seek', positionMs: 90_000 }, 2_000_100);
  assert.equal(rec.positionMs, 90_000);
  L.applyControl(rec, member(rec, 'host'), { type: 'play' }, 2_000_200);
  assert.equal(rec.isPlaying, true);
  assert.equal(L.expectedPosition(rec, 2_000_200 + L.ROOM_LIMITS.startLeadMs + 1_000), 91_000);
});

test('queue: "end" lands after the listener queue, before the rest; next walks it', () => {
  const rec = room();
  L.applyControl(rec, member(rec, 'guest'), { type: 'queueAdd', track: T(ID('c')), mode: 'end' }, 2_000_000);
  L.applyControl(rec, member(rec, 'guest'), { type: 'queueAdd', track: T(ID('d')), mode: 'end' }, 2_000_001);
  L.applyControl(rec, member(rec, 'guest'), { type: 'queueAdd', track: T(ID('e')), mode: 'next' }, 2_000_002);
  assert.deepEqual(rec.queue.map((t) => t.id[0]), ['a', 'e', 'c', 'd', 'b']);
  assert.equal(rec.queue[1].tier, 'user');
  L.applyControl(rec, member(rec, 'host'), { type: 'next' }, 2_000_003);
  assert.equal(L.currentOf(rec).id, ID('e'));
  L.applyControl(rec, member(rec, 'host'), { type: 'queueMove', from: 3, to: 2 }, 2_000_004);
  assert.deepEqual(rec.queue.map((t) => t.id[0]), ['a', 'e', 'd', 'c', 'b']);
  L.applyControl(rec, member(rec, 'host'), { type: 'queueRemove', index: 1 }, 2_000_005);
  assert.equal(L.currentOf(rec).id, ID('e'), 'the playing song cannot be removed');
});

test('"ended" is idempotent and only honoured near the end of the right song', () => {
  const rec = room();
  const now = 1_000_000 + L.ROOM_LIMITS.startLeadMs;
  // far from the end: ignored
  L.applyControl(rec, member(rec, 'guest'), { type: 'ended', trackId: ID('a') }, now + 10_000);
  assert.equal(L.currentOf(rec).id, ID('a'));
  // at the end: advances once
  L.applyControl(rec, member(rec, 'guest'), { type: 'ended', trackId: ID('a') }, now + 199_500);
  assert.equal(L.currentOf(rec).id, ID('b'));
  const seq = rec.seq;
  L.applyControl(rec, member(rec, 'host'), { type: 'ended', trackId: ID('a') }, now + 199_600);
  assert.equal(L.currentOf(rec).id, ID('b'));
  assert.equal(rec.seq, seq, 'a late duplicate changes nothing');
});

test('end of the queue asks for AutoPlay when it is on, stops cleanly when it is off', () => {
  const on = room({ seed: { queue: [T(ID('a'))], index: 0, positionMs: 0, isPlaying: true } });
  const res = L.applyControl(on, member(on, 'host'), { type: 'next' }, 2_000_000);
  assert.deepEqual(res, { ok: true, needsFill: true });
  assert.equal(L.appendAutoplay(on, [T(ID('x')), T(ID('a')), { bogus: true }], 2_000_001), 1);
  assert.equal(on.queue.at(-1).tier, 'autoplay');

  const off = room({ autoplay: false, seed: { queue: [T(ID('a'))], index: 0, positionMs: 0, isPlaying: true } });
  L.applyControl(off, member(off, 'host'), { type: 'next' }, 2_000_000);
  assert.equal(off.isPlaying, false);
});

test('host-only rooms: guests listen, host keeps control; host actions are guarded', () => {
  const rec = room({ hostOnly: true });
  assert.equal(L.applyControl(rec, member(rec, 'guest'), { type: 'pause' }, 2_000_000).status, 403);
  assert.equal(L.applyControl(rec, member(rec, 'guest'), { type: 'ended', trackId: 'zzz' }, 2_000_000).ok, true);
  assert.equal(L.applyControl(rec, member(rec, 'guest'), { type: 'kick', memberId: 'host' }, 2_000_000).status, 403);
  assert.equal(L.applyControl(rec, member(rec, 'host'), { type: 'pause' }, 2_000_000).ok, true);
});

test('membership: capacity, kick, host hand-over and the sweep', () => {
  const rec = room();
  L.applyControl(rec, member(rec, 'host'), { type: 'setCapacity', max: 2 }, 2_000_000);
  assert.equal(rec.maxMembers, 2);
  assert.equal(L.addMember(rec, { id: 'x', name: 'X', token: 't' }, 2_000_000).status, 409);
  assert.equal(L.memberByToken(rec, 'tok-guest').id, 'guest');

  L.removeMember(rec, 'host', 2_000_000, 'left');
  assert.equal(rec.hostId, 'guest', 'the longest-standing member becomes host');

  // nobody checks in for longer than the grace period → room empties, then dies
  const later = 2_000_000 + L.ROOM_LIMITS.graceMs + 1;
  const activityBeforeTimeout = [...rec.activity];
  L.sweep(rec, later);
  assert.equal(rec.members.length, 0);
  assert.deepEqual(rec.activity, activityBeforeTimeout, 'a missed heartbeat is not shown as an explicit dropped-out event');
  assert.ok(!rec.dead);
  L.sweep(rec, later + L.ROOM_LIMITS.emptyTtlMs + 1);
  assert.equal(rec.dead, true);
});

test('room chat is kept for active members and cleared when the room goes offline', () => {
  const rec = room();
  rec.chat = [{ id: 'msg-1', at: 1_000_001, memberId: 'guest', by: 'Aman', text: 'hello' }];

  L.removeMember(rec, 'guest', 1_000_010, 'left');
  assert.equal(rec.chat.length, 1, 'one listener leaving does not erase chat for the remaining listener');

  L.removeMember(rec, 'host', 1_000_020, 'left');
  assert.deepEqual(rec.chat, [], 'chat is discarded as soon as the room has no active listeners');
});

test('newly left room members are announced once, never from an old/different room snapshot', () => {
  const previous = L.publicRoom(room());
  const next = {
    ...previous,
    activity: [...previous.activity,
      { at: 2_000_000, by: 'Aman', text: 'left' },
      { at: 2_000_001, by: 'Sid', text: 'dropped out' },
      { at: 2_000_002, by: 'Ravi', text: 'was removed' },
    ],
  };
  assert.deepEqual(L.newlyLeftMembers(previous, next), ['Aman']);
  assert.deepEqual(L.newlyLeftMembers(next, next), []);
  assert.deepEqual(L.newlyLeftMembers(null, next), [], 'refreshing into an existing room must not replay old exits');
  assert.deepEqual(L.newlyLeftMembers(previous, { ...next, code: 'ZZZ999' }), []);
});

test('tracks are sanitised: bad ids, missing titles and odd artwork are rejected', () => {
  assert.equal(L.cleanTrack({ id: 'x', videoId: 'short', title: 'T' }), null);
  assert.equal(L.cleanTrack({ videoId: ID('a') }), null);
  const t = L.cleanTrack({ videoId: ID('a'), title: 'T', artwork: 'javascript:alert(1)', durationMs: -5 });
  assert.equal(t.artwork, '');
  assert.equal(t.durationMs, 0);
  assert.equal(L.cleanName('   '), 'Listener');
});

/* ------------------------------- voice calls ------------------------------ */

test('voice call: presence flips, is idempotent and purges signals on leave', () => {
  const rec = room();
  const seq0 = rec.seq;
  assert.deepEqual(rec.voiceCall, []);
  assert.deepEqual(rec.signals, []);

  assert.equal(L.setVoicePresence(rec, 'host', true), true);
  assert.deepEqual(rec.voiceCall, ['host']);
  assert.ok(rec.seq > seq0);
  const seq1 = rec.seq;
  assert.equal(L.setVoicePresence(rec, 'host', true), false, 'already present is a no-op');
  assert.equal(rec.seq, seq1);

  L.setVoicePresence(rec, 'guest', true);
  const sig = { id: 's1', at: 1_000_100, from: 'host', to: 'guest', kind: 'offer', data: 'sdp' };
  assert.ok(L.queueSignal(rec, sig));
  assert.equal(L.takeSignals(rec, 'host').length, 0, 'only the recipient can collect');
  const mine = L.takeSignals(rec, 'guest');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, 's1');
  assert.equal(L.takeSignals(rec, 'guest').length, 0, 'collecting removes the envelope');

  L.queueSignal(rec, { id: 's2', at: 1_000_101, from: 'guest', to: 'host', kind: 'answer', data: 'sdp' });
  L.setVoicePresence(rec, 'host', false);
  assert.deepEqual(rec.voiceCall, ['guest']);
  assert.equal(rec.signals.length, 0, 'leaving frees every envelope to/from the seat');

  L.queueSignal(rec, { id: 's3', at: 1_000_102, from: 'guest', to: 'host', kind: 'bye', data: '' });
  L.setVoicePresence(rec, 'guest', false);
  assert.deepEqual(rec.voiceCall, []);
  assert.deepEqual(rec.signals, [], 'the last seat leaving purges every stale envelope');
});

test('voice signals: kinds, seats and payload size are validated, and the buffer is capped', () => {
  const rec = room();
  const base = { id: 's', at: 1, from: 'host', to: 'guest', data: 'd' };
  assert.equal(L.queueSignal(rec, { ...base, kind: 'nope' }), null);
  assert.equal(L.queueSignal(rec, { ...base, kind: 'offer', from: 'ghost' }), null);
  assert.equal(L.queueSignal(rec, { ...base, kind: 'offer', to: 'host' }), null, 'cannot signal yourself');
  assert.equal(L.queueSignal(rec, { ...base, kind: 'candidate', data: '' }), null);
  assert.ok(L.queueSignal(rec, { ...base, kind: 'bye', data: '' }), 'a hang-up needs no payload');
  assert.equal(L.queueSignal(rec, { ...base, kind: 'candidate', data: 'x'.repeat(20_001) }), null);
  assert.ok(L.queueSignal(rec, { ...base, kind: 'candidate', data: 'x'.repeat(20_000) }));

  for (let i = 0; i < 45; i++) {
    L.queueSignal(rec, { id: `q${i}`, at: 10 + i, from: 'host', to: 'guest', kind: 'candidate', data: String(i) });
  }
  assert.equal(rec.signals.length, L.ROOM_LIMITS.voiceSignals);
  assert.equal(rec.signals[rec.signals.length - 1].id, 'q44', 'oldest envelopes drop first');
});

test('voice call: removing a member clears their seat and pending signals', () => {
  const rec = room();
  L.setVoicePresence(rec, 'host', true);
  L.setVoicePresence(rec, 'guest', true);
  L.queueSignal(rec, { id: 'a', at: 2, from: 'host', to: 'guest', kind: 'offer', data: 'sdp' });
  L.queueSignal(rec, { id: 'b', at: 3, from: 'guest', to: 'host', kind: 'answer', data: 'sdp' });
  assert.equal(rec.signals.length, 2);

  L.removeMember(rec, 'guest', 1_000_500, 'left');
  assert.deepEqual(rec.voiceCall, ['host']);
  assert.equal(rec.signals.length, 0);
});

test('voice call: publicRoom defaults voice state for older records', () => {
  const rec = room();
  delete rec.voiceCall;
  delete rec.signals;
  const pub = L.publicRoom(rec);
  assert.deepEqual(pub.voiceCall, []);
  assert.deepEqual(pub.signals, []);
});

test('voice presence watcher: ringing out must not end while the peer is still in the room', () => {
  const members = [{ id: 'me', name: 'Sid' }, { id: 'them', name: 'Aman' }];
  const decide = (status, voiceCall, peerId = 'them') =>
    L.decideVoicePresenceAction({ status, peerId, you: 'me', members, voiceCall });

  assert.equal(decide('idle', []), 'none');
  assert.equal(decide('idle', ['them']), 'ring', 'their presence starts an incoming ring');
  assert.equal(decide('idle', ['me']), 'clear-stale', 'our own orphaned presence is cleaned');
  assert.equal(decide('ringing', []), 'cancel-ring', 'caller hung up before we answered');

  // The regression: the callee is not in voiceCall until they accept, so an
  // outgoing ring must survive their absence from the call list.
  assert.equal(decide('requesting', ['me']), 'none');
  assert.equal(decide('requesting', ['me', 'them']), 'none');
  assert.equal(decide('requesting', ['me'], null), 'none');
  assert.equal(
    L.decideVoicePresenceAction({ status: 'requesting', peerId: 'them', you: 'me', members: [{ id: 'me', name: 'Sid' }], voiceCall: ['me'] }),
    'end-left-room',
    'only the peer leaving the room itself ends an outgoing ring'
  );

  assert.equal(decide('connecting', ['me']), 'end-left-call');
  assert.equal(decide('live', ['me', 'them']), 'none');
  assert.equal(decide('live', ['me']), 'end-left-call');
  assert.equal(
    L.decideVoicePresenceAction({ status: 'live', peerId: 'them', you: 'me', members: [{ id: 'me', name: 'Sid' }], voiceCall: ['me'] }),
    'end-left-room'
  );
});
