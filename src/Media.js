const { AudioSource, LocalAudioTrack, TrackPublishOptions, TrackSource, AudioFrame } = require("@livekit/rtc-node");
const ffmpeg = require("fluent-ffmpeg");
const fPath = require("ffmpeg-static");
const { EventEmitter } = require("events");
const fs = require("fs");
const prism = require("prism-media");

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
 * Pipeline (demand-driven, nothing buffered in JS memory):
 *
 *   FFmpeg stdout (paused/Readable mode)
 *       → one chunk read manually via stream.read()
 *           → VolumeTransformer.write() / read one transformed chunk
 *               → AudioFrame → AudioSource.captureFrame()  (real-time async)
 *                   → loop back and read the next chunk
 *
 * FFmpeg stdout is kept in paused mode. We call .read() only after
 * captureFrame() resolves, so FFmpeg is throttled to exactly playback speed
 * and nothing accumulates in memory regardless of track length.
 */
class MediaPlayer extends Media {
    constructor(normalisation = true) {
        super();
        this.isMediaPlayer = true;
        this.loudnessNormalisation = normalisation;
        this.initValues();
    }

    initValues() {
        this.ready            = true;
        this.volCache         = null;
        this.paused           = false;
        this.playing          = false;
        this.stopped          = false;
        this.playedOutSamples = 0;
        this.codecData        = null;
        this.originStream     = null;
        this.fProc            = null;
        this._ffmpegOut       = null;
        this._unpauseResolve  = null;

        this.volumeTransformer = new prism.VolumeTransformer({ type: "s16le", volume: 1 });
    }

    pause() {
        if (this.paused) return;
        this.paused = true;
        this.emit("pause");
    }

    resume() {
        if (!this.paused) return;
        this.paused = false;
        if (this._unpauseResolve) {
            this._unpauseResolve();
            this._unpauseResolve = null;
        }
        this.emit("unpause");
    }

    setVolume(v = 1) {
        this.volCache = v;
        return this.volumeTransformer.setVolume(v);
    }

    _waitForResume() {
        return new Promise(resolve => { this._unpauseResolve = resolve; });
    }

    #cleanUp() {
        try { this._ffmpegOut?.destroy(); }       catch (_) {}
        this._ffmpegOut = null;
        try { this.originStream?.destroy(); }     catch (_) {}
        if (this.fProc) {
            try { this.fProc.kill(); }            catch (_) {}
        }
        try { this.volumeTransformer.destroy(); } catch (_) {}
        if (this._unpauseResolve) {
            this._unpauseResolve();
            this._unpauseResolve = null;
        }
    }

    stop(init = true) {
        const wasPlaying = !this.stopped;
        this.stopped = true;
        this.#cleanUp();
        if (init) {
            this.initValues();
            this.stopped = true; // survive initValues() reset
        }
        if (wasPlaying) this.emit("finish");
    }

    destroy() { return this.stop(false); }

    get duration()        { return this.codecData?.duration || 0; }
    get seconds()         { return this.playedOutSamples / this.SAMPLE_RATE; }
    get localAudioTrack() { return this.track; }

    get currTimestamp() {
        const s   = Math.floor(this.seconds);
        const h   = Math.floor(s / 3600);
        const m   = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return [h, m, sec].map(n => String(n).padStart(2, "0")).join(":");
    }

    get publishOptions() {
        const options = new TrackPublishOptions();
        options.source = TrackSource.SOURCE_MICROPHONE;
        return options;
    }

    async publishToRoom(room) {
        await room.localParticipant.publishTrack(this.track, this.publishOptions);
    }

    /**
     * Read exactly one chunk from a stream that is in paused mode.
     * Returns null when the stream ends.
     */
    _readChunk(readable) {
        return new Promise((resolve) => {
            // Try a synchronous read first — data may already be in the
            // stream's tiny internal highWaterMark buffer (default 16 KB).
            const chunk = readable.read();
            if (chunk !== null) return resolve(chunk);

            // Nothing available yet — wait for the next "readable" event,
            // which fires when at least one chunk is ready, then read it.
            const onReadable = () => {
                cleanup();
                resolve(readable.read());
            };
            const onEnd = () => { cleanup(); resolve(null); };
            const onClose = () => { cleanup(); resolve(null); };
            const onError = () => { cleanup(); resolve(null); };

            const cleanup = () => {
                readable.off("readable", onReadable);
                readable.off("end",      onEnd);
                readable.off("close",    onClose);
                readable.off("error",    onError);
            };

            readable.once("readable", onReadable);
            readable.once("end",      onEnd);
            readable.once("close",    onClose);
            readable.once("error",    onError);
        });
    }

    /**
     * Write one chunk into the VolumeTransformer and read back the
     * transformed output synchronously. prism-media's VolumeTransformer
     * is a synchronous Transform — one write always produces one read.
     */
    _transformChunk(chunk) {
        this.volumeTransformer.write(chunk);
        return this.volumeTransformer.read();
    }

    /**
     * Demand-driven playback loop.
     *
     * We keep FFmpeg's output stream in paused (non-flowing) mode and call
     * .read() only after captureFrame() has returned. This means:
     *   - FFmpeg stdout OS buffer: at most ~64 KB (kernel default pipe size)
     *   - VolumeTransformer buffer: at most one chunk (~few KB, highWaterMark)
     *   - JS heap: nothing stored between iterations
     *
     * Total memory per player: ~few KB, regardless of track length.
     */
    async _processLoop(out) {
        // Ensure the stream is in paused mode — we drive reads manually.
        out.pause();

        let firstChunk = true;
        while (!this.stopped) {
            // Pause gate — block here without consuming any data.
            while (this.paused && !this.stopped) {
                await this._waitForResume();
            }
            if (this.stopped) break;

            const raw = await this._readChunk(out);
            if (raw === null || this.stopped) break; // stream ended or stopped

            const chunk = this._transformChunk(raw);
            if (!chunk) continue; // transformer not ready yet (shouldn't happen)

            if (firstChunk) {
                firstChunk = false;
                this.playing = true;
                this.emit("startplay");
            }

            const samples = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2);
            const frame   = new AudioFrame(
                samples, this.SAMPLE_RATE, this.CHANNELS,
                Math.trunc(samples.length / this.CHANNELS)
            );

            // captureFrame is real-time async — it resolves at exactly the
            // right wall-clock time for the frame. This is what throttles the
            // entire pipeline: FFmpeg can't produce more data than we consume.
            await this.source.captureFrame(frame);
            if (this.stopped) break;

            this.playedOutSamples += samples.length / this.CHANNELS;
        }

        if (!this.stopped) this.stop();
    }

    async playStream(stream, options = {}) {
        this.emit("buffer");
        this.originStream     = stream;
        this.stopped          = false;
        this.playing          = false;
        this.playedOutSamples = 0;

        const isRawPcm = options.rawPcm === true;

        let fProc = ffmpeg(stream).noVideo().setFfmpegPath(fPath);

        if (isRawPcm) {
            fProc = fProc.inputOptions([
                "-f s16le",
                `-ar ${this.SAMPLE_RATE}`,
                `-ac ${this.CHANNELS}`
            ]);
        }

        fProc = fProc.outputOptions([
            "-f s16le",
            `-ar ${this.SAMPLE_RATE}`,
            `-ac ${this.CHANNELS}`
        ]);

        const useLoudnorm = isRawPcm ? false
            : (options.loudnorm !== undefined ? options.loudnorm : this.loudnessNormalisation);
        if (useLoudnorm) fProc = fProc.audioFilters("loudnorm");

        fProc
            .on("start",    (cli) => console.log("[MediaPlayer] FFmpeg started:", cli))
            .on("error",    (err) => {
                if (this.stopped) return;
                const msg = err?.message ?? String(err);
                if (
                    msg.includes("SIGKILL")            ||
                    msg.includes("killed with signal") ||
                    msg.includes("aborted")            ||
                    msg.includes("Input stream error")
                ) return;
                this.emit("error", err);
            })
            .on("codecData", (d) => { this.codecData = d; })
            .on("end",       ()  => { /* _processLoop drives completion */ });

        this.fProc = fProc;

        // Get the output stream and immediately switch it to paused mode
        // so _processLoop controls every read.
        const out = fProc.pipe();
        this._ffmpegOut = out;

        // Drive playback. _processLoop keeps out in paused mode and only
        // calls .read() after each captureFrame() — true demand-driven I/O.
        this._processLoop(out);
    }
}

module.exports = { MediaPlayer, Media };
