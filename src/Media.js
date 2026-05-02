const { AudioSource, LocalAudioTrack, TrackPublishOptions, TrackSource, AudioFrame } = require("@livekit/rtc-node");
const ffmpeg = require("fluent-ffmpeg");
const fPath = require("ffmpeg-static");
const { EventEmitter } = require("events");
const prism = require("prism-media");

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
		const stream = require("fs").createReadStream(path);
		this.playStream(stream);
	}
	playStream(stream) {
		if (!stream) throw "You must specify a stream to play!";
		throw "Unsupported. Use MediaPlayer instead.";
	}
}

class MediaPlayer extends Media {
	constructor(normalisation=true) {
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
		this.stopped = false;

		this.chunks = [];
		this.ffmpegChunks = [];
		this.readyPlayPacket = true;
		this.ffmpegFinished = false;
		this.playedOutSamples = 0;
		this.codecData = null;
		this.originStream = null;
		this.fProc = null;

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
		if (this.readyPlayPacket) this.playOutPacket();
		this.emit("unpause");
	}
	setVolume(v=1) {
		this.volCache = v;
		return this.volumeTransformer.setVolume(v);
	}

	#cleanUp() {
		this.originStream?.destroy();
		if (this.fProc) {
			try { this.fProc.kill(); } catch (_) {}
		}
		try { this.volumeTransformer.destroy(); } catch (_) {}
	}

	stop(init=true) {
		this.stopped = true;
		this.readyPlayPacket = false;
		this.#cleanUp();
		if (init) this.initValues();
		this.emit("finish");
	}
	destroy() {
		return this.stop(false);
	}

	get duration() { return this.codecData?.duration || 0; }
	get seconds() { return this.playedOutSamples / this.SAMPLE_RATE; }
	get localAudioTrack() { return this.track; }
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
				const samples = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2);
				const frame = new AudioFrame(
					samples, this.SAMPLE_RATE, this.CHANNELS,
					Math.trunc(samples.length / this.CHANNELS)
				);

				await this.source.captureFrame(frame);
				this.playedOutSamples += samples.length / this.CHANNELS;

				if (this.chunks.length > 0 && !this.paused) return res(this.playOutPacket());
				this.readyPlayPacket = true;
				if (this.chunks.length === 0 && this.ffmpegFinished) this.stop();
				return res();
			});
			this.volumeTransformer.write(c);
		});
	}

	async playStream(stream, options = {}) {
		this.emit("buffer");
		this.originStream = stream;
		this.started = false;
		this.stopped = false;
		this.ffmpegFinished = false;
		this.playedOutSamples = 0;

		// For rawPcm, NodeLink sends s16le 48kHz stereo PCM directly.
		// We pass it through ffmpeg with -f s16le input format (no re-encoding needed,
		// just use ffmpeg as a passthrough to get the same backpressure/timing as normal path).
		const inputOptions = options.rawPcm ? ['-f s16le', '-ar 48000', '-ac 2'] : [];

		let fProc = ffmpeg(stream)
			.noVideo()
			.setFfmpegPath(fPath);

		if (inputOptions.length > 0) {
			fProc = fProc.inputOptions(inputOptions);
		}

		fProc = fProc.outputOptions([
			`-f s16le`,
			`-ar ${this.SAMPLE_RATE}`,
			`-ac ${this.CHANNELS}`
		]);

		// Only apply loudnorm on non-rawPcm path (NodeLink PCM is already normalized)
		const useLoudnorm = options.rawPcm ? false :
			(options.loudnorm !== undefined ? options.loudnorm : this.loudnessNormalisation);
		if (useLoudnorm) {
			fProc = fProc.audioFilters("loudnorm");
		}

		fProc
			.on("start", (cli) => { console.log('Ffmpeg process started: ', cli); })
			.on("error", (err) => { this.ffmpegFinished = true; })
			.on("codecData", (d) => { this.codecData = d; })
			.on("end", () => { this.ffmpegFinished = true; });

		this.fProc = fProc;
		const out = fProc.pipe();
		out.on("data", (chunk) => {
			if (this.stopped) return;
			this.chunks.push(chunk);
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

module.exports = { MediaPlayer, Media }
