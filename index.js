const Signaling = require("./src/Signaling.js");
const User = require("./src/User.js");
const Revoice = require("./src/Revoice.js");
const Media = require("./src/Media.js");

const BaseTransportAdapter = require("./src/adapters/BaseTransportAdapter.js");
const LiveKitAdapter = require("./src/adapters/LiveKitAdapter.js");

const RingBuffer = require("./src/engine/RingBuffer.js");
const Pacer = require("./src/engine/Pacer.js");
const AudioPipeline = require("./src/engine/AudioPipeline.js");
const WorkerPoolManager = require("./src/engine/WorkerPoolManager.js");

const DSPChain = require("./src/dsp/DSPChain.js");
const VolumeNode = require("./src/dsp/VolumeNode.js");
const LoudnormNode = require("./src/dsp/LoudnormNode.js");
const BiquadFilterNode = require("./src/dsp/BiquadFilterNode.js");
const MixerNode = require("./src/dsp/MixerNode.js");

let LegacyGetterCache = null;
function getLegacy() {
  if (!LegacyGetterCache) {
    const MediaV1 = require("./src/MediaV1.js");
    const RevoiceV1 = require("./src/RevoiceV1.js");
    const UserV1 = require("./src/UserV1.js");
    LegacyGetterCache = {
      ...MediaV1,
      Revoice: RevoiceV1,
      User: UserV1,
    };
  }
  return LegacyGetterCache;
}

module.exports = {
  ...Media,
  Revoice,
  VoiceConnection: Revoice.VoiceConnection,
  Signaling,
  User,
  Adapters: {
    BaseTransportAdapter,
    LiveKitAdapter,
  },
  Engine: {
    RingBuffer,
    Pacer,
    AudioPipeline,
    WorkerPoolManager,
  },
  DSP: {
    DSPChain,
    VolumeNode,
    LoudnormNode,
    BiquadFilterNode,
    MixerNode,
  },
};

Object.defineProperty(module.exports, "Legacy", {
  enumerable: true,
  get: getLegacy,
});

Object.defineProperty(module.exports, "legacy", {
  enumerable: false,
  get: getLegacy,
});
