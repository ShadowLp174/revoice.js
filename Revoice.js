const { API } = require("revolt-api");
const Signaling = require("./Signaling.js");
const EventEmitter = require("events");
const { Device, useSdesMid, RTCRtpCodecParameters } = require("msc-node");

class Revoice {
  constructor(token, deaf=false) {
    this.api = new API({ authentication: { revolt: token }});
    this.signaling = new Signaling(this.api);
    this.setupSignaling();

    this.eventemitter = new EventEmitter();
    this.deaf = deaf;

    this.device = new Device({
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

    return this;
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
    this.sendTransport.disconnect();
    this.sendTransport = undefined;
  }
  join(channelId) {
    this.signaling.connect(channelId);
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
    /*const recvTransport = this.device.createRecvTransport({...data.data.recvTransport});
    this.recvTransport = recvTransport;
    recvTransport.on("connect", ({ dtlsParameters }, callback) => {
      this.signaling.connectTransport(recvTransport.id, dtlsParameters).then(callback);
    });*/

    this.emit("join");
  }
  async play(media) {
    const track = (media.track) ? media.track : media.media.track; // second case for audioplayer
    return await this.sendTransport.produce({ track: track, appData: { type: "audio" } }); // rtpProducer
  }
}

module.exports = Revoice;
