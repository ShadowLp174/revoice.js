const { EventEmitter } = require("events");
const { API } = require("revolt-api");
const User = require("./User");
const LiveKitAdapter = require("./adapters/LiveKitAdapter.js");
const BaseTransportAdapter = require("./adapters/BaseTransportAdapter.js");
const { Media } = require("./Media");

if (!process.env.LIVEKIT_LOG_LEVEL) {
  process.env.LIVEKIT_LOG_LEVEL = "warn";
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
 * @property {String} [baseURL] The base url of the api of your revolt instance
 * @property {String} [logLevel="warn"] LiveKit log level ("debug", "info", "warn", "error")
 * @property {typeof BaseTransportAdapter} [adapterClass] Optional custom voice transport adapter class
 * @property {Object} [adapterOptions] Optional options passed to the transport adapter
 */
/**
 * @class
 * @classdesc The main class used to join channels and initiate voice connections
 * @augments EventEmitter
 */
class Revoice extends EventEmitter {
  client;
  api;
  /** @type {Map<string, VoiceConnection>} */
  connections;
  state;

  static State = {
    OFFLINE: "off", // not joined anywhere
    IDLE: "idle", // joined, but not playing
    BUFFERING: "buffer", // joined, buffering data
    PLAYING: "playing", // joined and playing
    PAUSED: "paused", // joined and paused
    JOINING: "joining", // join process active
    UNKNOWN: "unknown", // online but a Media instance is used to play audio
  };

  static Error = {
    ALREADY_CONNECTED: "acon", // joining failed because already connected to a voice channel in this server
    NOT_A_VC: "novc", // joining failed because the bot is already connected to the channel
    VC_ERROR: "vce", // there was an error fetching data about the voice channel
  };

  static VoiceConnection = null; // Assigned below
  static BaseTransportAdapter = BaseTransportAdapter;
  static LiveKitAdapter = LiveKitAdapter;

  /**
   * @description Initiate a new Revoice instance
   *
   * @param {(Login|string)} loginData The way to login. If you're using a bot use your token, otherwise specify an email and password.
   * @param {(APIConfig)} [apiConfig={}] A configuration object for revolt-api and Revoice options.
   * @return {Revoice}
   */
  constructor(loginData, apiConfig = {}) {
    super();

    this.adapterClass = apiConfig?.adapterClass || LiveKitAdapter;
    this.adapterOptions = {
      logLevel: apiConfig?.logLevel || process.env.LIVEKIT_LOG_LEVEL || "warn",
      ...(apiConfig?.adapterOptions || {}),
    };

    if (loginData) {
      this.login(loginData, apiConfig);
    }

    this.connections = new Map();
    /** @type {Map<string, User>} */
    this.users = new Map();

    this.state = Revoice.State.OFFLINE;

    this._sigintHandler = async () => {
      try {
        const promises = [];
        for (const [, v] of this.connections) {
          promises.push(v.onSIGINT());
        }
        await Promise.allSettled(promises);
        const adapter = this.adapterClass || LiveKitAdapter;
        if (typeof adapter?.disposeRuntime === "function") {
          await adapter.disposeRuntime();
        } else if (typeof LiveKitAdapter.disposeRuntime === "function") {
          await LiveKitAdapter.disposeRuntime();
        }
      } catch (err) {
        console.error("Error during Revoice SIGINT shutdown:", err);
      } finally {
        process.exit();
      }
    };
    process.once("SIGINT", this._sigintHandler);
  }

  static uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  async login(data, config = {}) {
    const cleanConfig = { ...config };
    delete cleanConfig.adapterClass;
    delete cleanConfig.adapterOptions;
    delete cleanConfig.logLevel;

    if (!data?.email) {
      this.api = new API({
        baseURL: "https://stoat.chat/api",
        ...cleanConfig,
        authentication: { revolt: data },
      });
      return this.api;
    }

    this.api = new API();
    const d = await this.api.post("/auth/session/login", data);
    if (d.result != "Success") throw new Error("MFA not implemented or login not successful!");
    this.session = d;
    await this.connect(cleanConfig);
  }

  async connect(config) {
    this.api = new API({
      ...config,
      authentication: {
        revolt: this.session,
      },
    });
  }

  /**
   * Join a Stoat voice channel.
   * @param {string} channelId
   * @param {boolean|number} [leaveIfEmpty=false]
   * @param {Object} [joinOptions={}]
   * @param {string} [joinOptions.node="worldwide"]
   * @param {string} [joinOptions.token] Pre-fetched call token (optional)
   * @param {string} [joinOptions.url] Pre-fetched call WebSocket URL (optional)
   * @returns {Promise<VoiceConnection>}
   */
  join(channelId, leaveIfEmpty = false, joinOptions = {}) {
    return new Promise(async (res, rej) => {
      try {
        let token = joinOptions.token;
        let url = joinOptions.url;

        if (!token || !url) {
          const callData = await this.api.post("/channels/" + channelId + "/join_call", {
            node: joinOptions.node || "worldwide",
          });
          token = callData?.token;
          url = callData?.url;
        }

        if (!(token && url)) {
          throw new Error(`Invalid join_call response for channel ${channelId}`);
        }

        const connection = new VoiceConnection(channelId, this, {
          token,
          url,
          leaveOnEmpty: leaveIfEmpty,
          adapterClass: joinOptions.adapterClass || this.adapterClass,
          adapterOptions: {
            ...this.adapterOptions,
            ...(joinOptions.adapterOptions || {}),
          },
        });

        connection.on("autoleave", () => {
          this.connections.delete(channelId);
        });
        connection.on("userLeave", (u) => {
          if (!u || !this.users.has(u.id)) return;
          const user = this.users.get(u.id);
          user.connected = false;
          user.connectedTo = null;
          this.users.set(u.id, user);
        });
        connection.on("userJoin", (u) => {
          if (!u) return;
          u.connected = true;
          u.connectedTo = connection.channelId;
          this.users.set(u.id, u);
        });

        this.connections.set(channelId, connection);
        res(connection);
      } catch (err) {
        rej(err);
      }
    });
  }

  /**
   * @param {string} channelId
   */
  getVoiceConnection(channelId) {
    return this.connections.get(channelId);
  }

  updateState(state) {
    this.state = state;
    this.emit("state", state);
  }

  /**
   * @param {string} id
   */
  getUser(id) {
    if (!this.users.has(id)) return false;
    const user = this.users.get(id);
    if (!user) return false;
    if (!user.connected) return { user };
    const connection = this.connections.get(user.connectedTo);
    return { user, connection };
  }

  /**
   * @param {string} id
   */
  knowsUser(id) {
    return this.users.has(id);
  }
}

/**
 * @class VoiceConnection
 * @classdesc Operates media sources and users in voice channels using a pluggable transport adapter
 * @augments EventEmitter
 */
class VoiceConnection extends EventEmitter {
  adapter;
  url;
  token;
  voice;
  channelId;

  /**
   *
   * @param {string} channelId
   * @param {Revoice} voice
   * @param {Object} opts
   * @param {string} opts.url
   * @param {string} opts.token
   * @param {boolean|number} opts.leaveOnEmpty
   * @param {typeof BaseTransportAdapter} opts.adapterClass The class, not the instance
   */
  constructor(channelId, voice, opts = {}) {
    super();
    this.channelId = channelId;
    this.voice = voice;

    this.url = opts.url;
    this.token = opts.token;

    this.media = null;
    /** @type {User[]} */
    this.users = [];
    this.preferredVolume = 1;

    this.leaving = null;
    this.leaveTimeout = opts.leaveOnEmpty;
    this.state = Revoice.State.OFFLINE;

    const AdapterClass = opts.adapterClass || LiveKitAdapter;
    this.adapter = new AdapterClass(opts.adapterOptions || {});

    // Expose underlying LiveKit room if using LiveKitAdapter for backwards compatibility
    this.adapter
      .on("disconnected", this.handleDisconnected.bind(this))
      .on("participantJoined", this.handleJoin.bind(this))
      .on("participantLeft", this.handleLeave.bind(this))
      .on("audioFrameReceived", (participantId, frame) => {
        this.emit("audioFrameReceived", participantId, frame);
      })
      .on("error", (err) => {
        if (this.listenerCount("connectionError") > 0) {
          this.emit("connectionError", err);
        }
      });

    this.connect();
  }

  get room() {
    return this.adapter?.room || null;
  }

  async onSIGINT() {
    await this.adapter.disconnect();
  }

  updateState(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit("state", state);
  }

  getUsers() {
    return this.users;
  }

  resetUser(user) {
    if (!user) return;
    this.emit("userLeave", user);
    this.emit("userleave", user);
  }

  handleJoin(participant) {
    const u = new User(participant);
    u.connectedTo = this.channelId;
    const existingIdx = this.users.findIndex((existing) => existing.id === u.id);
    if (existingIdx !== -1) {
      this.users[existingIdx] = u;
    } else {
      this.users.push(u);
    }
    this.initLeave();
    this.emit("userJoin", u);
    this.emit("userjoin", u);
  }

  handleLeave(participant) {
    const participantId = participant.identity || participant.name || participant.id;
    const idx = this.users.findIndex((u) => u.id == participantId);
    const user = idx !== -1 ? this.users.splice(idx, 1)[0] : new User(participant);
    this.initLeave();
    this.emit("userLeave", user);
    this.emit("userleave", user);
  }

  initLeave() {
    if (this.leaving) {
      clearTimeout(this.leaving);
      this.leaving = null;
    }
    const remoteCount = this.adapter.getRemoteParticipants().length;
    if (!(remoteCount === 0 && this.leaveTimeout)) return;

    this.leaving = setTimeout(() => {
      this.once("leave", () => {
        this.destroy();
        this.emit("autoleave");
      });
      this.leave();
    }, this.leaveTimeout * 1000);
  }

  isConnected() {
    return this.connected;
  }

  get connected() {
    return this.adapter ? this.adapter.connected : false;
  }

  async connect() {
    try {
      this.updateState(Revoice.State.JOINING);
      await this.adapter.connect({
        url: this.url,
        token: this.token,
        channelId: this.channelId,
        autoSubscribe: false,
      });
      this.emit("join");
      this.updateState(Revoice.State.IDLE);

      const participants = this.adapter.getRemoteParticipants();
      const users = [];
      for (const p of participants) {
        const u = new User(p);
        u.connectedTo = this.channelId;
        users.push(u);
        if (this.voice?.users) {
          this.voice.users.set(u.id, u);
        }
      }
      this.users = users;
      this.initLeave();
      this.emit("roomfetched");
    } catch (err) {
      this.updateState(Revoice.State.OFFLINE);
      this.emit("connectionError", err);
    }
  }

  async disconnect() {
    if (this.leaving) {
      clearTimeout(this.leaving);
      this.leaving = null;
    }
    if (this.media) {
      this.media.destroy();
      this.media = null;
    }
    await this.adapter.disconnect();
  }

  async leave() {
    const currentUsers = this.users.splice(0, this.users.length);
    currentUsers.forEach((u) => this.resetUser(u));
    if (this.state !== Revoice.State.OFFLINE) {
      this.updateState(Revoice.State.OFFLINE);
    }
    await this.disconnect();
    this.emit("leave");
  }

  async destroy() {
    return await this.leave();
  }

  /**
   * @param {Media} media
   */
  async play(media) {
    this.updateState(!media.isMediaPlayer ? Revoice.State.UNKNOWN : Revoice.State.BUFFERING);

    media.on("startplay", () => {
      this.updateState(Revoice.State.PLAYING);
    });
    media.on("pause", () => {
      this.updateState(Revoice.State.PAUSED);
    });
    media.on("unpause", () => {
      this.updateState(Revoice.State.PLAYING);
    });
    media.on("finish", () => {
      if (this.state === Revoice.State.OFFLINE) return;
      this.updateState(Revoice.State.IDLE);
    });
    media.on("buffer", () => {
      this.updateState(Revoice.State.BUFFERING);
    });
    this.media = media;

    await media.publishToRoom(this.adapter);
  }

  handleDisconnected() {
    if (this.state !== Revoice.State.OFFLINE) {
      this.updateState(Revoice.State.OFFLINE);
    }
  }
}

Revoice.VoiceConnection = VoiceConnection;

module.exports = Revoice;
