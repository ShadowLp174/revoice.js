const { AudioSource, LocalAudioTrack, TrackPublishOptions, TrackSource, AudioFrame } = require("@livekit/rtc-node");
const ffmpeg = require("fluent-ffmpeg");
const fPath = require("ffmpeg-static");
const { EventEmitter } = require("events");
const prism = require("prism-media");

function isIgnorableCaptureError(err) {
  const msg = err?.message ?? String(err ?? "");
  return msg.includes("InvalidState") || msg.includes("failed to capture frame") || msg.includes("capture frame");
}

/**
 * @class
 * @classdesc Basic class to process audio streams. As of 5a2fd7bcde9819c927157a965cfafdb8661f3e4e this doesn't have any functionality anymore and acts more like an interface.
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
 * @description An advanced version of the Media class. It also includes media controls like pausing and volume adjustment.
 *
 * @property {number} seconds - The amount of seconds passed during playback.
 * @property {string} currTimestamp - The current timestamp in ffmpeg format `hh:mm:ss`.
 */
class MediaPlayer extends Media {
	/**
	 * @description Initiates the MediaPlayer instance.
	 * @param {boolean} normalisation=true Wether to pass the `loudnorm` flag to FFmpeg.
	 *
	 * @return {MediaPlayer}            The new instance.
	 */
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

		this.chunks = [];
		this.ffmpegChunks = [];
		this.readyPlayPacket = true;
		this.ffmpegFinished = false;
		this.playedOutSamples = 0;
		this.codecData = null;

		this.originStream = null;
		this.fProc = null;
		this.ffmpegOutput = null;
		this.stopped = false;

		this.volumeTransformer = new prism.VolumeTransformer({ type: "s16le", volume: 1 });
		this.volumeTransformer.once("data", () => {
			this.playing = true;
			this.emit("startplay");
		})
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
    return this.volumeTransformer.setVolume(v);
  }

	#cleanUp() {
		this.stopped = true;
		this.readyPlayPacket = false;
		this.originStream?.destroy();
		this.ffmpegOutput?.destroy?.();
		if (this.fProc && !this.ffmpegFinished) this.fProc.kill();
		this.volumeTransformer.destroy();
	}

	stop(init=true) {
		if (this.stopped) return;
		this.readyPlayPacket = false; // prevent new packets from being played out

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
		const sec_num = this.seconds();
		var hours = Math.floor(sec_num / 3600);
		var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
		var seconds = sec_num - (hours * 3600) - (minutes * 60);

		if (hours < 10) { hours = "0" + hours; }
		if (minutes < 10) { minutes = "0" + minutes; }
		if (seconds < 10) { seconds = "0" + seconds; }
		return hours + ':' + minutes + ':' + seconds;
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
			if (this.stopped) return res();
			if (this.chunks.length === 0) return res(this.readyPlayPacket = true);
			this.readyPlayPacket = false;

			const c = this.chunks.shift();

			this.volumeTransformer.once("data", async (chunk) => {
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
				)

				try {
					await this.source.captureFrame(frame);
				} catch (err) {
					if (this.stopped || isIgnorableCaptureError(err)) return res();
					this.emit("error", err);
					return res();
				}
				this.playedOutSamples += samples.length / this.CHANNELS;

				if (this.chunks.length > 0 && !this.paused) return res(this.playOutPacket());
				this.readyPlayPacket = true;
				if (this.chunks.length === 0 && this.ffmpegFinished) this.stop();
				return res();
			});
			this.volumeTransformer.write(c);
		});
  }

  async playStream(stream) {
		this.emit("buffer");
		this.originStream = stream;
    this.started = false;
		this.stopped = false;

    this.ffmpegFinished = false;
		this.playedOutSamples = 0;
    let fProc = ffmpeg(stream)
      .noVideo()
      .setFfmpegPath(fPath)
      //.native() // TODO: check if necessary
      .outputOptions([
        `-f s16le`,
        `-ar ${this.SAMPLE_RATE}`,
        `-ac ${this.CHANNELS}`
      ])
      .on("start", (cli) => {
        console.log('Ffmpeg process started: ', cli)
      })
      .on("error", (err, stdout, stderr) => {
				this.ffmpegFinished = true;
        this.emit("error", err);
      })
			.on("codecData", (d) => {
				this.codecData = d;
			})
      .on("end", () => {
        this.ffmpegFinished = true;
				console.log("ffmpeg finished");
      });
		if (this.loudnessNormalisation) {
			fProc = fProc.audioFilters("loudnorm");
		}
		this.fProc = fProc;
    const out = fProc.pipe();
		this.ffmpegOutput = out;
    out.on("data", (chunk) => {
			if (this.stopped) return;
      this.chunks.push(chunk)
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
