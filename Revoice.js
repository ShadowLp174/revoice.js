const { API } = require("revolt-api");
const Signaling = require("./Signaling.js");
const EventEmitter = require("events");
const { Device, useSdesMid, RTCRtpCodecParameters } = require("msc-node");

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
  constructor(token) {
    this.api = new API({ authentication: { revolt: token }});
    this.signaling = new Signaling(this.api);
    this.setupSignaling();

    this.eventemitter = new EventEmitter();

    this.device = Revoice.createDevice();
    this.media = null;

    this.state = Revoice.State.OFFLINE;

    return this;
  }
  updateState(state) {
    this.state = state;
    this.emit("state", state);
  }
  setupSignaling() {
    const signaling = this.signaling
    signaling.on("token", console.log);
    signaling.on("authenticate", (data) => {
      this.device.load({ routerRtpCapabilities: data.data.rtpCapabilities });
    });
    signaling.on("initTransports", (data) => {
      this.initTransports(data);
    });
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

  disconnect() {
    this.signaling.disconnect();
    this.sendTransport.close();
    this.sendTransport = undefined;
    this.device = Revoice.createDevice();
  }
  join(channelId) {
    this.updateState(Revoice.State.JOINING);
    this.signaling.connect(channelId);
  }
  leave() {
    this.disconnect();
    if (this.media) this.media.disconnect();
    this.emit("leave");
  }
  async initTransports(data) {
    const sendTransport = this.device.createSendTransport({...data.data.sendTransport});
    this.sendTransport = sendTransport;
    sendTransport.on("connect", ({ dtlsParameters }, callback) => {
      this.signaling.connectTransport(sendTransport.id, dtlsParameters).then(callback);
    });
    sendTransport.on("produce", (parameters, callback) => {
      this.signaling.startProduce("audio", parameters.rtpParameters).then((id) => {
        callback({ id });
      });
    });

    this.updateState(Revoice.State.IDLE);
    this.emit("join");
  }
  async play(media) {
    this.updateState(((!media.isMediaPlayer) ? Revoice.State.UNKNOWN : Revoice.State.BUFFERING));
    this.media = media;
    this.media.on("finish", () => {
      this.updateState(Revoice.State.IDLE);
    });
    this.media.on("buffer", () => {
      this.updateState(Revoice.State.BUFFERING);
    });
    this.media.on("start", () => {
      this.updateState(Revoice.State.PLAYING);
    });
    this.media.on("pause", () => {
      this.updateState(Revoice.State.PAUSED);
    });
    const track = media.track;
    return await this.sendTransport.produce({ track: track, appData: { type: "audio" } }); // rtpProducer
  }
}

module.exports = Revoice;
