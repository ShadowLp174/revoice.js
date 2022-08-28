const { API } = require("revolt-api");
const Signaling = require("./Signaling.js");
const EventEmitter = require("events");
const { Device, useSdesMid, RTCRtpCodecParameters } = require("msc-node");

class VoiceConnection {
  constructor(channelId, voice, opts) {
    this.voice = voice;
    this.channelId = channelId;

    this.device = opts.device;
    this.signaling = opts.signaling;
    this.setupSignaling();
    this.signaling.connect(channelId);

    this.media = null;

    this.eventemitter = new EventEmitter();
  }
  on(event, cb) {
    return this.eventemitter.on(event, cb);
  }
  once(event, cb) {
    return this.eventemitter.once(event, cb);
  }
  emit(event, data) {
    return this.eventemitter.emit(event, data);
  }

  updateState(state) {
    this.state = state;
    this.emit("state", state);
  }

  setupSignaling() {
    const signaling = this.signaling;
    signaling.on("token", console.log);
    signaling.on("authenticate", (data) => {
      this.device.load({ routerRtpCapabilities: data.data.rtpCapabilities });
    });
    signaling.on("initTransports", (data) => {
      this.initTransports(data);
    });
  }
  initTransports(data) {
    const sendTransport = this.device.createSendTransport({...data.data.sendTransport});
    this.sendTransport = sendTransport;
    sendTransport.on("connect", ({ dtlsParameters }, callback) => {
      this.signaling.connectTransport(sendTransport.id, dtlsParameters).then(callback);
    });
    sendTransport.on("produce", (parameters, callback) => {
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
      this.updateState(Revoice.State.IDLE);
    });
    media.on("buffer", () => {
      this.updateState(Revoice.State.BUFFERING);
    });
    media.on("start", () => {
      this.updateState(Revoice.State.PLAYING);
    });
    media.on("pause", () => {
      this.updateState(Revoice.State.PAUSED);
    });
    this.media = media;
    const track = media.track;
    return await this.sendTransport.produce({ track: track, appData: { type: "audio" } }); // rtpProducer
  }
  disconnect() {
    this.signaling.disconnect();
    this.sendTransport.close();
    this.sendTransport = undefined;
    this.device = Revoice.createDevice();
  }
  destroy() {
    return new Promise(async (res) => {
      this.disconnect();
      if (this.media) await this.media.destroy();
      res();
    })
  }
  leave() {
    this.disconnect();
    if (this.media) this.media.disconnect();
    this.emit("leave");
  }
}

class Revoice {
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
    this.api = new API({ authentication: { revolt: token }});
    this.signals = new Map();
    this.signaling = new Signaling(this.api);

    this.eventemitter = new EventEmitter();

    this.transports = new Map();
    this.devices = new Map(); // list of devices by server id
    this.connected = []; // list of channels the bot is connected to
    this.connections = new Map();

    this.state = Revoice.State.OFFLINE;

    return this;
  }
  updateState(state) {
    this.state = state;
    this.emit("state", state);
  }
  on(event, cb) {
    return this.eventemitter.on(event, cb);
  }
  once(event, cb) {
    return this.eventemitter.once(event, cb);
  }
  emit(event, data) {
    return this.eventemitter.emit(event, data);
  }

  join(channelId) {
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
          device: device
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
