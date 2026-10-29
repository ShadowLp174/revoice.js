const { EventEmitter } = require("events");
const fs = require("fs");
const AudioPipeline = require("./engine/AudioPipeline.js");
const WorkerPoolManager = require("./engine/WorkerPoolManager.js");

const STATE_IDX = AudioPipeline.STATE_IDX;

let livekitCache = null;
/**
 * @typedef {import('@livekit/rtc-node')} Livekit
 */
/**
 * @returns {Livekit | null}
 */
function getLiveKitOptional() {
  if (livekitCache) return livekitCache;
  try {
    if (!process.env.LIVEKIT_LOG_LEVEL) {
      process.env.LIVEKIT_LOG_LEVEL = "warn";
    }
    livekitCache = require("@livekit/rtc-node");
    return livekitCache;
  } catch (_) {
    return null;
  }
}

/**
 * @class Media
 * @augments EventEmitter
 * @classdesc Base class for audio sources and track publishing in Revoice.js.
 * Supports both direct LiveKit `Room` publishing (backwards-compatible) and
 * pluggable `BaseTransportAdapter` sinks.
 */
class Media extends EventEmitter {
  SAMPLE_RATE = 48000;
  CHANNELS = 2;
  QUEUE_SIZE_MS = 200; // 200ms internal queue (10 x 20ms frames) to absorb worker/IPC jitter
  id = null;

  /**
   * @param {Object} [options={}]
   * @param {number} [options.sampleRate=48000]
   * @param {number} [options.channels=2]
   * @param {number} [options.queueSizeMs=200]
   */
  constructor(options = {}) {
    super();

    if (options && typeof options === "object") {
      if (options.sampleRate) this.SAMPLE_RATE = options.sampleRate;
      if (options.channels) this.CHANNELS = options.channels;
      if (options.queueSizeMs) this.QUEUE_SIZE_MS = options.queueSizeMs;
    }

    this.id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    this.adapter = null;
    this._source = null;
    this._track = null;
    this._reusableFrame = null;
    this._reusableSamples = null;
  }

  #ensureLiveKitTrack() {
    if (this._source && this._track) return;
    const lk = getLiveKitOptional();
    if (!lk) return;
    this._source = new lk.AudioSource(this.SAMPLE_RATE, this.CHANNELS, this.QUEUE_SIZE_MS);
    this._track = lk.LocalAudioTrack.createAudioTrack("audio-" + this.id, this._source);
  }

  get source() {
    this.#ensureLiveKitTrack();
    return this._source;
  }

  set source(val) {
    this._source = val;
  }

  get track() {
    this.#ensureLiveKitTrack();
    return this._track;
  }

  set track(val) {
    this._track = val;
  }

  get localAudioTrack() {
    return this.track;
  }

  get publishOptions() {
    const lk = getLiveKitOptional();
    if (!lk) return {};
    const options = new lk.TrackPublishOptions();
    options.source = lk.TrackSource.SOURCE_MICROPHONE;
    return options;
  }

  /**
   * Attach a transport adapter (e.g. `LiveKitAdapter`) or publish directly to a LiveKit `Room`.
   * @param {Object} roomOrAdapter
   */
  async publishToRoom(roomOrAdapter) {
    if (!roomOrAdapter) return;

    // If passed a BaseTransportAdapter (e.g., LiveKitAdapter)
    if (typeof roomOrAdapter.capturePcmFrame === "function") {
      this.adapter = roomOrAdapter;
      await this.adapter.publishAudioTrack();
      return;
    }

    // Backwards compatibility: direct LiveKit Room instance
    this.#ensureLiveKitTrack();
    if (roomOrAdapter.localParticipant && this._track) {
      await roomOrAdapter.localParticipant.publishTrack(this._track, this.publishOptions);
    }
  }

  /**
   * Push a 20ms Int16 PCM frame to the attached transport adapter or LiveKit AudioSource.
   * @param {Int16Array} int16Samples
   * @param {number} [samplesPerChannel=960]
   */
  async _capturePcmFrame(int16Samples, samplesPerChannel = 960) {
    if (this.adapter) {
      await this.adapter.capturePcmFrame(int16Samples, samplesPerChannel);
      return;
    }

    if (!this._source) {
      this.#ensureLiveKitTrack();
    }
    if (!this._source) return;

    const lk = getLiveKitOptional();
    if (!lk) return;

    if (
      !this._reusableFrame ||
      !this._reusableSamples ||
      this._reusableSamples.length !== int16Samples.length
    ) {
      this._reusableSamples = new Int16Array(int16Samples.length);
      this._reusableFrame = new lk.AudioFrame(
        this._reusableSamples,
        this.SAMPLE_RATE,
        this.CHANNELS,
        samplesPerChannel
      );
    }
    this._reusableSamples.set(int16Samples);
    await this._source.captureFrame(this._reusableFrame);
  }

  playFile(filePath) {
    if (!filePath) throw new Error("You must specify a file to play!");
    const stream = fs.createReadStream(filePath);
    return this.playStream(stream);
  }

  playStream(stream) {
    if (!stream) throw new Error("You must specify a stream to play!");
    throw new Error("Unsupported on base Media class. Use MediaPlayer instead.");
  }
}

/**
 * @class MediaPlayer
 * @augments Media
 * @classdesc High-performance audio player for Revoice.js.
 * Supports:
 * - Zero-FFmpeg direct PCM streaming (e.g. from NodeLink/Lavalink or raw streams)
 * - Automatic FFmpeg demuxing for arbitrary files, HTTP streams, and radio stations
 * - Worker-thread offloading via `WorkerPoolManager` (or in-thread execution)
 * - In-memory DSP chain: Volume ramping, real-time AGC/Loudnorm, Biquad EQ filters, and multi-stream overlay mixing
 *
 * @property {number} seconds - Elapsed playback duration in seconds.
 * @property {string} currTimestamp - Elapsed timestamp in `hh:mm:ss` format.
 * @property {boolean} paused - Whether playback is currently paused.
 * @property {boolean} playbackPaused - Alias for `paused` (for backwards compatibility).
 */
class MediaPlayer extends Media {
  /**
   * @param {boolean|Object} [normalisationOrOptions=true] Pass a boolean for loudness normalisation, or an options object.
   * @param {boolean} [normalisationOrOptions.normalisation=true] Whether to enable real-time loudness normalization.
   * @param {boolean} [normalisationOrOptions.useWorker=true] Whether to offload demuxing & DSP to the AudioWorker pool.
   * @param {number} [normalisationOrOptions.volume=1.0] Initial playback volume.
   * @param {number} [normalisationOrOptions.queueSizeMs=200] Internal WebRTC frame queue size in ms.
   */
  constructor(normalisationOrOptions = true) {
    const opts =
      typeof normalisationOrOptions === "boolean"
        ? { normalisation: normalisationOrOptions }
        : normalisationOrOptions || {};

    super(opts);

    this.isMediaPlayer = true;
    this.loudnessNormalisation = opts.normalisation ?? true;
    this.useWorker = opts.useWorker ?? true;
    this.error = null;

    // SharedArrayBuffer state view for synchronous reads of `seconds`, `paused`, etc.
    this.sharedStateBuffer = new SharedArrayBuffer(8 * Int32Array.BYTES_PER_ELEMENT);
    this.sharedState = new Int32Array(this.sharedStateBuffer);

    this._localPipeline = null;
    this._activeBridgedStream = null;
    this._destroyed = false;

    this.initValues(opts.volume ?? 1.0);
    this.#setupEngine();
  }

  initValues(initialVolume = 1.0) {
    this.ready = true;
    this._volume = initialVolume;
    this._filter = null;

    this._paused = false;
    this.playing = false;
    this.started = false;
    this.codecData = null;
  }

  #setupEngine() {
    const pipelineOptions = {
      sampleRate: this.SAMPLE_RATE,
      channels: this.CHANNELS,
      normalisation: this.loudnessNormalisation,
      volume: this._volume,
    };

    if (this.useWorker) {
      WorkerPoolManager.shared.createPipeline(
        this.id,
        pipelineOptions,
        this.sharedStateBuffer,
        (event, data) => this.#handleEngineEvent(event, data)
      );
    } else {
      this._localPipeline = new AudioPipeline({
        ...pipelineOptions,
        sharedStateBuffer: this.sharedStateBuffer,
        onFrame: (frame, samplesPerChannel) => this._capturePcmFrame(frame, samplesPerChannel),
      });
      this._localPipeline.on("buffer", () => this.#handleEngineEvent("buffer"));
      this._localPipeline.on("startplay", () => this.#handleEngineEvent("startplay"));
      this._localPipeline.on("pause", () => this.#handleEngineEvent("pause"));
      this._localPipeline.on("unpause", () => this.#handleEngineEvent("unpause"));
      this._localPipeline.on("finish", () => this.#handleEngineEvent("finish"));
      this._localPipeline.on("overlayFinish", (id) => this.#handleEngineEvent("overlayFinish", id));
      this._localPipeline.on("codecData", (d) => this.#handleEngineEvent("codecData", d));
      this._localPipeline.on("error", (err) => this.#handleEngineEvent("error", err));
    }
  }

  #handleEngineEvent(event, data) {
    if (this._destroyed) return;

    switch (event) {
      case "frame":
        this._capturePcmFrame(data.samples, data.samplesPerChannel).catch((err) => {
          this.error = err;
          if (this.listenerCount("error") > 0) {
            this.emit("error", err);
          }
        });
        break;
      case "backpressure":
        if (this._activeBridgedStream) {
          try {
            if (data && typeof this._activeBridgedStream.pause === "function") {
              this._activeBridgedStream.pause();
            } else if (!data && typeof this._activeBridgedStream.resume === "function") {
              this._activeBridgedStream.resume();
            }
          } catch (_) {}
        }
        break;
      case "buffer":
        this.emit("buffer");
        break;
      case "startplay":
        this.playing = true;
        this.started = true;
        this.emit("startplay");
        this.emit("start");
        break;
      case "pause":
        this._paused = true;
        this.emit("pause");
        break;
      case "unpause":
        this._paused = false;
        this.emit("unpause");
        break;
      case "finish":
        this.playing = false;
        this.started = false;
        this._paused = false;
        this.emit("finish");
        break;
      case "overlayFinish":
        this.emit("overlayFinish", data);
        break;
      case "codecData":
        this.codecData = data;
        this.emit("codecData", data);
        break;
      case "error":
        this.error = data instanceof Error ? data : new Error(data?.message || String(data));
        if (this.listenerCount("error") > 0) {
          this.emit("error", this.error);
        }
        break;
    }
  }

  /**
   * Whether playback is currently paused.
   * @returns {boolean}
   */
  get paused() {
    return Atomics.load(this.sharedState, STATE_IDX.PAUSED) === 1 || this._paused;
  }

  set paused(val) {
    this._paused = !!val;
  }

  /**
   * Alias for `paused` to preserve compatibility with callers checking `player.playbackPaused`.
   * @returns {boolean}
   */
  get playbackPaused() {
    return this.paused;
  }

  /**
   * Current playback volume (`1.0` = 100%).
   * @returns {number}
   */
  get volume() {
    return this._volume;
  }

  /**
   * Elapsed playback time in seconds for the current track.
   * Read synchronously from SharedArrayBuffer with zero IPC overhead.
   * @returns {number}
   */
  get seconds() {
    const samples = Atomics.load(this.sharedState, STATE_IDX.PLAYED_SAMPLES);
    return samples / this.SAMPLE_RATE;
  }

  /**
   * Total track duration in seconds (if reported by demuxer).
   * @returns {number}
   */
  get duration() {
    const ms = Atomics.load(this.sharedState, STATE_IDX.DURATION_MS);
    return ms > 0 ? ms / 1000 : this.codecData?.duration || 0;
  }

  /**
   * Formatted elapsed timestamp `hh:mm:ss`.
   * Fixed bug from earlier Media.js where `this.seconds()` was called as a function instead of a getter.
   * @returns {string}
   */
  get currTimestamp() {
    const secNum = Math.floor(this.seconds);
    const hours = Math.floor(secNum / 3600);
    const minutes = Math.floor((secNum - hours * 3600) / 60);
    const seconds = secNum - hours * 3600 - minutes * 60;

    const hStr = hours < 10 ? "0" + hours : String(hours);
    const mStr = minutes < 10 ? "0" + minutes : String(minutes);
    const sStr = seconds < 10 ? "0" + seconds : String(seconds);
    return `${hStr}:${mStr}:${sStr}`;
  }

  /**
   * Pause playback immediately.
   */
  pause() {
    if (this.paused) return;
    this._paused = true;
    Atomics.store(this.sharedState, STATE_IDX.PAUSED, 1);

    if (this.useWorker) {
      WorkerPoolManager.shared.post(this.id, { type: "pause" });
    } else {
      this._localPipeline.pause();
    }
  }

  /**
   * Resume paused playback.
   */
  resume() {
    if (!this.paused) return;
    this._paused = false;
    Atomics.store(this.sharedState, STATE_IDX.PAUSED, 0);

    if (this.useWorker) {
      WorkerPoolManager.shared.post(this.id, { type: "resume" });
    } else {
      this._localPipeline.resume();
    }
  }

  /**
   * Adjust playback volume smoothly without clicks/pops.
   * @param {number} [v=1] Volume multiplier (`1.0` = 100%, `0.5` = 50%).
   */
  setVolume(v = 1) {
    this._volume = Math.max(0, Number.isFinite(v) ? v : 1);
    Atomics.store(this.sharedState, STATE_IDX.VOLUME_MILLI, Math.round(this._volume * 1000));

    if (this.useWorker) {
      WorkerPoolManager.shared.post(this.id, { type: "setVolume", volume: this._volume });
    } else {
      this._localPipeline.setVolume(this._volume);
    }
  }

  /**
   * Apply a real-time EQ preset (`"bassboost"`, `"vocal"`, `"treble"`, `"lofi"`, `"off"`)
   * or an array of custom biquad filter band definitions.
   * @param {string|Array<Object>|null} filterConfig
   */
  setFilter(filterConfig) {
    this._filter = filterConfig;
    if (this.useWorker) {
      WorkerPoolManager.shared.post(this.id, { type: "setFilter", filter: filterConfig });
    } else {
      this._localPipeline.setFilter(filterConfig);
    }
  }

  /**
   * Enable or disable real-time loudness normalization (AGC + limiter).
   * @param {boolean} enabled
   */
  setNormalisation(enabled) {
    this.loudnessNormalisation = !!enabled;
    if (this.useWorker) {
      WorkerPoolManager.shared.post(this.id, {
        type: "setNormalisation",
        enabled: this.loudnessNormalisation,
      });
    } else {
      this._localPipeline.setNormalisation(this.loudnessNormalisation);
    }
  }

  /**
   * Play an audio file from disk.
   * When `useWorker` is enabled, the file path is sent directly to the worker thread so
   * zero file bytes cross the main thread.
   * @override
   * @param {string} filePath
   * @param {string[]|Object} [inputOptions=[]]
   */
  playFile(filePath, inputOptions = []) {
    if (!filePath) throw new Error("You must specify a file to play!");
    return this.playStream(filePath, inputOptions);
  }

  /**
   * Play a Node.js Readable stream, file path, or HTTP(S) URL.
   * If `inputOptions` specifies raw 48kHz stereo PCM (`["-f s16le", "-ar 48000", "-ac 2"]` or `{ rawPcm: true }`),
   * the engine bypasses FFmpeg completely and streams directly into the RingBuffer & DSP chain.
   *
   * @override
   * @param {import("stream").Readable|string} streamOrUrl
   * @param {string[]|Object} [inputOptions=[]]
   */
  async playStream(streamOrUrl, inputOptions = []) {
    if (!streamOrUrl) throw new Error("You must specify a stream or URL to play!");

    this.#cleanupBridgedStream();
    this.started = false;
    this.playing = false;
    this._paused = false;
    Atomics.store(this.sharedState, STATE_IDX.PLAYED_SAMPLES, 0);
    Atomics.store(this.sharedState, STATE_IDX.PAUSED, 0);

    if (!this.useWorker) {
      this._localPipeline.playStream(streamOrUrl, inputOptions);
      return;
    }

    // If given a URL or file path string, let the worker open & demux it directly with zero main-thread I/O!
    if (typeof streamOrUrl === "string") {
      WorkerPoolManager.shared.post(this.id, {
        type: "playSource",
        source: streamOrUrl,
        inputOptions,
      });
      return;
    }

    // Bridge a main-thread Node.js Readable stream to the worker with backpressure control
    this.#bridgeReadableToWorker(streamOrUrl, {
      inputOptions,
      isOverlay: false,
    });
  }

  /**
   * Mix an overlay audio source (soundboard effect, TTS clip, etc.) over the currently playing audio
   * in memory without spawning extra FFmpeg `amix` trees.
   * @param {import("stream").Readable|string|Buffer} source
   * @param {Object} [options={}]
   * @param {number} [options.volume=1.0]
   * @param {boolean} [options.duckPrimary=false]
   * @param {boolean} [options.rawPcm=false]
   * @param {string[]} [options.inputOptions=[]]
   */
  playOverlay(source, options = {}) {
    if (!this.useWorker) {
      return this._localPipeline.playOverlay(source, options);
    }

    if (typeof source === "string" || Buffer.isBuffer(source) || source instanceof Uint8Array) {
      WorkerPoolManager.shared.post(this.id, {
        type: "playOverlaySource",
        source,
        options,
      });
      return;
    }

    if (source && typeof source.on === "function") {
      this.#bridgeReadableToWorker(source, {
        inputOptions: options.inputOptions || [],
        isOverlay: true,
        overlayOptions: options,
      });
    }
  }

  #bridgeReadableToWorker(readable, { inputOptions, isOverlay, overlayOptions }) {
    const streamId = "st-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    if (!isOverlay) {
      this._activeBridgedStream = readable;
    }

    WorkerPoolManager.shared.post(this.id, {
      type: "openStream",
      streamId,
      inputOptions,
      isOverlay,
      overlayOptions,
    });

    const onData = (chunk) => {
      if (this._destroyed) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const copy = new Uint8Array(buf.byteLength);
      copy.set(buf);
      WorkerPoolManager.shared.post(
        this.id,
        {
          type: "streamChunk",
          streamId,
          chunk: copy,
        },
        [copy.buffer]
      );
    };

    const onEnd = () => {
      cleanupListeners();
      if (!this._destroyed) {
        WorkerPoolManager.shared.post(this.id, {
          type: "streamEnd",
          streamId,
        });
      }
    };

    const onError = (err) => {
      cleanupListeners();
      if (!this._destroyed) {
        WorkerPoolManager.shared.post(this.id, {
          type: "streamError",
          streamId,
          error: err?.message || String(err),
        });
      }
    };

    const cleanupListeners = () => {
      readable.removeListener("data", onData);
      readable.removeListener("end", onEnd);
      readable.removeListener("close", onEnd);
      readable.removeListener("error", onError);
      if (!isOverlay && this._activeBridgedStream === readable) {
        this._activeBridgedStream = null;
      }
    };

    readable.on("data", onData);
    readable.once("end", onEnd);
    readable.once("close", onEnd);
    readable.once("error", onError);
  }

  #cleanupBridgedStream() {
    if (this._activeBridgedStream) {
      try {
        if (typeof this._activeBridgedStream.destroy === "function") {
          this._activeBridgedStream.destroy();
        }
      } catch (_) {}
      this._activeBridgedStream = null;
    }
  }

  /**
   * Stop current playback immediately and clean up active streams/processes.
   * @param {boolean} [init=true]
   */
  stop(init = true) {
    this.#cleanupBridgedStream();

    if (this.adapter) {
      this.adapter.clearQueue();
    }

    if (this.useWorker) {
      WorkerPoolManager.shared.post(this.id, {
        type: "stop",
        emitFinish: false,
      });
    } else if (this._localPipeline) {
      this._localPipeline.stop(false);
    }

    Atomics.store(this.sharedState, STATE_IDX.STATE, 0);
    Atomics.store(this.sharedState, STATE_IDX.PAUSED, 0);
    Atomics.store(this.sharedState, STATE_IDX.PLAYED_SAMPLES, 0);

    if (init) {
      this.initValues(this._volume);
    }

    this.emit("finish");
  }

  /**
   * Destroy the MediaPlayer and release its worker pipeline.
   */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.#cleanupBridgedStream();

    if (this.useWorker) {
      WorkerPoolManager.shared.destroyPipeline(this.id);
    } else if (this._localPipeline) {
      this._localPipeline.destroy();
      this._localPipeline = null;
    }

    this.emit("finish");
  }
}

module.exports = { MediaPlayer, Media };
