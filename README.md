# Revoice.js - A Voice Module for Revolt

This package is still in developement and lacks many features.

You still are able to play sound to a voice channel. Other features like channel info will follow.

**TODO**:

- [ ] Play/Pause for the media class (help apreciated ;)) [ Kinda implemented already ]
- [ ] Non-voice events like UserJoined and roominfo
- [ ] Audio reception

*Disclamer: I might have forgotten some things on the list and thus it might be extended. Fell free to open issues to suggest new features :)*

## Installation

This package uses ffmpeg as base so you'll have to install it properly [from the official site](https://ffmpeg.org/).  
After that, just execute `npm install revoice.js` to install the package, have fun! :)

## Usage

TLDR; You initiate a client, you join a voice channel and then you play media.

Media has to be created using the Media class. You can stream both node streams and media files to revolt.

Example:

```JavaScript
const { Revoice, Media } = require("revoice.js");

const revoice = new Revoice("the-token-of-your-bot");
revoice.join("the-voice-channel-id");
revoice.on("join", () => {
  const media = new MediaPlayer();
  media.playFile("./assets/some-nice-song.mp3");
  // or something like the following:
  media.playStream(fs.createReadStream("./assets/some-nice-song.mp3"));
  revoice.play(media); // playing audio does only work after the the bot joined the voice channel

  // ... pause it
  media.pause();

  // ... resume it later
  media.resume();
});
```

## API

### Revoice Client

#### Properties/Methods:

- **`on(event, callback)`**: Equally to EventEmitter.on, currently supported events: `join`
- **`once(event, callback)`**: Equally to EventEmitter.once, refer to `on()`
- **`disconnect()`**: Disconnect from the current voice channel
- **`join(channelId)`**: Connect to a voice channel; `channelId` typeof `Number`
- **`play(media)`**: Stream a [Media](#Media) object to the current voice channel

### Media

#### Constructor:

**`new Media(logs?), port?)`**:

- Creates a new Revoice-compatible media object
- Parameters:
  - **`logs`**: typeof `Boolean`; Wether or not output ffmpeg logs in the console; Optional, default: `false`
  - **`port`**: typeof `int`; The port ffmpeg should send the rtp data to; Optional, defaults to `5030`

#### Properties/Methods:

- **`getMediaTrack()`**: Get the MediaStreamTrack used for WebRTC transports
- **`playFile(path)`**: Play the file from the given filePath; Param typeof `String`
- **`playStream(stream)`**: Play a ReadableStream; Param typeof `Readable`

#### Signaling

WIP
