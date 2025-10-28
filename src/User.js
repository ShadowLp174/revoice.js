const EventEmitter = require("events");

/**
 * @class
 * @classdesc A user object storing data about a user associated with revoice
 */
class User extends EventEmitter {
  constructor(participant) {
    super();
    this.id = participant.identity;
    this.connected = true; // gets changed from outside
    this.connectedTo = null; // same as connected

    const meta = JSON.parse(participant.metadata);
    this.participant = participant;
    this.metadata = meta;
    this.username = meta.username;
    this.discriminator = meta.discriminator;
    this.badges = meta.badges,
    this.relationship = meta.relationship;
    this.online = meta.online;
    this.rawData = meta;    

    return this;
  }
}

module.exports = User;
