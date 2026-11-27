/* DSMAudioCue & DSMWakeLock — iOS Silent Mode Bypass + Soft Practice Chimes + Screen WakeLock (v3.0)
 * Pure UMD module (runs in browser & Node.js unit tests).
 * Keeps iOS Safari / Telegram WKWebView in AVAudioSessionCategoryPlayback so soft cues
 * play cleanly even when the physical iPhone Silent Switch is ON, and recovers "interrupted" AudioContext.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DSMAudioCue = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function createSilentWavUrl() {
    if (
      typeof Uint8Array === "undefined" ||
      typeof Blob === "undefined" ||
      typeof URL === "undefined" ||
      !URL.createObjectURL
    ) {
      return null;
    }
    try {
      const sampleRate = 8000;
      const numSamples = 8000; // 1.0 second exact digital silence
      const buf = new ArrayBuffer(44 + numSamples);
      const view = new DataView(buf);
      const writeStr = (off, s) => {
        for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
      };
      writeStr(0, "RIFF");
      view.setUint32(4, 36 + numSamples, true);
      writeStr(8, "WAVE");
      writeStr(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate, true);
      view.setUint16(32, 1, true);
      view.setUint16(34, 8, true);
      writeStr(36, "data");
      view.setUint32(40, numSamples, true);
      new Uint8Array(buf, 44).fill(0x80);
      return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
    } catch (_) {
      return null;
    }
  }

  let ctx = null;
  let iosAudioEl = null;
  let iosWavUrl = null;
  let iosSessionActive = false;
  let soundEnabled = true;

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && iosAudioEl && !iosAudioEl.paused) {
        try {
          iosAudioEl.pause();
        } catch (_) {}
      }
    });
  }

  function enableIOSPlaybackSession(fromGesture) {
    try {
      if (typeof navigator !== "undefined" && navigator.audioSession) {
        if (navigator.audioSession.type !== "playback") {
          navigator.audioSession.type = "playback";
        }
        iosSessionActive = true;
      }
    } catch (_) {}

    if (fromGesture && typeof document !== "undefined" && !document.hidden && typeof Audio !== "undefined") {
      try {
        if (!iosAudioEl) {
          if (!iosWavUrl) iosWavUrl = createSilentWavUrl();
          if (iosWavUrl) {
            const el = new Audio();
            el.src = iosWavUrl;
            el.loop = true;
            el.muted = false;
            el.volume = 1.0;
            el.preload = "auto";
            el.playsInline = true;
            el.setAttribute("playsinline", "");
            el.setAttribute("webkit-playsinline", "");
            el.setAttribute("x-webkit-airplay", "deny");
            iosAudioEl = el;
          }
        }
        if (iosAudioEl && iosAudioEl.paused) {
          const p = iosAudioEl.play();
          if (p && typeof p.then === "function") {
            p.then(() => {
              iosSessionActive = true;
            }).catch(() => {});
          } else {
            iosSessionActive = true;
          }
        }
      } catch (_) {}
    }
    return iosSessionActive;
  }

  function ensureContext() {
    enableIOSPlaybackSession(false);
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state !== "running") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function unlock() {
    enableIOSPlaybackSession(true);
    const c = ensureContext();
    if (!c) return;
    if (c.state !== "running") {
      c.resume().catch(() => {});
      try {
        const buf = c.createBuffer(1, 1, c.sampleRate);
        const src = c.createBufferSource();
        src.buffer = buf;
        src.connect(c.destination);
        src.start(0);
      } catch (_) {}
    }
  }

  function setEnabled(flag) {
    soundEnabled = Boolean(flag);
    return soundEnabled;
  }

  function isEnabled() {
    return soundEnabled;
  }

  function playCue(freq = 432, dur = 0.11, gainPeak = 0.055, force = false) {
    if (!force && !soundEnabled) return;
    try {
      const c = ensureContext();
      if (!c) return;
      const fire = () => {
        const now = c.currentTime;
        const osc = c.createOscillator();
        const over = c.createOscillator();
        const gain = c.createGain();
        const gOver = c.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now);
        over.type = "triangle";
        over.frequency.setValueAtTime(freq * 2, now);
        gOver.gain.setValueAtTime(0.14, now);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.002, gainPeak), now + 0.022);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        osc.connect(gain);
        over.connect(gOver);
        gOver.connect(gain);
        gain.connect(c.destination);

        osc.start(now);
        over.start(now);
        osc.stop(now + dur + 0.03);
        over.stop(now + dur + 0.03);
      };
      if (c.state !== "running") {
        c.resume().then(fire).catch(() => {});
      } else {
        fire();
      }
    } catch (_) {}
  }

  let activeGlideOsc = null;
  let activeGlideGain = null;

  function stopBreathGlide() {
    try {
      if (activeGlideGain && ctx) {
        activeGlideGain.gain.cancelScheduledValues(ctx.currentTime);
        activeGlideGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      }
      if (activeGlideOsc) {
        activeGlideOsc.stop();
      }
    } catch (_) {}
    activeGlideOsc = null;
    activeGlideGain = null;
  }

  function playBreathGlide(fromFreq = 280, toFreq = 396, durSec = 4.0, gainPeak = 0.032) {
    if (!soundEnabled) return;
    stopBreathGlide();
    try {
      const c = ensureContext();
      if (!c) return;
      const dur = Math.max(0.6, Math.min(12.0, Number(durSec || 4.0)));
      const fire = () => {
        const now = c.currentTime;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(Math.max(120, fromFreq), now);
        osc.frequency.exponentialRampToValueAtTime(Math.max(120, toFreq), now + dur * 0.92);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.002, gainPeak), now + Math.min(0.45, dur * 0.22));
        gain.gain.setValueAtTime(Math.max(0.002, gainPeak * 0.85), now + dur * 0.72);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        osc.connect(gain);
        gain.connect(c.destination);
        activeGlideOsc = osc;
        activeGlideGain = gain;
        osc.start(now);
        osc.stop(now + dur + 0.04);
      };
      if (c.state !== "running") c.resume().then(fire).catch(() => {});
      else fire();
    } catch (_) {}
  }

  function playPhaseDoneChime() {
    if (!soundEnabled) return;
    stopBreathGlide();
    playCue(432, 0.16, 0.06);
    setTimeout(() => playCue(528, 0.24, 0.05), 145);
  }

  function playTestTone() {
    unlock();
    playCue(432, 0.35, 0.085, true);
  }

  function getDiagnostics() {
    const ctxState = ctx ? ctx.state : "standby";
    const iosTag = iosAudioEl && !iosAudioEl.paused
      ? "playback (loop)"
      : iosSessionActive
      ? "playback (api)"
      : "standby";
    return { ctxState, iosTag, soundEnabled };
  }

  // -------- Screen WakeLock (keeps phone awake during 1–15 min breathing/attention sessions) --------
  let wakeSentinel = null;
  let wakeWanted = false;

  async function acquireWakeLock() {
    wakeWanted = true;
    try {
      if (typeof navigator !== "undefined" && navigator.wakeLock && typeof navigator.wakeLock.request === "function") {
        if (wakeSentinel) return true;
        wakeSentinel = await navigator.wakeLock.request("screen");
        wakeSentinel.addEventListener("release", () => {
          wakeSentinel = null;
        });
        return true;
      }
    } catch (_) {}
    return false;
  }

  function releaseWakeLock() {
    wakeWanted = false;
    try {
      if (wakeSentinel) {
        wakeSentinel.release().catch(() => {});
        wakeSentinel = null;
      }
    } catch (_) {}
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && wakeWanted && !wakeSentinel) {
        acquireWakeLock();
      }
    });
  }

  return {
    unlock,
    enableIOSPlaybackSession,
    setEnabled,
    isEnabled,
    playCue,
    playBreathGlide,
    stopBreathGlide,
    playPhaseDoneChime,
    playTestTone,
    getDiagnostics,
    acquireWakeLock,
    releaseWakeLock,
  };
});
