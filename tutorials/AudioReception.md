# Basic Audio Reception "Docs"

### Quickstart Example:

```JavaScript
const { Revoice } = require("revoice.js");
const fs = require("fs");

async function main() {
  // 1. initialize Revoice with receiveAudio enabled
  // (You can set it globally in adapterOptions, or per-channel in joinOptions)
  const revoice = new Revoice("the-token-of-your-bot", {
    adapterOptions: {
      receiveAudio: true, // Subscribes to incoming audio streams from participants
    },
  });

  // 2. Join the voice channel
  const connection = await revoice.join("the-voice-channel-id");

  // Optional: Track write streams per participant to record separate audio tracks
  const userRecordings = new Map();

  // 3. Listen for incoming audio frames
  connection.on("audioFrameReceived", (participantId, frame) => {
    // Frame structure:
    // - frame.data: Int16Array (raw PCM 16-bit samples)
    // - frame.sampleRate: 48000
    // - frame.channels: 2
    // - frame.samplesPerChannel: 960 (20ms frame)

    // Convert Int16Array samples to a Node.js Buffer
    const pcmBuffer = Buffer.from(
      frame.data.buffer,
      frame.data.byteOffset,
      frame.data.byteLength
    );

    // Write PCM data to a per-user file (s16le, 48000Hz, stereo)
    if (!userRecordings.has(participantId)) {
      const stream = fs.createWriteStream(`./recording-${participantId}.pcm`);
      userRecordings.set(participantId, stream);
      console.log(`Started recording participant: ${participantId}`);
    }
    userRecordings.get(participantId).write(pcmBuffer);
  });

  // 4. Clean up streams when a participant leaves or disconnects
  connection.on("userLeave", (user) => {
    if (userRecordings.has(user.id)) {
      userRecordings.get(user.id).end();
      userRecordings.delete(user.id);
      console.log(`Closed recording for: ${user.id}`);
    }
  });

  connection.on("leave", () => {
    for (const stream of userRecordings.values()) {
      stream.end();
    }
    userRecordings.clear();
  });
}

main().catch(console.error);
```

## Per-Channel Activation

You might to have voice reception turned off most of the time, so this can be enabled/disabled on a per-channel basis:
```JavaScript
const connection = await revoice.join("channel-id", false, {
  adapterOptions: {
    receiveAudio: true,
  },
});
```

## Active Speaker Detection / Voice Activity

There are no internal events or detection algorithms implemented *yet*, but they are planned for the future.
In the meantime, you can implement these yourself.

For speaker detection, calculate the root mean square power of the frame data:
```JavaScript
connection.on("audioFrameReceived", (participantId, frame) => {
  const samples = frame.data; // Int16Array
  let sumSquares = 0;

  for (let i = 0; i < samples.length; i++) {
    const normalized = samples[i] / 32768; // Normalise to [-1.0, 1.0]
    sumSquares += normalized * normalized;
  }

  const rms = Math.sqrt(sumSquares / samples.length);
  const db = 20 * Math.log10(rms || 1e-8);

  // Consider speaking if above -40 dB
  if (db > -40) {
    console.log(`User ${participantId} is speaking (Level: ${db.toFixed(1)} dB)`);
  }
});

```

> [!TIP]
> The recorded .pcm files contain raw 16-bit little-endian PCM data (s16le, 48000 Hz, stereo).
> If you need them in a more portable or compact format you can convert them to MP3 or WAV using FFmpeg:
> ```sh
> ffmpeg -f s16le -ar 48000 -ac 2 -i recording-USER_ID.pcm output.wav`
> ```

> [!NOTE]
> Stoat does not support the full quality supported by Revoice at the moment.
> As the time of writing Stoat does not even support stereo audio, but that is most likely subject to change in the very near future.
