const EventEmitter = require("events");
const { WebSocket } = require("ws");
const User = require("./User.js");

class Signaling {
  constructor(apiClient, channelId) {
    this.client = apiClient;
    this.channelId = channelId;

    this.eventemitter = new EventEmitter();
    this.currId = -1;

    this.users = [];
    this.roomEmpty = null;

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
        this.fetchRoomInfo().then(() => {
          this.roomEmpty = (this.users.length == 1);
          this.emit("roomfetched");
        });
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
      case "UserJoined":
        const user = new User(data.data.id, this.client);
        user.connected = true;
        user.connectedTo = this.channelId;
        user.once("ready", () => {
          this.addUser(user);
          this.emit("userjoin", user);
        });
      break;
      case "RoomInfo":
        this.emit("roominfo", data);
      break;
      case "UserLeft":
        const id = data.data.id;
        const removed = this.removeUser(id);
        this.roomEmpty = (this.users.length == 1);
        this.emit("userleave", removed);
      default:
        // events like startProduce or UserJoined; will be implemented later
        this.eventemitter.emit("data", data);
        // console.log("(yet) Unimplemented case: ", data);
      break;
    }
  }
  addUser(user) {
    if (!user) throw "User cannot be null! [Signaling.addUser(user)]";
    this.users.push(user);
  }
  removeUser(id) {
    const idx = this.users.findIndex(el => el.id == id);
    if (idx == -1) return;
    const removed = this.users[idx];
    this.users.splice(idx, 1);
    return removed;
  }
  isConnected(userId) { // check wether a user is in the voice channel
    const idx = this.users.findIndex(el => el.id == userId);
    if (idx == -1) return false;
    return true;
  }
  fetchRoomInfo() {
    return new Promise((res) => {
      const request = {
        id: ++this.currId,
        type: "RoomInfo"
      }
      this.ws.send(JSON.stringify(request));
      this.on("roominfo", (data) => {
        const users = data.data.users;
        if ((Object.keys(users).length - 1) == 0) return res();
        let promises = [];
        for (let userId in users) {
          let user = new User(userId, this.client);
          user.connected = true;
          user.connectedTo = this.channelId;
          promises.push(this.eventToPromise(user, "ready"));
          user.muted = 1 - users[userId].audio;
          this.addUser(user);
        }
        Promise.all(promises).then(res);
      });
    });
  }
  eventToPromise(emitter, event) {
    return new Promise(res => {
      emitter.once(event, (data) => {
        res(data);
      });
    });
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
