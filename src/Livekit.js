const { RoomEvent, Room, dispose, LocalAudioTrack, AudioSource, TrackPublishOptions, TrackSource, AudioFrame, Track } = require("@livekit/rtc-node");
const { EventEmitter } = require("events");
const { API } = require("revolt-api");
const { join } = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");

process.env.LIVEKIT_LOG_LEVEL = 'debug';

/**
 * Login information required, when you want to use a user account and not a bot. Please note that an account with MFA will not work.
 * @typedef {Object} Login
 * @property {String} email The email of the account.
 * @property {String} password The password of the account.
 */
/**
 * revolt-api configuration object. May be used for self-hosted revolt instances. @see {@link https://github.com/insertish/oapi#example} The last example for further information.
 * @typedef {Object} APIConfig
 * @property {String} baseURL The base url of the api of your revolt instance
 */
/**
 * @class
 * @classdesc The main class used to join channels and initiate voice connections
 * @augments EventEmitter
 */
class LRevoice extends EventEmitter {
  API_ENDPOINT = "";
  LIVEKIT_URL = "";

  client;
  api;
  connections;
  state;

  static State = {
    OFFLINE: "off", // not joined anywhere
    IDLE: "idle", // joined, but not playing
    BUFFERING: "buffer", // joined, buffering data
    PLAYING: "playing", // joined and playing
    PAUSED: "paused", // joined and paused
    JOINING: "joining", // join process active
    UNKNOWN: "unknown" // online but a Media instance is used to play audio
  }
  static Error = {
    ALREADY_CONNECTED: "acon", // joining failed because already connected to a voice channel in this server
    NOT_A_VC: "novc", // joining failed because the bot is already connected to the channel
    VC_ERROR: "vce", // there was an error fetching data about the voice channel
  }

  /**
   * @description Initiate a new Revoice instance
   *
   * @param  {(Login|string)} loginData The way to login. If you're using a bot use your token, otherwise specify an email and password.
   * @param {(APIConfig)} [apiConfig={}] A configuration object for revolt-api. @see {@link https://github.com/insertish/oapi#example} The last example for further information
   * @return {LRevoice}
   */
  constructor(loginData, apiConfig={}) {
    super();

    this.login(loginData, apiConfig);

    this.connections = new Map();

    this.state = LRevoice.State.OFFLINE;
  }

  async login(data, config) {
    if (!data.email) return this.api = new API({ ...config, authentication: { revolt: data } });
  
    this.api = new API();
    const d = await this.api.post("/auth/session/login", data);
    if (d.result != "Success") throw "MFA not implemented or login not successfull!";
    this.session = d;
    this.connect(config);
  }

	getVoiceConnection(channelId) {
		return this.connections.get(channelId);
	}

  connect(channelId) {
    console.log(channelId);
    return new Promise(async (res, rej) => {
      const { token, url } = await this.api.post("/channels/" + channelId + "/join_call", { "node": "worldwide" }, { headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux  x86_64; rv:138.0) Gecko/20100101 Firefox/138.0",
        "Accept": "/", "Accept-Language": "en-US,en;q=0.5",
        "Content-Type": "application/json", "Sec-GPC": "1",
        "Alt-Used": "stoat.chat", "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Priority": "u=0"
      }});

      if (!(token && url)) throw token + url + "error";

      const connection = new VoiceConnection(token, url, channelId);
			this.connections.set(channelId, connection);
      res(connection);
    });
  }
}

/**
 * @class
 * @classdesc Operates media sources and users in voice channels
 */
class VoiceConnection extends EventEmitter {
  room;
  url;
  token;

  constructor(token, url, channelId) {
    super();
    this.room = new Room();
		this.channelId = channelId;

    this.url = url;
    this.token = token;
    
		this.media = null;
    
    this.room
		.on(RoomEvent.TrackSubscribed, this.handleTrackSubscribed)
		.on(RoomEvent.Disconnected, this.handleDisconnected)
		.on(RoomEvent.ConnectionStateChanged, console.log)
		.on(RoomEvent.Reconnecting, console.log)
		
    this.connect();

    process.on("SIGINT", async () => {
      await this.room.disconnect();
      await dispose();
			process.exit();
    });
  }

  updateState(state) {
    this.state = state;
    this.emit("state", state);
  }

  get connected() {
    return (this.room) ? this.room.isConnected() : false;
  }

  async connect() {
		this.updateState(LRevoice.State.JOINING);
		await this.room.connect(this.url, this.token);
		this.updateState(LRevoice.State.IDLE);
		this.emit("join");
  }
	async disconnect() {
		if (this.media) {
			this.media.destroy();
		}
		await this.room.disconnect();
	}

  async play(media) {
    this.updateState(((!media.isMediaPlayer) ? LRevoice.State.UNKNOWN : LRevoice.State.BUFFERING));

		media.on("startplay", () => {
			this.updateState(LRevoice.State.PLAYING);
		});
		media.on("pause", () => {
			this.updateState(LRevoice.State.PAUSED);
		});
		media.on("unpause", () => {
			this.updateState(LRevoice.State.PLAYING);
		});
		media.on("finish", () => {
			this.updateState(LRevoice.State.IDLE);
		});
		media.on("buffer", () => {
			this.updateState(LRevoice.State.BUFFERING);
		});
		this.media = media;

		media.publishToRoom(this.room);
  }

  async connectTest() {
    console.log("connecting");

    await this.room.connect(this.url, this.token);

    const room = this.room;

    console.log("Connected");

    await (() => { return new Promise((res, rej) => setTimeout(res, 1500))})()

    const filePath = join(__dirname, `./test.mp3`);

    const SAMPLE_RATE = 48000;
    const CHANNELS = 2;

    const audioSource = new AudioSource(SAMPLE_RATE, CHANNELS);

    const audioTrack = LocalAudioTrack.createAudioTrack("audio", audioSource);

    try {
      const options = new TrackPublishOptions();
      options.source = TrackSource.SOURCE_MICROPHONE;
      await room.localParticipant.publishTrack(audioTrack, options);
      console.log('Audio track published');

      const ffmpegProcess = ffmpeg(filePath)
        .noVideo() // Ensure no video processing
        .setFfmpegPath(ffmpegStatic)
        .outputOptions([
          '-f s16le',             // Format: signed 16-bit little-endian PCM
          `-ar ${SAMPLE_RATE}`,   // Audio sample rate: 48000 Hz
          `-ac ${CHANNELS}`,      // Audio channels: 2
        ])
        .on('start', (commandLine) => {
          console.log('FFmpeg process started:', commandLine);
        })
        .on('error', (err, stdout, stderr) => {
          console.error('FFmpeg error:', err.message);
          console.error('FFmpeg stderr:', stderr);
          // Stop the track on error
          /*if (audioTrack) {
            audioTrack.stop();
            room.localParticipant.unpublishTrack(audioTrack.sid);
          }*/
        })
        .on('end', async () => {
          console.log('FFmpeg process finished.');
				})
				.on("codecData", (d) => {
					console.log("codec data: ", d, d.audio)
					codecData = d;
				})
				.on("progress", (d) => {
					console.log(d);
				});

      const pcmStream = ffmpegProcess.pipe();

      const chunks = [];
			var capturedSamples = 0;
			var codecData = {};
      var playing = false;
      pcmStream.on('data', async (chunk) => {
        chunks.push(chunk);
				if (!playing) return playOutChunk();
      });


      const playOutChunk = async () => {
        playing = true;
        const chunk = chunks.shift();

        const samples = new Int16Array(
          chunk.buffer,
          chunk.byteOffset,
          chunk.length / 2 // chunk.length is in bytes
        );

        const frame = new AudioFrame(
          samples,
          SAMPLE_RATE,
          CHANNELS,
          Math.trunc(samples.length / CHANNELS)
        )
				capturedSamples += samples.length / CHANNELS;
        await audioSource.captureFrame(frame);
        if (chunks.length > 0) return playOutChunk();
        playing = false;
      }

			setInterval(() => {
				console.log("curr seconds: ", capturedSamples / SAMPLE_RATE, " / ", codecData.duration);
			}, 1000);

    } catch (err) {
      console.error('Failed to publish track or start FFmpeg:', err);
    }
  }

  handleTrackSubscribed(track, trackPublication, participant) {

  }
  handleDisconnected() {
		this.updateState(LRevoice.State.OFFLINE)
    console.log("DIsconnected!");
  }
}

module.exports = LRevoice;