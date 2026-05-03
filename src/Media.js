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
 * How the pipeline works (no chunk array, no manual backpressure):
 *
 *   HTTP/file stream
 *       → FFmpeg (decode/resample to s16le 48kHz stereo)
 *           → VolumeTransformer (prism-media Transform stream)
 *               → _processLoop() reads one frame at a time via async iterator
 *                   → AudioSource.captureFrame() (real-time, blocks until LiveKit
 *                      is ready for the next frame)
 *
 * Because captureFrame() is async and real-time, the entire pipeline naturally
 * throttles: VolumeTransformer's internal buffer fills → FFmpeg stdout buffer
 * fills → OS pipe buffer fills → FFmpeg itself slows to real-time speed.
 * No data is stored in JS memory regardless of track length.
 *
 * @property {number} seconds  - Seconds elapsed during playback.
 * @property {string} currTimestamp - Current timestamp as hh:mm:ss.
 */
class MediaPlayer extends Media {
    /**
     * @param {boolean} normalisation=true Whether to pass the loudnorm filter to FFmpeg.
     */
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
        // Resolve handle so _processLoop can be unblocked on pause/stop.
        this._unpauseResolve  = null;

        this.volumeTransformer = new prism.VolumeTransformer({ type: "s16le", volume: 1 });
        this.volumeTransformer.once("data", () => {
            this.playing = true;
            this.emit("startplay");
        });
    }

    pause() {
        if (this.paused) return;
        this.paused = true;
        this.emit("pause");
    }

    resume() {
        if (!this.paused) return;
        this.paused = false;
        // Unblock the _processLoop which is waiting on the pause gate.
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

    // Wait until unpaused (or stopped). Called inside the frame loop.
    _waitForResume() {
        return new Promise(resolve => {
            this._unpauseResolve = resolve;
        });
    }

    #cleanUp() {
        try { this._ffmpegOut?.destroy(); }    catch (_) {}
        this._ffmpegOut = null;
        try { this.originStream?.destroy(); }  catch (_) {}
        if (this.fProc) {
            try { this.fProc.kill(); }         catch (_) {}
        }
        try { this.volumeTransformer.destroy(); } catch (_) {}
        // Unblock _processLoop if paused so it can see stopped=true and exit.
        if (this._unpauseResolve) {
            this._unpauseResolve();
            this._unpauseResolve = null;
        }
    }

    stop(init = true) {
        // Only emit "finish" if we were actually playing. This prevents the
        // redundant stop() call at the top of _doPlayNext (for cleanup between
        // songs) from firing "finish" on a player that already naturally stopped,
        // which would resolve _streamViaRevoice\'s once("finish") for the next
        // song before it starts — causing every queued song to be skipped.
        const wasPlaying = !this.stopped;

        this.stopped = true;
        this.#cleanUp();

        if (init) {
            this.initValues();
            // initValues() resets stopped→false. Re-apply so redundant stop()
            // calls stay silent until playStream() marks the player live again.
            this.stopped = true;
        }

        if (wasPlaying) this.emit("finish");
    }

    destroy() {
        return this.stop(false);
    }

    get duration()      { return this.codecData?.duration || 0; }
    get seconds()       { return this.playedOutSamples / this.SAMPLE_RATE; }
    get localAudioTrack() { return this.track; }

    get currTimestamp() {
        const sec_num = this.seconds;
        let hours   = Math.floor(sec_num / 3600);
        let minutes = Math.floor((sec_num - hours * 3600) / 60);
        let seconds = Math.floor(sec_num - hours * 3600 - minutes * 60);
        if (hours   < 10) hours   = "0" + hours;
        if (minutes < 10) minutes = "0" + minutes;
        if (seconds < 10) seconds = "0" + seconds;
        return `${hours}:${minutes}:${seconds}`;
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
     * Core frame loop. Reads PCM chunks from the VolumeTransformer async
     * iterator one at a time, converts each to an AudioFrame, and feeds it
     * to LiveKit. Because captureFrame() is real-time async, this naturally
     * throttles FFmpeg to playback speed — no buffering in JS memory at all.
     */
    async _processLoop(volumeTransformer) {
        try {
            for await (const chunk of volumeTransformer) {
                if (this.stopped) break;

                // Pause gate — wait here until resume() is called.
                while (this.paused && !this.stopped) {
                    await this._waitForResume();
                }
                if (this.stopped) break;

                const samples = new Int16Array(
                    chunk.buffer,
                    chunk.byteOffset,
                    chunk.length / 2
                );
                const frame = new AudioFrame(
                    samples,
                    this.SAMPLE_RATE,
                    this.CHANNELS,
                    Math.trunc(samples.length / this.CHANNELS)
                );

                await this.source.captureFrame(frame);
                if (this.stopped) break;

                this.playedOutSamples += samples.length / this.CHANNELS;
            }
        } catch (err) {
            // Destroyed/ended streams throw ERR_STREAM_DESTROYED — that\'s
            // expected on stop(). Only surface genuine unexpected errors.
            if (!this.stopped) {
                const msg = err?.message ?? String(err);
                const graceful =
                    msg.includes("ERR_STREAM_DESTROYED") ||
                    msg.includes("aborted") ||
                    msg.includes("premature close");
                if (!graceful) this.emit("error", err);
            }
        }

        // Loop exited — either track ended naturally or stop() was called.
        if (!this.stopped) this.stop();
    }

    async playStream(stream, options = {}) {
        this.emit("buffer");
        this.originStream = stream;
        // Mark as live. stop() keeps stopped=true after cleanup so redundant
        // stop() calls are silent; playStream() is what reactivates the player.
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
            .on("start", (cli) => console.log("[MediaPlayer] FFmpeg started:", cli))
            .on("error", (err) => {
                // Suppress intentional kills (stop/leave sends SIGKILL).
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
            .on("codecData", (d) => { this.codecData = d; })
            .on("end",       ()  => { /* _processLoop handles completion */ });

        this.fProc = fProc;

        // Pipe FFmpeg output directly into the VolumeTransformer.
        // Node.js stream piping handles backpressure: when captureFrame()
        // blocks, the Transform buffer fills, FFmpeg stdout buffer fills,
        // and FFmpeg itself throttles — no data accumulates in JS memory.
        const out = fProc.pipe();
        this._ffmpegOut = out;
        out.pipe(this.volumeTransformer);

        // Start the async frame loop. Runs concurrently with the pipe.
        this._processLoop(this.volumeTransformer);
    }
}

module.exports = { MediaPlayer, Media };
