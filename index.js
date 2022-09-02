const User = require("./User.js");
const Media = require("./Media.js");
const Revoice = require("./Revoice.js");
const Signaling = require("./Signaling.js");

module.exports = {
  ...Media, Revoice, Signaling, User
}
