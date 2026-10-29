const { EventEmitter } = require("events");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const https = require("https");
const RingBuffer = require("./RingBuffer.js");
const DSPChain = require("../dsp/DSPChain.js");
const Pacer = require("./Pacer.js");

let ffmpegPath = "ffmpeg";
try {
  ffmpegPath = require("ffmpeg-static") || "ffmpeg";
} catch (_) {}

/**
 * Shared state indices when backed by a SharedArrayBuffer Int32Array(8):
 * [0]: state (0=IDLE, 1=BUFFERING, 2=PLAYING, 3=PAUSED, 4=STOPPED)
 * [1]: paused (0 or 1)
 * [2]: playedSamples (total samples per channel played on current track)
 * [3]: volumeMilli (volume * 1000, e.g., 1000 = 100%)
 * [4]: bufferBytes (current available bytes in primary RingBuffer)
 * [5]: underrunCount
 * [6]: durationMs (detected codec duration in ms, if any)
 */
const STATE_IDX = {
  STATE: 0,
  PAUSED: 1,
  PLAYED_SAMPLES: 2,
  VOLUME_MILLI: 3,
  BUFFER_BYTES: 4,
  UNDERRUNS: 5,
  DURATION_MS: 6,
};

/**
 * @class AudioPipeline
 * @augments EventEmitter
 * @classdesc Pull-driven per-channel audio processing pipeline.
 * Supports:
 * - Direct PCM Fast-Path (`s16le` 48kHz 2ch from NodeLink/Lavalink or raw PCM streams), does not use any FFmpeg processes for higher performance.
 * - Managed FFmpeg Demuxer fallback for encoded files, HTTP streams, and Icecast/Shoutcast radio stations,
 *   with guaranteed child-process termination (`SIGTERM` + `SIGKILL` guard) on skip/stop/destroy.
 * - Bounded `RingBuffer` with automatic `.pause()` / `.resume()` backpressure on upstream streams.
 * - In-memory `DSPChain` (`MixerNode` overlays, `BiquadFilterNode`, `LoudnormNode`, `VolumeNode`).
 */
class AudioPipeline extends EventEmitter {
  static STATE_IDX = STATE_IDX;

  /**
   * @param {Object} [options={}]
   * @param {number} [options.sampleRate=48000]
   * @param {number} [options.channels=2]
   * @param {number} [options.frameDurationMs=20]
   * @param {number} [options.bufferDurationMs=2500] RingBuffer capacity (default 2.5s = 480 KB)
   * @param {number} [options.prebufferFrames=3] Minimum 20ms frames buffered before starting playback (60ms)
   * @param {boolean} [options.normalisation=true]
   * @param {number} [options.volume=1.0]
   * @param {Pacer} [options.pacer]
   * @param {SharedArrayBuffer} [options.sharedStateBuffer]
   * @param {(frame: Int16Array, samplesPerChannel: number) => Promise<void>|void} [options.onFrame]
   */
  constructor(options = {}) {
    super();

    this.sampleRate = options.sampleRate || 48000;
    this.channels = options.channels || 2;
    this.frameDurationMs = options.frameDurationMs || 20;
    this.samplesPerChannel = Math.floor((this.sampleRate * this.frameDurationMs) / 1000); // 960
    this.frameSamples = this.samplesPerChannel * this.channels; // 1920 Int16s
    this.frameBytes = this.frameSamples * 2; // 3840 bytes

    const bufferDurationMs = options.bufferDurationMs || 2500;
    const capacityBytes = Math.ceil((bufferDurationMs / this.frameDurationMs) * this.frameBytes);

    this.prebufferBytes = (options.prebufferFrames ?? 3) * this.frameBytes;
    this.pacer = options.pacer || Pacer.shared;
    this.onFrame = options.onFrame || null;

    this.sharedState = options.sharedStateBuffer
      ? new Int32Array(options.sharedStateBuffer)
      : new Int32Array(8);

    this.dsp = new DSPChain({
      sampleRate: this.sampleRate,
      channels: this.channels,
      frameDurationMs: this.frameDurationMs,
      normalisation: options.normalisation ?? true,
      volume: options.volume ?? 1.0,
    });

    this.ringBuffer = new RingBuffer(capacityBytes, {
      highWaterMarkRatio: 0.8,
      lowWaterMarkRatio: 0.35,
      onHighWaterMark: () => this.#applyUpstreamBackpressure(true),
      onLowWaterMark: () => {
        this.#drainPendingRemainder();
        this.#applyUpstreamBackpressure(false);
      },
    });

    this._frameBuffer = new Int16Array(this.frameSamples);
    this._activeSourceStream = null;
    this._activeFfmpegProc = null;
    this._activeHttpReq = null;
    this._primaryRemainder = null;
    this._overlayCleanupMap = new Map();

    this.playing = false;
    this.paused = false;
    this.started = false;
    this.sourceEof = false;
    this.playedOutSamples = 0;
    this.durationSec = 0;
    this._capturingFrame = false;

    this.#syncSharedState(0);
    Atomics.store(this.sharedState, STATE_IDX.VOLUME_MILLI, Math.round((options.volume ?? 1.0) * 1000));
  }

  #syncSharedState(stateCode) {
    if (stateCode !== undefined) {
      Atomics.store(this.sharedState, STATE_IDX.STATE, stateCode);
    }
    Atomics.store(this.sharedState, STATE_IDX.PAUSED, this.paused ? 1 : 0);
    Atomics.store(this.sharedState, STATE_IDX.PLAYED_SAMPLES, Math.trunc(this.playedOutSamples));
    Atomics.store(this.sharedState, STATE_IDX.BUFFER_BYTES, this.ringBuffer.availableRead);
  }

  #applyUpstreamBackpressure(pause) {
    const stream = this._activeFfmpegProc ? this._activeFfmpegProc.stdout : this._activeSourceStream;
    if (!stream) return;
    try {
      if (pause && typeof stream.pause === "function" && !stream.isPaused?.()) {
        stream.pause();
      } else if (!pause && typeof stream.resume === "function" && stream.isPaused?.()) {
        stream.resume();
      }
    } catch (_) {}
  }

  #drainPendingRemainder() {
    if (!this._primaryRemainder || this._primaryRemainder.length === 0) return;
    const alignedLen = this._primaryRemainder.length & ~3;
    if (alignedLen === 0) return;

    let offset = 0;
    while (offset < alignedLen) {
      const written = this.ringBuffer.write(this._primaryRemainder, offset, alignedLen - offset);
      if (written === 0) {
        this._primaryRemainder = this._primaryRemainder.subarray(offset);
        return;
      }
      offset += written;
    }
    this._primaryRemainder = offset < this._primaryRemainder.length ? this._primaryRemainder.subarray(offset) : null;
    this.#syncSharedState();
  }

  /**
   * Detect if `inputOptions` indicate the input stream is already raw 48kHz 2ch s16le PCM.
   * This enables the Zero-FFmpeg Fast Path (e.g. NodeLink `loadDirectStream`).
   * @param {string[]|Object} [inputOptions]
   * @returns {boolean}
   */
  static isRawS16le48kStereo(inputOptions) {
    if (!inputOptions) return false;
    if (typeof inputOptions === "object" && !Array.isArray(inputOptions)) {
      return (
        inputOptions.rawPcm === true ||
        (inputOptions.format === "s16le" &&
          (inputOptions.sampleRate === 48000 || !inputOptions.sampleRate) &&
          (inputOptions.channels === 2 || !inputOptions.channels))
      );
    }
    if (Array.isArray(inputOptions)) {
      const joined = inputOptions.join(" ").toLowerCase();
      return (
        joined.includes("-f s16le") &&
        (joined.includes("-ar 48000") || !joined.includes("-ar ")) &&
        (joined.includes("-ac 2") || !joined.includes("-ac "))
      );
    }
    return false;
  }

  /**
   * Play a file path, HTTP(S) URL, or Node.js Readable stream.
   * @param {import("stream").Readable|string} source
   * @param {string[]|Object} [inputOptions=[]]
   */
  playStream(source, inputOptions = []) {
    // Clean up any previous primary stream first without emitting "finish"
    this.#cleanupPrimarySource();
    this.ringBuffer.clear();
    this.dsp.resetTrackState();
    this._primaryRemainder = null;

    this.playing = false;
    this.paused = false;
    this.started = false;
    this.sourceEof = false;
    this.playedOutSamples = 0;
    this.durationSec = 0;
    Atomics.store(this.sharedState, STATE_IDX.DURATION_MS, 0);
    this.#syncSharedState(1); // BUFFERING
    this.emit("buffer");

    if (typeof source === "string") {
      if (/^https?:\/\//i.test(source)) {
        this.#ingestUrl(source, inputOptions);
      } else {
        const fileStream = fs.createReadStream(source);
        this.#ingestStream(fileStream, inputOptions);
      }
    } else if (source && typeof source.on === "function") {
      this.#ingestStream(source, inputOptions);
    } else {
      const err = new Error("Invalid audio source provided to AudioPipeline.playStream()");
      this.emit("error", err);
      this.stop();
    }
  }

  /**
   * Play an overlay stream (e.g. soundboard clip, TTS announcement) mixed in-memory over the current track.
   * @param {import("stream").Readable|string|Buffer} source
   * @param {Object} [options={}]
   * @param {number} [options.volume=1.0]
   * @param {boolean} [options.duckPrimary=false]
   * @param {boolean} [options.rawPcm=false]
   * @returns {string} Overlay ID that can be used to cancel the overlay
   */
  playOverlay(source, options = {}) {
    const id = "ov-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    let upstream = null;
    let ffProc = null;

    const ring = this.dsp.mixer.createOverlay(id, {
      volume: options.volume ?? 1.0,
      duckPrimary: !!options.duckPrimary,
      onHighWaterMark: () => {
        const s = ffProc ? ffProc.stdout : upstream;
        if (s && typeof s.pause === "function") s.pause();
      },
      onLowWaterMark: () => {
        const s = ffProc ? ffProc.stdout : upstream;
        if (s && typeof s.resume === "function") s.resume();
      },
      onFinish: () => {
        this.#cleanupOverlayResources(id);
        this.emit("overlayFinish", id);
      },
    });

    // Ensure the pacer is running even if only an overlay is playing
    this.pacer.add(this);

    if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
      ring.write(source);
      this.dsp.mixer.markOverlayEof(id);
      return id;
    }

    const isRaw = options.rawPcm || AudioPipeline.isRawS16le48kStereo(options.inputOptions);
    let inputStream = source;
    if (typeof source === "string" && !/^https?:\/\//i.test(source)) {
      inputStream = fs.createReadStream(source);
    }

    if (isRaw && inputStream && typeof inputStream.on === "function") {
      upstream = inputStream;
      this.#pipePcmIntoRing(upstream, ring, () => this.dsp.mixer.markOverlayEof(id));
    } else {
      ffProc = this.#spawnFfmpegDemuxer(inputStream, options.inputOptions || []);
      this.#pipePcmIntoRing(ffProc.stdout, ring, () => this.dsp.mixer.markOverlayEof(id));
      ffProc.on("error", () => this.dsp.mixer.markOverlayEof(id));
    }

    this._overlayCleanupMap.set(id, { upstream, ffProc });
    return id;
  }

  #cleanupOverlayResources(id) {
    const res = this._overlayCleanupMap.get(id);
    if (!res) return;
    this._overlayCleanupMap.delete(id);
    if (res.ffProc) this.#killFfmpeg(res.ffProc);
    if (res.upstream && typeof res.upstream.destroy === "function") {
      try {
        res.upstream.destroy();
      } catch (_) {}
    }
  }

  #pipePcmIntoRing(readable, ringBuffer, onEnd) {
    let pendingRemainder = null;

    readable.on("data", (chunk) => {
      let buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (pendingRemainder && pendingRemainder.length > 0) {
        buf = Buffer.concat([pendingRemainder, buf]);
        pendingRemainder = null;
      }

      // Maintain 4-byte stereo 16-bit alignment
      const alignedLen = buf.length & ~3;
      if (alignedLen < buf.length) {
        pendingRemainder = buf.subarray(alignedLen);
      }
      if (alignedLen === 0) return;

      let offset = 0;
      while (offset < alignedLen) {
        const written = ringBuffer.write(buf, offset, alignedLen - offset);
        if (written === 0) {
          // RingBuffer is completely full; pause readable and keep remainder for next drain
          pendingRemainder = buf.subarray(offset);
          if (typeof readable.pause === "function") readable.pause();
          break;
        }
        offset += written;
      }
    });

    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      onEnd();
    };

    readable.once("end", finish);
    readable.once("close", finish);
    readable.once("error", finish);
  }

  #ingestUrl(url, inputOptions) {
    const isRaw = AudioPipeline.isRawS16le48kStereo(inputOptions);
    if (isRaw) {
      const client = url.startsWith("https:") ? https : http;
      const req = client.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          this.emit("error", new Error(`HTTP ${res.statusCode} streaming ${url}`));
          this.stop();
          return;
        }
        this.#ingestStream(res, inputOptions);
      });
      req.on("error", (err) => {
        this.emit("error", err);
        this.stop();
      });
      this._activeHttpReq = req;
      return;
    }

    // Use FFmpeg directly for HTTP(S) radio / encoded URLs so FFmpeg handles reconnects & demuxing
    const proc = this.#spawnFfmpegDemuxer(url, inputOptions);
    this._activeFfmpegProc = proc;
    this.#attachPrimaryPcmOutput(proc.stdout);
  }

  #ingestStream(stream, inputOptions) {
    this._activeSourceStream = stream;
    const isRaw = AudioPipeline.isRawS16le48kStereo(inputOptions);

    if (isRaw) {
      // Zero-FFmpeg Fast Path!
      this.#attachPrimaryPcmOutput(stream);
      stream.on("error", (err) => {
        this.emit("error", err);
        this.stop();
      });
      return;
    }

    // Encoded stream fallback: spawn managed FFmpeg demuxer
    const proc = this.#spawnFfmpegDemuxer(stream, inputOptions);
    this._activeFfmpegProc = proc;
    this.#attachPrimaryPcmOutput(proc.stdout);
  }

  #attachPrimaryPcmOutput(pcmStream) {
    this._primaryRemainder = null;
    let totalBytesReceived = 0;

    pcmStream.on("data", (chunk) => {
      let buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytesReceived += buf.length;
      if (this._primaryRemainder && this._primaryRemainder.length > 0) {
        buf = Buffer.concat([this._primaryRemainder, buf]);
        this._primaryRemainder = null;
      }

      const alignedLen = buf.length & ~3;
      if (alignedLen < buf.length) {
        this._primaryRemainder = buf.subarray(alignedLen);
      }
      if (alignedLen > 0) {
        let offset = 0;
        while (offset < alignedLen) {
          const written = this.ringBuffer.write(buf, offset, alignedLen - offset);
          if (written === 0) {
            // Buffer reached capacity; save remainder and pause upstream
            this._primaryRemainder = this._primaryRemainder
              ? Buffer.concat([buf.subarray(offset), this._primaryRemainder])
              : buf.subarray(offset);
            this.#applyUpstreamBackpressure(true);
            break;
          }
          offset += written;
        }
      }

      this.#syncSharedState();

      if (!this.started && this.ringBuffer.availableRead >= this.prebufferBytes) {
        this.started = true;
        this.playing = true;
        this.#syncSharedState(this.paused ? 3 : 2);
        this.emit("startplay");
        this.pacer.add(this);
      }
    });

    const onStreamEnd = () => {
      if (this.sourceEof) return;
      this.sourceEof = true;
      this.#drainPendingRemainder();

      const hasAudio = this.ringBuffer.availableRead > 0 || (this._primaryRemainder && this._primaryRemainder.length > 0);

      // If stream ended before reaching prebuffer threshold, still play out whatever arrived
      if (!this.started && hasAudio) {
        this.started = true;
        this.playing = true;
        this.#syncSharedState(this.paused ? 3 : 2);
        this.emit("startplay");
        this.pacer.add(this);
      } else if (!this.started && totalBytesReceived === 0 && !hasAudio) {
        this.emit("error", new Error("Audio stream ended prematurely with 0 bytes"));
        this.stop();
      } else if (!hasAudio) {
        this.stop();
      }
    };

    pcmStream.once("end", onStreamEnd);
    pcmStream.once("close", onStreamEnd);
  }

  #spawnFfmpegDemuxer(input, inputOptions = []) {
    const args = ["-hide_banner", "-loglevel", "warning", "-vn", "-sn", "-dn"];

    const extraInputArgs = Array.isArray(inputOptions)
      ? inputOptions.flatMap((opt) => String(opt).trim().split(/\s+/)).filter(Boolean)
      : [];

    if (typeof input === "string" && /^https?:\/\//i.test(input)) {
      args.push("-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "4");
    }

    args.push(...extraInputArgs);
    args.push("-i", typeof input === "string" ? input : "pipe:0");
    args.push(
      "-f", "s16le",
      "-ar", String(this.sampleRate),
      "-ac", String(this.channels),
      "pipe:1"
    );

    const proc = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: [typeof input === "string" ? "ignore" : "pipe", "pipe", "pipe"],
    });

    if (typeof input !== "string" && input && typeof input.pipe === "function") {
      proc.stdin.on("error", (err) => {
        if (err.code !== "EPIPE" && err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
          this.emit("error", err);
        }
      });
      input.on("error", (err) => {
        this.emit("error", err);
        this.#killFfmpeg(proc);
      });
      input.pipe(proc.stdin);
    }

    let lastStderr = "";
    proc.stderr.on("data", (data) => {
      const text = data.toString();
      lastStderr = (lastStderr + text).slice(-500);
      const durMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (durMatch) {
        const secs =
          parseInt(durMatch[1], 10) * 3600 +
          parseInt(durMatch[2], 10) * 60 +
          parseFloat(durMatch[3]);
        this.durationSec = secs;
        Atomics.store(this.sharedState, STATE_IDX.DURATION_MS, Math.round(secs * 1000));
        this.emit("codecData", { duration: secs });
      }
    });

    proc.on("close", (code) => {
      if (code && code !== 0 && !this.started && this.ringBuffer.availableRead === 0) {
        this.emit(
          "error",
          new Error(`FFmpeg demuxer exited with code ${code}${lastStderr ? ": " + lastStderr.trim() : ""}`)
        );
      }
    });

    proc.on("error", (err) => {
      this.emit("error", err);
      this.stop();
    });

    return proc;
  }

  #killFfmpeg(proc) {
    if (!proc) return;
    try {
      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.destroy();
      }
      if (proc.stdout && !proc.stdout.destroyed) {
        proc.stdout.destroy();
      }
      if (proc.stderr && !proc.stderr.destroyed) {
        proc.stderr.destroy();
      }
      if (proc.exitCode === null && !proc.killed) {
        proc.kill("SIGTERM");
        const killTimer = setTimeout(() => {
          try {
            if (proc.exitCode === null) proc.kill("SIGKILL");
          } catch (_) {}
        }, 1000);
        if (killTimer.unref) killTimer.unref();
      }
    } catch (_) {}
  }

  #cleanupPrimarySource() {
    if (this._activeHttpReq) {
      try {
        this._activeHttpReq.destroy();
      } catch (_) {}
      this._activeHttpReq = null;
    }
    if (this._activeSourceStream) {
      try {
        if (this._activeFfmpegProc && this._activeFfmpegProc.stdin) {
          this._activeSourceStream.unpipe(this._activeFfmpegProc.stdin);
        }
        if (typeof this._activeSourceStream.destroy === "function") {
          this._activeSourceStream.destroy();
        }
      } catch (_) {}
      this._activeSourceStream = null;
    }
    if (this._activeFfmpegProc) {
      this.#killFfmpeg(this._activeFfmpegProc);
      this._activeFfmpegProc = null;
    }
  }

  /**
   * Called every 20ms by the master Pacer.
   */
  tick() {
    if (this.paused) return;
    if (this._capturingFrame) return;

    if (this._primaryRemainder && this._primaryRemainder.length > 0) {
      this.#drainPendingRemainder();
      if (!this._primaryRemainder || this._primaryRemainder.length === 0) {
        if (this.ringBuffer.length <= this.ringBuffer.lowWaterMark) {
          this.#applyUpstreamBackpressure(false);
        }
      }
    }

    const hasPrimary = this.ringBuffer.availableRead > 0;
    const hasRemainder = this._primaryRemainder && this._primaryRemainder.length > 0;
    const hasOverlays = this.dsp.mixer.hasActiveOverlays();

    if (!hasPrimary && !hasRemainder && !hasOverlays) {
      if (this.sourceEof) {
        this.stop();
      } else if (this.started) {
        Atomics.add(this.sharedState, STATE_IDX.UNDERRUNS, 1);
      }
      return;
    }

    const frame = this._frameBuffer;
    let samplesRead = 0;

    if (hasPrimary) {
      // Allow partial frame read only when source has reached EOF and no remainder is queued
      samplesRead = this.ringBuffer.readFrameInt16(frame, this.sourceEof && !hasRemainder);
      if (samplesRead === 0 && !hasOverlays) {
        Atomics.add(this.sharedState, STATE_IDX.UNDERRUNS, 1);
        return;
      }
    } else {
      frame.fill(0);
    }

    // Run in-memory DSP chain (overlays, biquad EQ, loudnorm, volume ramp)
    this.dsp.processFrame(frame);

    if (samplesRead > 0) {
      this.playedOutSamples += samplesRead / this.channels;
    }
    this.#syncSharedState();

    if (this.onFrame) {
      const res = this.onFrame(frame, this.samplesPerChannel);
      if (res && typeof res.then === "function") {
        this._capturingFrame = true;
        res.then(
          () => {
            this._capturingFrame = false;
            const hasRem = this._primaryRemainder && this._primaryRemainder.length > 0;
            if (this.sourceEof && this.ringBuffer.availableRead === 0 && !hasRem && !this.dsp.mixer.hasActiveOverlays()) {
              this.stop();
            }
          },
          (err) => {
            this._capturingFrame = false;
            this.emit("error", err);
          }
        );
        return;
      }
    }

    if (this.sourceEof && this.ringBuffer.availableRead === 0 && !hasRemainder && !this.dsp.mixer.hasActiveOverlays()) {
      this.stop();
    }
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.#syncSharedState(3);
    this.emit("pause");
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.#syncSharedState(this.playing ? 2 : 0);
    this.emit("unpause");
  }

  setVolume(v = 1.0) {
    this.dsp.setVolume(v);
    Atomics.store(this.sharedState, STATE_IDX.VOLUME_MILLI, Math.round(v * 1000));
  }

  setFilter(filterConfig) {
    this.dsp.setFilter(filterConfig);
  }

  setNormalisation(enabled) {
    this.dsp.setNormalisation(enabled);
  }

  /**
   * Stop current track playback and reset pipeline state.
   * @param {boolean} [emitFinish=true]
   */
  stop(emitFinish = true) {
    const wasActive = this.started || this.playing || this._activeSourceStream || this._activeFfmpegProc;
    this.#cleanupPrimarySource();
    this.ringBuffer.clear();
    this._primaryRemainder = null;

    this.playing = false;
    this.paused = false;
    this.started = false;
    this.sourceEof = false;

    if (!this.dsp.mixer.hasActiveOverlays()) {
      this.pacer.remove(this);
    }

    this.#syncSharedState(0);
    if (emitFinish && wasActive) {
      this.emit("finish");
    }
  }

  destroy() {
    this.pacer.remove(this);
    for (const id of this._overlayCleanupMap.keys()) {
      this.#cleanupOverlayResources(id);
    }
    this.dsp.mixer.clear();
    this.stop(false);
    this.removeAllListeners();
  }
}

module.exports = AudioPipeline;
