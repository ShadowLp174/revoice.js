const EventEmitter = require("events");
const { WebSocket } = require("ws");

class Signaling {
  constructor(apiClient, channelId) {
    this.client = apiClient;
    this.channelId = channelId;

    this.eventemitter = new EventEmitter();
    this.currId = -1;

    return this;
  }
  emit(event, cb) {
    return this.eventemitter.emit(event, cb);
  }
  on(event, cb) {
    return this.eventemitter.on(event,  cb);
  }
  once(event, cb) {
    return this.eventemitter.once(event,  cb);
  }

  authenticate() { // start the authentication and join flow
    this.client.post("/channels/" + this.channelId + "/join_call").then(data => {
      this.emit("token", data);
      this.initWebSocket(data);
    });
  }
  connect(channel) {
    if (this.ws) this.disconnect();
    this.channelId = channel;
    this.authenticate();
  }
  disconnect() {
    this.ws.close(1000);
    this.currId = -1;
  }

  initWebSocket(data) {
    this.ws = new WebSocket("wss://vortex.revolt.chat"); // might need to whitelist this in your antivirus
    this.ws.on("open", () => {
      // Send Authentication when the socket is ready
      const msg = JSON.stringify({ id: ++this.currId, type: "Authenticate", data: {
        token: data.token,
        roomId: this.channelId
      }});
      this.ws.send(msg);
    });
    this.ws.on("close", (e) => {
      if (e !== 1000) console.log("WebSocket Closed: ", e);
    });
    this.ws.on("error", (e) => {
      console.log("Signaling error: ", e);
    });
    this.ws.on("message", (msg) => {
      const data = JSON.parse(Buffer.from(msg).toString()); // convert the received buffer to an object
      this.processWS(data);
    });
  }
  processWS(data) { // data == parsed websocket message
    switch(data.type) {
      case "InitializeTransports":
        this.eventemitter.emit("initTransports", data);
      break;
      case "Authenticate":
        // continue in signaling process
        this.eventemitter.emit("authenticate", data);
        const request = {
          id: ++this.currId,
          type: "InitializeTransports",
          data: {
            mode: "SplitWebRTC",
            rtpCapabilities:  data.data.rtpCapabilities
          }
        };
        this.ws.send(JSON.stringify(request));
      break;
      case "ConnectTransport":
        this.eventemitter.emit("ConnectTransport", data);
      break;
      case "StartProduce":
        this.eventemitter.emit("StartProduce", data);
      break;
      case "StopProduce":
        this.eventemitter.emit("StopProduce", data);
      break;
      default:
        // events like startProduce or UserJoined; will be implemented later
        this.eventemitter.emit("data", data);
        console.log("(yet) Unimplemented case: ", data);
      break;
    }
  }
  connectTransport(id, params) {
    return new Promise((res, rej) => {
      const request = {
        id: ++this.currId,
        type: "ConnectTransport",
        data: {
          id: id,
          dtlsParameters: params
        }
      };
      this.ws.send(JSON.stringify(request));
      this.on("ConnectTransport", (data) => {
        if (data.id !== request.id) return;
        res(data.data);
      })
    });
  }
  startProduce(type, params) {
    return new Promise((res, rej) => {
      const request = {
        id: ++this.currId,
        type: "StartProduce",
        data: {
          type: type,
          rtpParameters: params
        }
      };
      this.ws.send(JSON.stringify(request));
      this.on("StartProduce", (data) => {
        if (data.id !== request.id) return;
        res(data.data.producerId);
      })
    });
  }
  stopProduce(type="audio") {
    return new Promise((res) => {
      const request = {
        id: ++this.currId,
        type: "StopProduce",
        data: {
          type: type
        }
      };
      this.ws.send(JSON.stringify(request));
      this.on("StopProduce", (data) => {
        if (data.id !== request.id) return;
        res();
      })
    });
  }
}

module.exports = Signaling;
