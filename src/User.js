const EventEmitter = require("events");

class User {
  constructor(id, api) {
    this.id = id;
    this.api = api;
    this.connected = true; // gets changed from outside
    this.connectedTo = null; // same as connected

    this.emitter = new EventEmitter();

    this.api.get("/users/" + id).then(res => {
      this.username = res.username;
      this.badges = res.badges;
      this.relationship = res.relationship;
      this.online = res.online;
      this.rawData = res;

      this.emit("ready");
    });

    return this;
  }
  on(event, cb) {
    return this.emitter.on(event, cb);
  }
  once(event, cb) {
    return this.emitter.once(event, cb);
  }
  emit(event, data) {
    return this.emitter.emit(event, data);
  }


}

module.exports = User;
