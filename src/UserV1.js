const EventEmitter = require("events");

/**
 * @class
 * @classdesc A user object storing data about a user associated with revoice
 */
class User extends EventEmitter {
  constructor(id, api) {
    super();
    this.id = id;
    this.api = api;
    this.connected = true; // gets changed from outside
    this.connectedTo = null; // same as connected

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
}

module.exports = User;
