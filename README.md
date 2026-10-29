# Revoice.js - A Voice Module for Stoat (Revolt)

A Node.js package allowing bots (or selfbots) to connect to voice channels on the Discord-alternative Stoat, formerly Revolt.

#### Features:

- Custom audio pipeline
  - If raw 48khz 2-channel PCM audio is piped in, Processing is done entirely in JS, eliminating performance-overhead through FFmpeg (like in previous versions)
  - Multi-threaded for improved performance (using worker threads)
  - Implemented pipeline steps:
    1. MixerNode: joins additional audio streams (overlays) into the primary stream of the pipeline
    2. Filter/EQNode
    3. LoudnormNode: Automatic gain control, RMS loudnorm normalising and a soft-knee peak limiter
    4. Custom Node Entry point: Custom audio processing nodes can be inserted here. Node == Function modifying a given Float32 buffer frame
    5. VolumeNode
- Pausing/Resuming Playback
- User Events (joining/leaving)
- Audio Reception (rudimentary, native QoL features such as speaker detection are not implemented *yet*)
  - For usage examples see [tutorials/AudioReception.md](./tutorials/AudioReception.md)

This package is still in development. If you need a certain feature currently not implemented, please open an issue and let me know about it. I will see what I can do :)

## Livekit Update

Stoat, formerly Revolt, has updated to a new voice system called Livekit. Revoice.js has been updated to support this and is a lot more stable now.  
The rewrite was made with backwards-compatibility in mind so any programs using Revoice written before the switch should still work after updating to the newest Revoice version. However, minor issues may arise (such as `media.playbackPaused` being phased out in favour of `media.paused`).
To connect to Stoat instances still using Vortex, the old `Revoice` and `MediaPlayer` are still accessible by importing them through `require("revoice.js").legacy`.

> [!NOTE]
> Stoat does not support the full audio quality used by Revoice at the moment.
> As the time of writing Stoat does not even support stereo audio, but that is most likely subject to change in the very near future.

## Installation

Just execute `npm install revoice.js` to install the package, have fun! :)

## Usage

TL;DR: You initiate a client, you join a voice channel and then you play media.

Please note that unlike on Discord bots, Stoat bots are able to join multiple voice channels at once. Thus a single bot is able to be in every voice channel it has access to. I have no idea about the limitations.

Media has to be created using the MediaPlayer class. You can stream both node streams and media files to revolt.

Example:

If you want to see a working music bot using revoice, check out [Remix](https://github.com/remix-bot/revolt)!

```javascript
const { Revoice, MediaPlayer } = require("revoice.js");
const fs = require("fs");

async function main() {
  const revoice = new Revoice("the-token-of-your-bot");
  
  // join the voice channel
  const connection = await revoice.join("the-voice-channel-id");

  // initialize MediaPlayer with v2 options (Worker thread offloading and Loudnorm enabled)
  const media = new MediaPlayer({
    normalisation: true,
    useWorker: true,
    volume: 1.0,
  });

  connection.on("join", async () => {
    // 1. Attach and publish the media player to the voice connection
    await connection.play(media);

    // 2. Play a file or stream
    await media.playFile("./assets/some-nice-song.mp3");
    // Alternatively for streams:
    // await media.playStream(fs.createReadStream("./assets/some-nice-song.mp3"));

    // Optional v2 features:
    // media.setFilter("bassboost"); // EQ preset
    // media.setVolume(0.8);          // Volume adjustment
    // media.playOverlay("./assets/effect.mp3", { volume: 0.5, duckPrimary: true }); // Overlay audio
  });
}

main().catch(console.error);
```

**TODO**:

- [X] Play/Pause for the media class
- [X] Non-voice events like UserJoined and roominfo
- [X] Audio Level Normalisation
- [X] Audio Reception 
- [ ] Advanced audio reception features

*Disclamer: I might have forgotten some things on the list and thus it might be extended. Feel free to open issues to suggest new features :)*

# Connect to self-hosted instances

You can pass the configuration data for revolt-api and thus connect it to a self-hosted instance.
For the data you can pass, see [oapi](https://github.com/insertish/oapi#example)

## Documentation

For the documentation, please have a look at the pages deployment: https://shadowlp174.github.io/revoice.js/docs
