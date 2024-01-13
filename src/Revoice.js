const { API } = require("revolt-api");
const Signaling = require("./Signaling.js");
const EventEmitter = require("events");
const { Device, useSdesMid, RTCRtpCodecParameters } = require("msc-node");

/**
 * @class
 * @classdesc Operates media sources and users in voice channels
 */
class VoiceConnection extends EventEmitter {
  constructor(channelId, voice, opts) {
    super();
    this.voice = voice;
    this.channelId = channelId;

    this.users = [];

    this.device = opts.device;
    this.signaling = opts.signaling;
    this.setupSignaling();
    this.signaling.connect(channelId);

    this.leaveTimeout = opts.leaveOnEmpty;
    this.leaving; // the actual timeout cancellable

    this.initialConnect = true;

    this.media = null;
  }

  updateState(state) {
    this.state = state;
    this.emit("state", state);
  }

  /**
   * @description Get all the users associated with this voice connection
   *
   * @return {User[]} An array containing all the User objects
   */
  getUsers() {
    return this.signaling.users;
  }

  /**
   * @description Check if a user is connected to this voice channel
   *
   * @param  {string} userId The id of the user
   * @return {boolean}        Wether the user is in the voice channel
   */
  isConnected(userId) {
    return this.signaling.isConnected(userId);
  }

  setupSignaling() {
    const signaling = this.signaling;
    signaling.on("token", () => {});
    signaling.on("authenticate", (data) => {
      this.device.load({ routerRtpCapabilities: data.data.rtpCapabilities });
    });
    signaling.on("initTransports", (data) => {
      this.initTransports(data);
    });

    // user events
    signaling.on("roomfetched", () => {
      this.initLeave();
      signaling.users.forEach((user) => {
        this.voice.users.set(user.id, user);
        this.users.push(user);
      });
      this.emit("roomfetched");
    });
    signaling.on("userjoin", (user) => {
      this.voice.users.set(user.id, user);
      this.users.push(user);
      if (this.leaving) {
        clearTimeout(this.leaving);
        this.leaving = null;
      }
      this.emit("userjoin", user);
    });
    signaling.on("userleave", (user) => {
      this.resetUser(user);
      const idx = this.users.findIndex(u => u.id == user.id);
      if (idx !== -1) this.users.splice(idx, 1);
      this.initLeave();
      this.emit("userleave", user);
    });
  }
  initLeave() {
    const signaling = this.signaling;
    if (this.leaving) {
      clearTimeout(this.leaving);
      this.leaving = null;
    }
    if (!(signaling.roomEmpty && this.leaveTimeout)) return;
    this.leaving = setTimeout(() => {
      this.once("leave", () => {
        this.destroy();
        this.emit("autoleave");
      });
      this.leave();
    }, this.leaveTimeout * 1000);
  }
  initTransports(data) {
    this.sendTransport = this.device.createSendTransport({...data.data.sendTransport});
    this.sendTransport.on("connect", ({ dtlsParameters }, callback) => {
      this.signaling.connectTransport(this.sendTransport.id, dtlsParameters).then(callback);
    });
    this.sendTransport.on("produce", (parameters, callback) => {
      this.signaling.startProduce("audio", parameters.rtpParameters).then((cid) => {
        callback({ cid });
      });
    });

    if (!this.initialConnect && this.media) {
      this.media.transport = this.sendTransport;
    }

    this.initialConnect = false;

    this.updateState(Revoice.State.IDLE);
    this.emit("join");
  }
  resetUser(user) {
    this.emit("userLeave", user);
  }

  /**
   * @description Attach a Media object to this connection
   *
   * @example
   * const connection = voice.getVoiceConnection("someChannelId");
   * const player = new MediaPlayer();
   * connection.play(player);
   *
   * player.playFile("./audio.mp3");
   *
   * @param  {(Media|MediaPlayer)} media The media object that should be attached
   * @return {void}
   */
  async play(media) {
    this.updateState(((!media.isMediaPlayer) ? Revoice.State.UNKNOWN : Revoice.State.BUFFERING));

    media.on("finish", () => {
      this.signaling.stopProduce();
      this.producer.close();
      this.updateState(Revoice.State.IDLE);
    });
    media.on("buffer", (producer) => {
      this.producer = producer;
      this.updateState(Revoice.State.BUFFERING);
    });
    media.on("start", () => {
      this.updateState(Revoice.State.PLAYING);
    });
    media.on("pause", () => {
      this.updateState(Revoice.State.PAUSED);
    });
    this.media = media;
    this.media.transport = this.sendTransport;
    return this.producer;
  }
  closeTransport() {
    return new Promise((res) => {
      this.sendTransport.once("close", () => {
        this.sendTransport = undefined;
        res();
      });
      this.sendTransport.close();
    });
  }
  disconnect() {
    return new Promise((res) => {
      this.signaling.disconnect();
      this.closeTransport().then(() => {
        // just a temporary fix till vortex rewrite
      });
      this.device = Revoice.createDevice();
      res();
    });
  }
  destroy() {
    return new Promise(async (res) => {
      this.disconnect();
      if (this.media) await this.media.destroy();
      res();
    });
  }

  /**
   * @description Leave the voice channel
   * @async
   * @return {void}
   */
  async leave() {
    this.users.forEach(u => this.resetUser(u))
    this.updateState(Revoice.State.OFFLINE);
    await this.disconnect();
    if (this.media) this.media.disconnect();
    this.emit("leave");
  }
}


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
class Revoice extends EventEmitter {
  static createDevice() {
    return new Device({
      headerExtensions: {
        audio: [
          useSdesMid(),
        ]
      },
      codecs: {
        audio: [
          new RTCRtpCodecParameters({
            mimeType: "audio/opus",
            clockRate: 48000,
            payloadType: 100,
            channels: 2
          })
        ]
      }
    });
  }
  static State =  {
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
   * @return {Revoice}
   */
  constructor(loginData, apiConfig={}) {
    super();
    this.session = null;
    this.login(loginData, apiConfig);

    this.signals = new Map();
    this.signaling = new Signaling(this.api);

    this.transports = new Map();
    this.devices = new Map(); // list of devices by server id
    this.connected = []; // list of channels the bot is connected to
    this.connections = new Map();

    this.users = new Map();

    this.state = Revoice.State.OFFLINE;

    return this;
  }
  async login(data, config) {
    if (!data.email) return this.api = new API({ ...config, authentication: { revolt: data } });

    this.api = new API();
    const d = await this.api.post("/auth/session/login", data);
    if (d.result != "Success") throw "MFA not implemented or login not successfull!";
    this.session = d;
    this.connect(config);
  }
  async connect(config) {
    this.api = new API({
      ...config,
      authentication: {
        revolt: this.session
      }
    });
  }
  updateState(state) {
    this.state = state;
    this.emit("state", state);
  }
  static uid() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }


  /**
   * @typedef UserData
   * @property {User} user The Revoice user object associated with the user
   * @property {VoiceConnection} connection The voice connection that is connected to the user
   */
  /**
   * @description Retrieve the user object
   *
   * @param  {string} id The id of the user
   * @return {UserData} An object containing the Revoice user object and the voice connection, the user is in.
   */
  getUser(id) {
    if (!this.users.has(id)) return false; // no data about the user in cache
    const user = this.users.get(id);
    if (!user) return false;
    if (!user.connected) return { user };
    const connection = this.connections.get(user.connectedTo);
    return { user, connection };
  }
  knowsUser(id) { // might not be up-to-date because of leaving
    return this.users.has(id);
  }

  /**
   * @description Join a specified channel
   * @example
   * voice.join("channel", 60).then(connection => { // leave after 60 seconds of inactivity
   *   const player = new MediaPlayer();
   *   connection.play(player);
   *   player.playFile("audio.mp3");
   * });
   *
   * @param  {string} channelId        The id of the voice channel you want the bot to join
   * @param  {(false|number)} leaveIfEmpty=false Specifies the amount of time in sconds, after which the bot leaves an empty voice channel. If this is set to `false`, the bot will stay unless told to leave
   * @return {Promise<VoiceConnection>} A promise containing the resulting VoiceConnection for this channel.
   */
  join(channelId, leaveIfEmpty=false) { // leaveIfEmpty == amount of seconds the bot will wait before leaving if the room is empty
    return new Promise((res, rej) => {
      this.api.get("/channels/" + channelId).then(data => {
        if (data.channel_type != "VoiceChannel" && data.channel_type != "Group") return rej(Revoice.Error.NOT_A_VC);
        if (this.devices.has(channelId)) {
          return rej(Revoice.Error.ALREADY_CONNECTED);
        }

        const signaling = new Signaling(this.api);
        const device = Revoice.createDevice();

        const connection = new VoiceConnection(channelId, this, {
          signaling: signaling,
          device: device,
          leaveOnEmpty: leaveIfEmpty
        });
        connection.on("autoleave", () => {
          this.connections.delete(channelId);
        });
        connection.on("userLeave", (u) => {
          if (!this.users.has(u.id)) return; // is leaving anyway
          const user = this.users.get(u.id);
          user.connected = false;
          user.connectedTo = null;
          this.users.set(u.id, user);
        });
        connection.updateState(Revoice.State.JOINING);
        this.connections.set(channelId, connection);
        res(connection);
      }).catch((e) => {
        console.log(e);
        rej(Revoice.Error.VC_ERROR);
      });
    });
  }

  /**
   * @description Retrieve the VoiceConnection object for a specified voice channel
   *
   * @param  {string} channelId The id of the voice channel
   * @return {VoiceConnection}           The voice connection object
   */
  getVoiceConnection(channelId) {
    return this.connections.get(channelId);
  }
}

module.exports = Revoice;
