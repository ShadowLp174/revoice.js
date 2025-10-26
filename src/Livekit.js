const { RoomEvent, Room, dispose } = require("@livekit/rtc-node");
const { EventEmitter } = require("events");
const { API } = require("revolt-api");
const User = require("./User");

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
class Revoice extends EventEmitter {
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
  constructor(loginData, client, apiConfig={}) {
    super();

    this.login(loginData, apiConfig);
		this.client = client;

    this.connections = new Map();
		this.users = new Map();

    this.state = LRevoice.State.OFFLINE;
  }
	
	static uid() {
		return Date.now().toString(36) + Math.random().toString(36).substr(2);
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

  join(channelId, leaveIfEmpty=false) {
    console.log(channelId);
    return new Promise(async (res, rej) => {
      const { token, url } = await this.api.post("/channels/" + channelId + "/join_call", { "node": "worldwide" });

      if (!(token && url)) throw token + url + "error";

			const connection = new VoiceConnection(channelId, this, {
				token,
				url,
				leaveOnEmpty: leaveIfEmpty
			});
			
			connection.on("autoleave", () => {
				this.connections.delete(channelId);
			});
			connection.on("userLeave", () => {
				if (!this.users.has(u.id)) return;
				const user = this.users.get(u.id);
				user.connected = false;
				user.connectedTo = null;
				this.users.set(u.id, user);
			})

			this.connections.set(channelId, connection);
      res(connection);
    });
  }
	getVoiceConnection(channelId) {
		return this.connections.get(channelId);
	}

	updateState(state) {
		this.state = state;
		this.emit("state", state);
	}

	getUser(id) {
		if (!this.users.has(id)) return false;
		const user = this.users.get(id);
		if (!user) return false;
		if (!user.connected) return { user };
		const connection = this.connections.get(user.connectedTo);
		return { user: user, connection };
	}
	knowsUser(id) {
		return this.users.has(id);
	}

	// TODO: user management
}

/**
 * @class
 * @classdesc Operates media sources and users in voice channels
 */
class VoiceConnection extends EventEmitter {
  room;
  url;
  token;
	voice;
	channelId;

	constructor(channelId, voice, opts) {
    super();
    this.room = new Room();
		this.channelId = channelId;
		this.voice = voice;

    this.url = opts.url;
    this.token = opts.token;
    
		this.media = null;
		this.users = [];

		this.leaving = null;
		this.leaveTimeout = opts.leaveOnEmpty;
    
    this.room
			.on(RoomEvent.Disconnected, this.handleDisconnected)
			.on(RoomEvent.ConnectionStateChanged, console.log)
			.on(RoomEvent.Reconnecting, console.log)
			.on(RoomEvent.ParticipantConnected, this.handleJoin)
			.on(RoomEvent.ParticipantDisconnected, this.handleLeave)
		
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

	getUsers() {
		return this.users;
	}
	resetUser(user) {
		this.emit("userLeave", user);
	}

	handleJoin(participant) {
		const u = new User(participant.name, this.voice.api);
		u.connectedTo = this.channelId;
		this.users.push(u);
		this.emit("userJoin");
	}
	handleLeave(participant) {
		this.resetUser(participant);
		const idx = this.users.findIndex(u => u.id == user.id);
		if (idx !== -1) this.users.splice(idx, 1);
		this.initLeave();
		this.emit("userleave", user);
	}

	initLeave() {
		if (this.leaving) {
			clearTimeout(this.leaving);
			this.leaving = null;
		}
		if (!(this.room.remoteParticipants.size === 0 && this.leaveTimeout)) return;

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
    return (this.room) ? this.room.isConnected() : false;
  }

  async connect() {
		this.updateState(LRevoice.State.JOINING);
		await this.room.connect(this.url, this.token, { autoSubscribe: false });
		this.emit("join");
		this.updateState(LRevoice.State.IDLE);
		const participants = this.room.remoteParticipants;
		const users = [];
		for (const [k, _v] of participants) {
			const u = new User(k, this.voice.api);
			u.connectedTo = this.channelId;
			users.push(u);
			this.voice.users.set(u.id, u);
		}
		this.emit("roomfetched");
  }
	async disconnect() {
		if (this.media) {
			this.media.destroy();
		}
		await this.room.disconnect();
	}
	async leave() {
		this.users.forEach(u => this.resetUser(u));
		this.updateState(LRevoice.State.OFFLINE);
		await this.disconnect();
		this.emit("leave");
	}
	async destroy() {
		return await this.leave();
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

  handleDisconnected() {
		this.updateState(LRevoice.State.OFFLINE)
    console.log("DIsconnected!");
  }
}

module.exports = Revoice;