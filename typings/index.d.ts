declare const _exports: {
    Revoice: typeof Revoice;
    VoiceConnection: typeof Revoice.VoiceConnection;
    Signaling: typeof Signaling;
    User: typeof User;
    Media: typeof Media.Media;
    MediaPlayer: typeof Media.MediaPlayer;
    Adapters: {
        BaseTransportAdapter: any;
        LiveKitAdapter: any;
    };
    Engine: {
        RingBuffer: any;
        Pacer: any;
        AudioPipeline: any;
        WorkerPoolManager: any;
    };
    DSP: {
        DSPChain: any;
        VolumeNode: any;
        LoudnormNode: any;
        BiquadFilterNode: any;
        MixerNode: any;
    };
    Legacy: any;
};
export = _exports;
import Revoice = require("./src/Revoice.js");
import Signaling = require("./src/Signaling.js");
import User = require("./src/User.js");
import Media = require("./src/Media.js");
