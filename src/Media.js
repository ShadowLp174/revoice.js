/**
 * @class
 * @classdesc Basic class to process audio streams
 */

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
}

class MediaPlayer extends Media {
  constructor() {
    super();

		this.isMediaPlayer = true;

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

		this.volumeTransformer = new prism.VolumeTransformer({ type: "s16le", volume: 1 });
		this.volumeTransformer.on("data", (chunk) => {
			this.chunks.push(chunk)
			if (this.readyPlayPacket && !this.paused) return this.playOutPacket();
		});
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
		this.originStream?.destroy();
		if (this.ffmpegFinished) this.fProc.kill(); // "SIGSTOP" to suspend
		this.volumeTransformer.destroy();
	}

	stop(init=true) {
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
    if (this.chunks.length === 0) return this.readyPlayPacket = true;
    this.readyPlayPacket = false;

    const chunk = this.chunks.shift();

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

    await this.source.captureFrame(frame);
		this.playedOutSamples += samples.length / this.CHANNELS;

    if (this.chunks.length > 0 && !this.paused) return this.playOutPacket();
    this.readyPlayPacket = true;
    if (this.chunks.length === 0 && this.ffmpegFinished) this.stop();
  }
	async processFfmpeg() {

	}

  async playStream(stream) {
		this.emit("buffer");
		this.originStream = stream;
    this.started = false;

    this.ffmpegFinished = false;
		this.playedOutSamples = 0;
    const fProc = ffmpeg(stream)
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
        // TODO: error handling
      })
			.on("codecData", (d) => {
				this.codecData = d;
			})
      .on("end", () => {
        this.ffmpegFinished = true;
				console.log("ffmpeg finished");
      });
    
    fProc.pipe(this.volumeTransformer);
		this.fProc = fProc;
  }
}

module.exports = { LMediaPlayer, Media }