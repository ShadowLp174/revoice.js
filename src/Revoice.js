const { API } = require("revolt-api");
const Signaling = require("./Signaling.js");
const EventEmitter = require("events");
const { Device, useSdesMid, RTCRtpCodecParameters } = require("msc-node");

class VoiceConnection extends EventEmitter {
  constructor(channelId, voice, opts) {
    super();
    this.voice = voice;
    this.channelId = channelId;

    this.device = opts.device;
    this.signaling = opts.signaling;
    this.setupSignaling();
    this.signaling.connect(channelId);

    this.leaveTimeout = opts.leaveOnEmpty;
    this.leaving; // the actual timeout cancellable

    this.media = null;
  }

  updateState(state) {
    this.state = state;
    this.emit("state", state);
  }

  getUsers() {
    return this.signaling.users;
  }
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
      });
    });
    signaling.on("userjoin", (user) => {
      this.voice.users.set(user.id, user);
      if (this.leaving) {
        clearTimeout(this.leaving);
        this.leaving = null;
      }
      this.emit("userjoin", user);
    });
    signaling.on("userleave", (user) => {
      const old = this.voice.users.get(user.id);
      old.connected = false;
      old.connectedTo = null;
      this.voice.users.set(user.id, old);
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

    this.updateState(Revoice.State.IDLE);
    this.emit("join");
  }
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
  async leave() {
    this.updateState(Revoice.State.OFFLINE);
    await this.disconnect();
    if (this.media) this.media.disconnect();
    this.emit("leave");
  }
}

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
            preferredPayloadType: 100,
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
  constructor(token) {
    super();
    this.api = new API({ authentication: { revolt: token }});
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
  updateState(state) {
    this.state = state;
    this.emit("state", state);
  }
  static uid() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

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

  join(channelId, leaveIfEmpty=false) { // leaveIfEmpty == amount of seconds the bot will wait before leaving if the room is empty
    return new Promise((res, rej) => {
      this.api.get("/channels/" + channelId).then(data => {
        if (data.channel_type != "VoiceChannel") return rej(Revoice.Error.NOT_A_VC);
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
        connection.updateState(Revoice.State.JOINING);
        this.connections.set(channelId, connection);
        res(connection);
      }).catch((e) => {
        console.log(e);
        rej(Revoice.Error.VC_ERROR);
      });
    });
  }
  getVoiceConnection(channelId) {
    return this.connections.get(channelId);
  }
}

module.exports = Revoice;
