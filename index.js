const MediaV1 = require("./src/MediaV1.js");
const RevoiceV1 = require("./src/RevoiceV1.js");
const Signaling = require("./src/Signaling.js");

const User = require("./src/User.js");

const Revoice = require("./src/Livekit.js")
const Media = require("./src/Media.js")

module.exports = {
  ...Media, Revoice, Signaling, User, Legacy: [
		...MediaV1,
		RevoiceV1
	]
}
