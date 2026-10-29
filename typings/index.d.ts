declare const _exports: {
    Revoice: typeof Revoice;
    VoiceConnection: any;
    Signaling: typeof Signaling;
    User: typeof User;
    Adapters: {
        BaseTransportAdapter: typeof BaseTransportAdapter;
        LiveKitAdapter: typeof LiveKitAdapter;
    };
    Engine: {
        RingBuffer: typeof RingBuffer;
        Pacer: typeof Pacer;
        AudioPipeline: typeof AudioPipeline;
        WorkerPoolManager: typeof WorkerPoolManager;
    };
    DSP: {
        DSPChain: typeof DSPChain;
        VolumeNode: typeof VolumeNode;
        LoudnormNode: typeof LoudnormNode;
        BiquadFilterNode: typeof BiquadFilterNode;
        MixerNode: typeof MixerNode;
    };
    MediaPlayer: typeof Media.MediaPlayer;
    Media: typeof Media.Media;
    readonly Legacy: any;
    readonly legacy: any;
};
export = _exports;
export const Legacy: any;
export const legacy: any;
import Revoice = require("./src/Revoice.js");
import Signaling = require("./src/Signaling.js");
import User = require("./src/User.js");
import BaseTransportAdapter = require("./src/adapters/BaseTransportAdapter.js");
import LiveKitAdapter = require("./src/adapters/LiveKitAdapter.js");
import RingBuffer = require("./src/engine/RingBuffer.js");
import Pacer = require("./src/engine/Pacer.js");
import AudioPipeline = require("./src/engine/AudioPipeline.js");
import WorkerPoolManager = require("./src/engine/WorkerPoolManager.js");
import DSPChain = require("./src/dsp/DSPChain.js");
import VolumeNode = require("./src/dsp/VolumeNode.js");
import LoudnormNode = require("./src/dsp/LoudnormNode.js");
import BiquadFilterNode = require("./src/dsp/BiquadFilterNode.js");
import MixerNode = require("./src/dsp/MixerNode.js");
import Media = require("./src/Media.js");
//# sourceMappingURL=index.d.ts.map