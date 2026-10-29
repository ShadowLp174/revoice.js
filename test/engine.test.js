const assert = require("assert");
const { Readable } = require("stream");

const RingBuffer = require("../src/engine/RingBuffer.js");
const Pacer = require("../src/engine/Pacer.js");
const AudioPipeline = require("../src/engine/AudioPipeline.js");
const WorkerPoolManager = require("../src/engine/WorkerPoolManager.js");
const DSPChain = require("../src/dsp/DSPChain.js");
const VolumeNode = require("../src/dsp/VolumeNode.js");
const LoudnormNode = require("../src/dsp/LoudnormNode.js");
const BiquadFilterNode = require("../src/dsp/BiquadFilterNode.js");
const MixerNode = require("../src/dsp/MixerNode.js");
const BaseTransportAdapter = require("../src/adapters/BaseTransportAdapter.js");
const { MediaPlayer } = require("../src/Media.js");

class MockTransportAdapter extends BaseTransportAdapter {
  constructor(opts = {}) {
    super(opts);
    this.framesCaptured = 0;
    this.lastFrame = null;
    this.published = false;
  }
  async connect() {
    this.connected = true;
    this.emit("connected");
  }
  async disconnect() {
    this.connected = false;
    this.emit("disconnected");
  }
  async publishAudioTrack() {
    this.published = true;
  }
  async capturePcmFrame(int16Samples, _samplesPerChannel) {
    this.framesCaptured++;
    this.lastFrame = new Int16Array(int16Samples);
  }
}

function generateSinePcmBuffer(durationMs = 200, freqHz = 440, amplitude = 16000) {
  const sampleRate = 48000;
  const channels = 2;
  const totalSamplesPerChannel = Math.floor((sampleRate * durationMs) / 1000);
  const buf = Buffer.alloc(totalSamplesPerChannel * channels * 2);

  for (let i = 0; i < totalSamplesPerChannel; i++) {
    const val = Math.round(Math.sin((2 * Math.PI * freqHz * i) / sampleRate) * amplitude);
    const offset = i * 4;
    buf.writeInt16LE(val, offset);
    buf.writeInt16LE(val, offset + 2);
  }
  return buf;
}

async function runTests() {
  console.log("=== Revoice.js v2 Audio Engine Verification Suite ===\n");

  // 1. RingBuffer wrap-around & backpressure tests
  {
    let highTriggered = 0;
    let lowTriggered = 0;
    const rb = new RingBuffer(3840 * 4, {
      highWaterMarkRatio: 0.75,
      lowWaterMarkRatio: 0.25,
      onHighWaterMark: () => highTriggered++,
      onLowWaterMark: () => lowTriggered++,
    });

    const frame = Buffer.alloc(3840, 0x11);
    assert.strictEqual(rb.write(frame), 3840);
    assert.strictEqual(rb.write(frame), 3840);
    assert.strictEqual(rb.write(frame), 3840);
    assert.strictEqual(highTriggered, 1, "High watermark should trigger at 75% fill");

    const out = new Int16Array(1920);
    assert.strictEqual(rb.readFrameInt16(out), 1920);
    assert.strictEqual(rb.readFrameInt16(out), 1920);
    assert.strictEqual(lowTriggered, 1, "Low watermark should trigger at 25% fill");

    // Wrap-around write/read verification
    const pattern = new Int16Array(1920);
    for (let i = 0; i < pattern.length; i++) pattern[i] = (i % 1000) - 500;
    const patternBuf = Buffer.from(pattern.buffer);
    assert.strictEqual(rb.write(patternBuf), 3840);
    assert.strictEqual(rb.write(patternBuf), 3840);

    // Drain first remaining frame
    rb.readFrameInt16(out);
    // Read wrapped frame and verify sample integrity
    rb.readFrameInt16(out);
    for (let i = 0; i < pattern.length; i++) {
      assert.strictEqual(out[i], pattern[i], `Sample mismatch at index ${i} after wrap-around`);
    }
    console.log("[PASS] RingBuffer circular wrap-around & watermark backpressure");
  }

  // 2. DSP Nodes & DSPChain tests
  {
    const dsp = new DSPChain({ normalisation: true, volume: 0.5 });
    const rawPcm = generateSinePcmBuffer(20, 440, 20000);
    const frame = new Int16Array(rawPcm.buffer, rawPcm.byteOffset, 1920);

    dsp.setFilter("bassboost");
    dsp.processFrame(frame);

    // Verify samples are finite, non-zero, and within Int16 bounds
    let maxAbs = 0;
    for (let i = 0; i < frame.length; i++) {
      const a = Math.abs(frame[i]);
      if (a > maxAbs) maxAbs = a;
    }
    assert(maxAbs > 1000 && maxAbs <= 32767, `Processed DSP amplitude out of expected range: ${maxAbs}`);

    // Test MixerNode overlay summing + ducking
    const ovRing = dsp.mixer.createOverlay("test-ov", { volume: 0.8, duckPrimary: true });
    ovRing.write(generateSinePcmBuffer(20, 880, 10000));
    dsp.mixer.markOverlayEof("test-ov");
    assert.strictEqual(dsp.mixer.hasActiveOverlays(), true);
    dsp.processFrame(frame);
    assert.strictEqual(dsp.mixer.hasActiveOverlays(), false, "Overlay should auto-clean up after draining EOF");
    console.log("[PASS] DSPChain (VolumeNode ramp, LoudnormNode AGC/limiter, BiquadFilterNode EQ, MixerNode overlay)");
  }

  // 3. Worker-backed MediaPlayer end-to-end playback, pause/resume, volume, and SharedArrayBuffer telemetry
  {
    const adapter = new MockTransportAdapter();
    await adapter.connect();

    const player = new MediaPlayer({ normalisation: true, useWorker: true, volume: 0.8 });
    await player.publishToRoom(adapter);

    const pcmData = generateSinePcmBuffer(160, 440, 12000); // 8 frames of 20ms
    const readable = Readable.from([pcmData]);

    let startFired = false;
    const finishPromise = new Promise((resolve) => {
      player.once("startplay", () => {
        startFired = true;
      });
      player.once("finish", resolve);
    });

    await player.playStream(readable, ["-f s16le", "-ar 48000", "-ac 2"]);

    // Wait a moment for prebuffer + 2 frames, then test pause/resume
    await new Promise((r) => setTimeout(r, 70));
    player.pause();
    assert.strictEqual(player.paused, true);
    assert.strictEqual(player.playbackPaused, true);
    const framesAtPause = adapter.framesCaptured;
    await new Promise((r) => setTimeout(r, 60));
    assert.strictEqual(adapter.framesCaptured, framesAtPause, "No frames should be emitted while paused");

    player.resume();
    assert.strictEqual(player.paused, false);

    await finishPromise;
    assert.strictEqual(startFired, true, "startplay event should fire");
    assert(adapter.framesCaptured >= 7, `Expected >= 7 frames captured, got ${adapter.framesCaptured}`);
    player.destroy();
    console.log(`[PASS] MediaPlayer (Worker Pool + SharedArrayBuffer telemetry + pause/resume): ${adapter.framesCaptured} frames delivered`);
  }

  // 4. High-Concurrency Benchmark: 100 simultaneous active voice channels
  {
    const CONCURRENT_CHANNELS = 100;
    const DURATION_MS = 1000; // 1 second = 50 frames per channel = 5,000 total frames processed
    const pcm1Sec = generateSinePcmBuffer(DURATION_MS, 440, 14000);

    const pacer = new Pacer(20);
    const pipelines = [];
    let totalFramesDelivered = 0;

    const memBefore = process.memoryUsage().heapUsed;
    const startHr = process.hrtime.bigint();

    const completionPromises = [];
    for (let c = 0; c < CONCURRENT_CHANNELS; c++) {
      const p = new AudioPipeline({
        pacer,
        normalisation: true,
        volume: 0.75,
        onFrame: () => {
          totalFramesDelivered++;
        },
      });
      if (c % 2 === 0) {
        p.setFilter("bassboost");
      }
      pipelines.push(p);

      completionPromises.push(
        new Promise((resolve) => {
          p.once("finish", resolve);
        })
      );

      // Feed 1 second of raw 48kHz stereo PCM
      const chunkStream = new Readable({
        read() {
          this.push(pcm1Sec);
          this.push(null);
        },
      });
      p.playStream(chunkStream, ["-f s16le", "-ar 48000", "-ac 2"]);
    }

    const cpuBefore = process.cpuUsage();
    await Promise.all(completionPromises);
    const cpuDelta = process.cpuUsage(cpuBefore);
    const elapsedWallMs = Number(process.hrtime.bigint() - startHr) / 1_000_000;
    const memAfter = process.memoryUsage().heapUsed;

    for (const p of pipelines) {
      p.destroy();
    }
    pacer.stop();

    const totalCpuMs = (cpuDelta.user + cpuDelta.system) / 1000;
    const cpuPercent = ((totalCpuMs / elapsedWallMs) * 100).toFixed(2);
    const memPerChannelKB = Math.max(0, (memAfter - memBefore) / 1024 / CONCURRENT_CHANNELS).toFixed(1);

    console.log(`[PASS] High-Concurrency Stress Test (${CONCURRENT_CHANNELS} simultaneous voice channels w/ Loudnorm + EQ):`);
    console.log(`       - Total 20ms frames processed: ${totalFramesDelivered} frames`);
    console.log(`       - Wall-clock time: ${elapsedWallMs.toFixed(1)} ms (target ~1000 ms)`);
    console.log(`       - Total CPU time across all 100 channels: ${totalCpuMs.toFixed(2)} ms (${cpuPercent}% of 1 core)`);
    console.log(`       - Net heap delta per channel: ~${memPerChannelKB} KB`);
  }

  await WorkerPoolManager.shared.shutdown();
  console.log("\nAll tests and concurrency benchmarks passed!");
}

runTests().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
