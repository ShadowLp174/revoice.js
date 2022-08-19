# Revoice.js - A Voice Module for Revolt

This package is still in developement and lacks many features.

You still are able to play sound to a voice channel. Other features like channel info will follow.

**TODO**:

- [ ] Play/Pause for the media class (help apreciated ;)) [ Kinda implemented already ]
- [ ] Non-voice events like UserJoined and roominfo
- [ ] Audio reception
- [ ] Error Handling; Right now, you have to take care of things like stopping the music if you start to play another song while one is playing

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

- **`on(event, callback)`**: Equally to EventEmitter.on, for supported events refer to: [The Events section](#Events)
- **`once(event, callback)`**: Equally to EventEmitter.once, refer to `on()`
- **`disconnect()`**: Disconnect from the current voice channel
- **`join(channelId)`**: Connect to a voice channel; `channelId` typeof `Number`
- **`play(media)`**: Stream a [MediaPlayer](#MediaPlayer)(Or Media) object to the current voice channel

#### Events:

- **state**:
  - Data: `typeof Revoice.State`;
  - This event gets fired whenever the current state changes. The possible states are:
    - **State.OFFLINE**: The bot hasn't joined any channel yet
    - **State.IDLE**: The bot is in a voice channel but isn't doesn't play anything
    - **State.JOINING**: The bot is currently in the join process
    - **State.PLAYING**: The bot is in a voice channel and transmitting sound
    - **State.UNKNOWN**: The bot is in a voice channel and _might_ be playing something. This occurs when you choose to use the Media class as the Media class just contains some base functionality
- **join**:
  - Data: _empty_
  - This events get fired after the bot has successfully established a connection with the voice channel
- **leave**
  - Data: _empty_
  - This event gets fired after the bot has left a voice channel

### MediaPlayer

#### Constructor:

**`new MediaPlayer(logs?), port?)`**:

- Creates a new Revoice-compatible media object with basic sound controls like play/pause
- Parameters:
  - **`logs`**: typeof `Boolean`; Wether or not output ffmpeg logs in the console; Optional, default: `false`
  - **`port`**: typeof `int`; The port ffmpeg should send the rtp data to; Optional, defaults to `5030`

#### Properties/Methods:

- **`getMediaTrack()`**: Get the MediaStreamTrack used for WebRTC transports
- **`playFile(path)`**: Play the file from the given filePath; Param typeof `String`
- **`playStream(stream)`**: Play a ReadableStream; Param typeof `Readable`
- **`pause()`**: Pause the current playback if playing
- **`resume()`**: Unpause the current playback if paused (This function is developement but working)
- **`stop()`**: Completely stop the current playback; This can be used to stop a song to play another
- **`on(event, callback)`**: Equally to EventEmitter.on, for supported events refer to: [The Events section](#Events)
- **`once(event, callback)`**: Equally to EventEmitter.once, refer to `on()`

#### Events:

- **start**:
  - Data: _empty_
  - This event gets fired when the MusicPlayer starts to process music. This includes buffering and playing
- **finish**:
  - Data: _empty_
  - This event gets fired when a music stream finishes to stream. This feature is under developement but working

### Media

_**This class should only be used if you want to implement your own MediaPlayer class.**_

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
