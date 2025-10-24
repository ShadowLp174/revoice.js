const { RemoteParticipant, setLogLevel, RoomEvent, Room, dispose, LocalAudioTrack, AudioSource, TrackPublishOptions, TrackSource, AudioFrame } = require("@livekit/rtc-node");
const { EventEmitter } = require("events");
const { readFileSync } = require("fs");
const { API } = require("revolt-api");
const { parseFile } = require("music-metadata");
const { join } = require("path");
const WaveFile = require('wavefile').WaveFile;

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

      const connection = new VoiceConnection(token, url);
      res(connection);
    });
  }
}

class VoiceConnection {
  room;
  url;
  token;

  constructor(token, url) {
    this.room = new Room({});
    this.url = url;
    this.token = token;
    
    this.connect();
    
    /*this.room
      .on(RoomEvent.TrackSubscribed, this.handleTrackSubscribed)
      .on(RoomEvent.Disconnected, this.handleDisconnected)
      .on(RoomEvent.ConnectionStateChanged, console.log)
      .on(RoomEvent.Reconnecting, console.log)*/

    /*process.on("SIGINT", async () => {
      await this.room.disconnect();
      await dispose();
    });*/
  }

  async connect() {
    const rtcConfig = {
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302'] },
      ]
    };

    console.log("connecting");

    await this.room.connect(this.url, this.token);

    console.log("Connected");

    const test = readFileSync(join(__dirname, `./test.wav`));
    const meta = await parseFile(join(__dirname, `./test.wav`));

		const wav = new WaveFile(test);

		console.log(meta);

		const channels = meta.format.numberOfChannels || 2;
		const sampleRate = meta.format.sampleRate || 48000;
		const sampleNum = meta.format.numberOfSamples;

    const source = new AudioSource(sampleRate, channels);
    const track = LocalAudioTrack.createAudioTrack("audio", source);

    const options = new TrackPublishOptions();
    options.source = TrackSource.SOURCE_MICROPHONE

    var buffer = test.buffer;
    await this.room.localParticipant.publishTrack(track, options);

		let pos = 0;
		const FRAME_DURATION = 1;
		const numSamples = sampleRate * FRAME_DURATION;
		const samples = wav.getSamples(true);
		while (pos < samples.length) {
			const end = Math.min(pos + samples.length, pos + numSamples);
			const frame = new AudioFrame(
				samples.slice(0, end),
				sampleRate,
				channels,
				samples.length / 0
			)
			await source.captureFrame(frame);
			pos += numSamples;
		}
		await source.waitForPlayout();
		await track.close();

		await this.room.disconnect();
		console.log("finished");
    //await source.captureFrame(new AudioFrame(buffer, meta.format.sampleRate, meta.format.numberOfChannels, meta.format.numberOfSamples))
  }

  handleTrackSubscribed(track, trackPublication, participant) {

  }
  handleDisconnected() {
    console.log("DIsconnected!");
  }
}

module.exports = LRevoice;