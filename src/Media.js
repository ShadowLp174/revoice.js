const { AudioSource, LocalAudioTrack, TrackPublishOptions, TrackSource, AudioFrame } = require("@livekit/rtc-node");
const ffmpeg = require("fluent-ffmpeg");
const fPath = require("ffmpeg-static");
const { EventEmitter } = require("events");
const fs = require("fs"); // FIX: was missing — playFile() would crash with ReferenceError
const prism = require("prism-media");

// ---------------------------------------------------------------------------
// Backpressure constants
//
// FFmpeg decodes audio far faster than real-time. Without a cap every player
// buffers the entire decoded track — a 100h stream is ~64 GB of s16le PCM.
//
// At ~4 KB per chunk, MAX_CHUNKS=100 keeps the buffer under ~400 KB (~2 s of
// audio) per player regardless of track length.
// ---------------------------------------------------------------------------
const MAX_CHUNKS    = 100; // pause FFmpeg output when buffer reaches this size
const RESUME_CHUNKS =  40; // resume FFmpeg output once buffer drains this low

/**
 * @class
 * @classdesc Basic class to process audio streams.
 */
class Media extends EventEmitter {
    SAMPLE_RATE = 48000;
    CHANNELS = 2;
    id = null;

    constructor() {
        super();
        this.id = Math.random().toString(36) + Date.now();
        this.source = new AudioSource(this.SAMPLE_RATE, this.CHANNELS);
        this.track = LocalAudioTrack.createAudioTrack("audio-" + this.id, this.source);
    }

    playFile(path) {
        if (!path) throw "You must specify a file to play!";
        const stream = fs.createReadStream(path);
        this.playStream(stream);
    }
    playStream(stream) {
        if (!stream) throw "You must specify a stream to play!";
        throw "Unsupported. Use MediaPlayer instead.";
    }
}

/**
 * @class
 * @augments Media
 * @description An advanced version of the Media class with media controls.
 *
 * @property {number} seconds - Seconds elapsed during playback.
 * @property {string} currTimestamp - Current timestamp as `hh:mm:ss`.
 */
class MediaPlayer extends Media {
    /**
     * @param {boolean} normalisation=true Whether to pass the `loudnorm` filter to FFmpeg.
     */
    constructor(normalisation = true) {
        super();
        this.isMediaPlayer = true;
        this.loudnessNormalisation = normalisation;
        this.initValues();
    }

    initValues() {
        this.ready = true;
        this.volCache = null;

        this.paused = false;
        this.playing = false;
        this.started = false;
        // FIX: track stopped state so dangling volumeTransformer callbacks
        // that fire after stop() don't try to capture frames on a dead player.
        this.stopped = false;

        this.chunks = [];
        this.readyPlayPacket = true;
        this.ffmpegFinished = false;
        this.playedOutSamples = 0;
        this.codecData = null;

        this.originStream = null;
        this.fProc = null;
        // FIX: store the ffmpeg output pipe so #cleanUp() can destroy it and
        // free its internal buffer. In the original code this was a local
        // variable inside playStream() and was unreachable from cleanup.
        this._ffmpegOut = null;

        this.volumeTransformer = new prism.VolumeTransformer({ type: "s16le", volume: 1 });
        this.volumeTransformer.once("data", () => {
            this.playing = true;
            this.emit("startplay");
        });
    }

    pause() {
        if (this.paused) return;
        this.paused = true;
        // Also pause the FFmpeg output so we stop accumulating chunks while
        // playback is suspended — without this the buffer keeps growing.
        try { this._ffmpegOut?.pause(); } catch (_) {}
        this.emit("pause");
    }

    resume() {
        if (!this.paused) return;
        this.paused = false;
        // Only resume FFmpeg output if the buffer has room.
        if (this.chunks.length < RESUME_CHUNKS) {
            try { this._ffmpegOut?.resume(); } catch (_) {}
        }
        if (this.readyPlayPacket) this.playOutPacket();
        this.emit("unpause");
    }

    setVolume(v = 1) {
        this.volCache = v;
        return this.volumeTransformer.setVolume(v);
    }

    #cleanUp() {
        // FIX: destroy the ffmpeg output stream first — this frees Node.js
        // Readable buffer memory that was holding decoded PCM chunks.
        try { this._ffmpegOut?.destroy(); } catch (_) {}
        this._ffmpegOut = null;

        // Destroy the origin (input) stream so the HTTP connection closes.
        try { this.originStream?.destroy(); } catch (_) {}

        // FIX: original logic was `if (this.ffmpegFinished) this.fProc.kill()`
        // which is backwards — it only killed ffmpeg when already done (a no-op)
        // and left a live ffmpeg process running when stop() was called mid-stream.
        // Correct: always kill if the process is still alive.
        if (this.fProc) {
            try { this.fProc.kill(); } catch (_) {}
        }

        // Clear the chunks array so the PCM buffer is GC-eligible immediately.
        this.chunks = [];

        try { this.volumeTransformer.destroy(); } catch (_) {}
    }

    stop(init = true) {
        // Guard: if already stopped, don't re-emit "finish". Without this, the
        // unconditional mediaPlayer.stop() call at the top of _doPlayNext fires
        // a second "finish" event on an already-stopped player, which resolves
        // the _streamViaRevoice promise for the *next* song before it plays
        // a single frame — causing every song after the first to be skipped.
        if (this.stopped && init) return;
        this.stopped = true;
        this.readyPlayPacket = false; // prevent new packets from being queued
        this.#cleanUp();
        if (init) this.initValues();
        this.emit("finish");
    }

    destroy() {
        return this.stop(false);
    }

    get duration() {
        return this.codecData?.duration || 0;
    }

    get currTimestamp() {
        // FIX: original called `this.seconds()` as a function but `seconds`
        // is a getter — calling it as a function returned the getter function
        // itself, making Math.floor(NaN) produce "NaN:NaN:NaN".
        const sec_num = this.seconds;
        var hours   = Math.floor(sec_num / 3600);
        var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
        var seconds = sec_num - (hours * 3600) - (minutes * 60);
        if (hours   < 10) { hours   = "0" + hours;   }
        if (minutes < 10) { minutes = "0" + minutes; }
        if (seconds < 10) { seconds = "0" + seconds; }
        return hours + ":" + minutes + ":" + seconds;
    }

    get seconds() {
        return this.playedOutSamples / this.SAMPLE_RATE;
    }

    get localAudioTrack() {
        return this.track;
    }

    get publishOptions() {
        const options = new TrackPublishOptions();
        options.source = TrackSource.SOURCE_MICROPHONE;
        return options;
    }

    async publishToRoom(room) {
        await room.localParticipant.publishTrack(this.track, this.publishOptions);
    }

    async playOutPacket() {
        return new Promise((res) => {
            if (this.chunks.length === 0) return res(this.readyPlayPacket = true);
            this.readyPlayPacket = false;

            const c = this.chunks.shift();

            this.volumeTransformer.once("data", async (chunk) => {
                // FIX: guard against dangling promises. stop() destroys the
                // volumeTransformer but a .once("data") listener added just
                // before stop() fires can still execute here with stale data,
                // creating an AudioFrame for a player that's already dead.
                if (this.stopped) return res();

                const samples = new Int16Array(
                    chunk.buffer,
                    chunk.byteOffset,
                    chunk.length / 2 // chunk.length is in bytes
                );
                const frame = new AudioFrame(
                    samples,
                    this.SAMPLE_RATE,
                    this.CHANNELS,
                    Math.trunc(samples.length / this.CHANNELS)
                );

                await this.source.captureFrame(frame);
                this.playedOutSamples += samples.length / this.CHANNELS;

                // BACKPRESSURE: resume FFmpeg output when the buffer drains
                // below the low-water mark so it can refill the ~400 KB window.
                if (
                    this._ffmpegOut &&
                    !this.paused &&
                    !this.ffmpegFinished &&
                    this.chunks.length < RESUME_CHUNKS
                ) {
                    try { this._ffmpegOut.resume(); } catch (_) {}
                }

                if (this.chunks.length > 0 && !this.paused) return res(this.playOutPacket());
                this.readyPlayPacket = true;
                if (this.chunks.length === 0 && this.ffmpegFinished) this.stop();
                return res();
            });
            this.volumeTransformer.write(c);
        });
    }

    // FIX: accept the same `options` parameter that Player.mjs passes so it
    // doesn't silently discard rawPcm / loudnorm overrides.
    async playStream(stream, options = {}) {
        this.emit("buffer");
        this.originStream = stream;
        this.started = false;
        this.stopped = false;
        this.ffmpegFinished = false;
        this.playedOutSamples = 0;

        // When the caller signals rawPcm=true the stream is already decoded
        // s16le PCM (e.g. NodeLink /v4/loadstream). Tell FFmpeg the format
        // explicitly so it doesn't try to demux it as a container.
        const isRawPcm = options.rawPcm === true;

        let fProc = ffmpeg(stream)
            .noVideo()
            .setFfmpegPath(fPath);

        if (isRawPcm) {
            fProc = fProc.inputOptions([
                "-f s16le",
                `-ar ${this.SAMPLE_RATE}`,
                `-ac ${this.CHANNELS}`
            ]);
        }

        fProc = fProc.outputOptions([
            `-f s16le`,
            `-ar ${this.SAMPLE_RATE}`,
            `-ac ${this.CHANNELS}`
        ]);

        // Apply loudnorm unless explicitly disabled or the input is already raw PCM.
        const useLoudnorm = isRawPcm ? false
            : (options.loudnorm !== undefined ? options.loudnorm : this.loudnessNormalisation);
        if (useLoudnorm) {
            fProc = fProc.audioFilters("loudnorm");
        }

        fProc
            .on("start", (cli) => {
                // Keep the start log — it's the only way to see the exact FFmpeg
                // command line when diagnosing "Invalid data" errors.
                console.log("[MediaPlayer] FFmpeg started:", cli);
            })
            .on("error", (err) => {
                this.ffmpegFinished = true;
                // Suppress errors that come from our own intentional kill() —
                // when stop()/leave calls #cleanUp() it sends SIGKILL, which
                // fluent-ffmpeg turns into an "error" event. Without this guard
                // that bubbles up as an uncaughtException crashing the process.
                if (this.stopped) return;
                const msg = err?.message ?? String(err);
                if (
                    msg.includes("SIGKILL") ||
                    msg.includes("killed with signal") ||
                    msg.includes("aborted") ||
                    msg.includes("Input stream error")
                ) return;
                this.emit("error", err);
            })
            .on("codecData", (d) => {
                this.codecData = d;
            })
            .on("end", () => {
                this.ffmpegFinished = true;
            });

        this.fProc = fProc;

        // FIX: store the pipe reference so #cleanUp() can destroy it.
        const out = fProc.pipe();
        this._ffmpegOut = out;

        out.on("data", (chunk) => {
            if (this.stopped) return;
            this.chunks.push(chunk);

            // BACKPRESSURE: pause FFmpeg output when the buffer is full.
            // Without this, FFmpeg decodes the entire track into this.chunks
            // before playback consumes anything.
            // 100h stream at 48kHz stereo s16le ≈ 64 GB — we cap at ~400 KB.
            if (this.chunks.length >= MAX_CHUNKS) {
                try { out.pause(); } catch (_) {}
            }

            if (this.readyPlayPacket && !this.paused) return this.playOutPacket();
        });
        out.on("error", (err) => {
            this.ffmpegFinished = true;
            if (!this.stopped) this.emit("error", err);
        });
        out.on("end", () => {
            this.ffmpegFinished = true;
            if (!this.stopped && this.chunks.length === 0) this.stop();
        });
    }
}

module.exports = { MediaPlayer, Media };
