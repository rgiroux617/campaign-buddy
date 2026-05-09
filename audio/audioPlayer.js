// audioPlayer.js
// Plays session voiceover audio using the Web Audio API.
// Decoding runs off the main thread so it never competes with the animation loop.
//
// Usage:
//   const audio = createAudioPlayer();
//   audio.preload(['./audio/session1.mp3', ...]);  // call on app load, no gesture needed
//   await audio.play('./audio/session3.mp3');       // inside gesture handler: resume + decode + start
//   audio.stop();
//
// iOS notes:
//   - AudioContext is created once on first play() and reused thereafter.
//     iOS limits the total number of contexts per page (~6), so never create
//     a new one on each call.
//   - ctx.resume() MUST be called inside every user gesture. iOS suspends the
//     context between gestures even if it was already running.
//   - preload() fetches all MP3s as raw ArrayBuffers at app-load time (no
//     gesture needed for fetch). When play() is called inside a gesture, the
//     network is already done — only resume() + decode + start() remain, which
//     is fast enough to beat the 800 ms audio-lead timer in sessionPlayer.
//   - decodeAudioData() consumes its ArrayBuffer, so the cache stores the
//     original and play() clones it with .slice(0) before decoding.
//   - _playId guards against a stop()-then-play() race: if stop() is called
//     while decoding is still in flight, the stale async chain bails out.

// ── Tuning ────────────────────────────────────────────────────────────────────
const AUDIO = {
  fadeOutMs: 800,   // how long the stop fade takes in ms
};

export function createAudioPlayer() {

  let _ctx      = null;   // AudioContext — created once, reused forever
  let _source   = null;   // currently playing BufferSourceNode
  let _gainNode = null;   // gain node used for fade-out on stop
  let _playId   = 0;      // incremented each play(); lets async chain detect cancellation

  // url → ArrayBuffer cache populated by preload()
  const _cache  = new Map();

  // Returns the shared AudioContext, creating it on first call.
  // Must be called inside a user-gesture handler so iOS allows it.
  function _getCtx() {
    if (!_ctx) {
      _ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return _ctx;
  }

  // ── Public: preload ───────────────────────────────────────────────────────
  // Fetches all URLs and caches them as ArrayBuffers.
  // Call this at app-load time — no user gesture required for fetch().
  // Failures are silently ignored; play() will fall back to on-demand fetch.
  function preload(urls) {
    for (const url of urls) {
      if (_cache.has(url)) continue;
      fetch(url)
        .then(r => r.arrayBuffer())
        .then(buf => _cache.set(url, buf))
        .catch(() => { /* ignore — play() will fetch on demand */ });
    }
  }

  // ── Public: play ─────────────────────────────────────────────────────────
  // Decodes and plays the audio file. If preload() has already fetched it,
  // the network wait is skipped entirely — only decode + start remain.
  // Must be called directly inside a user gesture handler for iOS.
  async function play(url) {
    stop();                   // fade out anything currently playing FIRST
    const myId = ++_playId;   // THEN tag this invocation — after stop() so
                              // stop()'s own _playId++ doesn't invalidate us

    const ctx = _getCtx();

    // iOS REQUIRED: resume() must be called inside every user gesture.
    // The context starts suspended and iOS re-suspends it between gestures.
    await ctx.resume();
    if (myId !== _playId) return;   // stop() was called while resuming

    // Gain node lets us fade out cleanly on stop()
    _gainNode = ctx.createGain();
    _gainNode.gain.setValueAtTime(1, ctx.currentTime);
    _gainNode.connect(ctx.destination);

    // Use cached ArrayBuffer if available, otherwise fetch now.
    // .slice(0) clones the buffer — decodeAudioData() consumes its input
    // and would corrupt the cache entry if we passed the original.
    let arrayBuffer;
    if (_cache.has(url)) {
      arrayBuffer = _cache.get(url).slice(0);
    } else {
      const response = await fetch(url);
      arrayBuffer = await response.arrayBuffer();
      if (myId !== _playId) return;   // stop() was called while fetching
    }

    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    if (myId !== _playId) return;   // stop() was called while decoding

    // Create a source node and connect it
    _source = ctx.createBufferSource();
    _source.buffer = audioBuffer;
    _source.connect(_gainNode);
    _source.start(0);
  }

  // ── Public: stop ─────────────────────────────────────────────────────────
  // Fades out over AUDIO.fadeOutMs then stops cleanly.
  // Also cancels any in-flight play() call via _playId.
  function stop() {
    _playId++;   // invalidate any in-flight play() async chain

    if (!_source || !_ctx) return;

    const fadeEnd = _ctx.currentTime + AUDIO.fadeOutMs / 1000;
    _gainNode.gain.linearRampToValueAtTime(0, fadeEnd);

    // Stop the source after the fade
    _source.stop(fadeEnd);
    _source = null;
  }

  return { play, stop, preload };
}