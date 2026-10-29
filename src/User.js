const EventEmitter = require("events");

/**
 * @class
 * @classdesc A user object storing data about a user associated with revoice
 */
class User extends EventEmitter {
  constructor(participant = {}) {
    super();
    this.id = participant.identity || participant.id || participant.name || "unknown";
    this.connected = true; // gets changed from outside
    this.connectedTo = null; // same as connected

    let meta = {};
    if (typeof participant.metadata === "string" && participant.metadata.trim().length > 0) {
      try {
        meta = JSON.parse(participant.metadata);
      } catch (_) {
        meta = {};
      }
    } else if (participant.metadata && typeof participant.metadata === "object") {
      meta = participant.metadata;
    }

    this.participant = participant;
    this.metadata = meta;
    this.username = meta.username || participant.name || this.id;
    this.discriminator = meta.discriminator || "0000";
    this.badges = meta.badges || 0;
    this.relationship = meta.relationship || null;
    this.online = meta.online ?? true;
    this.rawData = meta;

    return this;
  }
}

module.exports = User;
