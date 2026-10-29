const { parentPort } = require("worker_threads");
const { PassThrough } = require("stream");
const AudioPipeline = require("./AudioPipeline.js");
const Pacer = require("./Pacer.js");

/**
 * Map of pipelineId to { pipeline: AudioPipeline, streams: Map<string, PassThrough> }
 * @type {Map<string, {pipeline: AudioPipeline, streams: Map<string, PassThrough}>}
 */
const pipelines = new Map();

function sendEvent(pipelineId, event, data = null, transferList = []) {
  if (!parentPort) return;
  parentPort.postMessage(
    {
      type: "event",
      pipelineId,
      event,
      data,
    },
    transferList
  );
}

if (parentPort) {
  parentPort.on("message", (msg) => {
    if (!msg || typeof msg !== "object") return;
    const { type, pipelineId } = msg;

    switch (type) {
      case "create": {
        if (pipelines.has(pipelineId)) {
          pipelines.get(pipelineId).pipeline.destroy();
          pipelines.delete(pipelineId);
        }

        const { options = {}, sharedStateBuffer } = msg;
        const pipeline = new AudioPipeline({
          ...options,
          sharedStateBuffer,
          pacer: Pacer.shared,
          onFrame: (frame, samplesPerChannel) => {
            // Transfer a compact Int16Array copy of the processed 20ms frame (3,840 bytes)
            const frameCopy = new Int16Array(frame);
            sendEvent(
              pipelineId,
              "frame",
              {
                samples: frameCopy,
                samplesPerChannel,
              },
              [frameCopy.buffer]
            );
          },
        });

        pipeline.on("buffer", () => sendEvent(pipelineId, "buffer"));
        pipeline.on("startplay", () => sendEvent(pipelineId, "startplay"));
        pipeline.on("pause", () => sendEvent(pipelineId, "pause"));
        pipeline.on("unpause", () => sendEvent(pipelineId, "unpause"));
        pipeline.on("finish", () => sendEvent(pipelineId, "finish"));
        pipeline.on("overlayFinish", (ovId) => sendEvent(pipelineId, "overlayFinish", ovId));
        pipeline.on("codecData", (d) => sendEvent(pipelineId, "codecData", d));
        pipeline.on("error", (err) =>
          sendEvent(pipelineId, "error", { message: err?.message || String(err) })
        );

        // Attach backpressure notifications for bridged main-thread Readable streams
        // while preserving AudioPipeline's internal backpressure hooks for active streams/processes
        const origHigh = pipeline.ringBuffer.onHighWaterMark;
        const origLow = pipeline.ringBuffer.onLowWaterMark;
        pipeline.ringBuffer.onHighWaterMark = () => {
          if (origHigh) origHigh();
          sendEvent(pipelineId, "backpressure", true);
        };
        pipeline.ringBuffer.onLowWaterMark = () => {
          if (origLow) origLow();
          sendEvent(pipelineId, "backpressure", false);
        };

        pipelines.set(pipelineId, {
          pipeline,
          streams: new Map(),
        });
        break;
      }

      case "playSource": {
        const entry = pipelines.get(pipelineId);
        if (!entry) return;
        const { source, inputOptions } = msg;
        entry.pipeline.playStream(source, inputOptions);
        break;
      }

      case "openStream": {
        const entry = pipelines.get(pipelineId);
        if (!entry) return;
        const { streamId, inputOptions, isOverlay, overlayOptions } = msg;
        const pass = new PassThrough({ highWaterMark: 64 * 1024 });
        entry.streams.set(streamId, pass);

        if (isOverlay) {
          entry.pipeline.playOverlay(pass, overlayOptions || {});
        } else {
          entry.pipeline.playStream(pass, inputOptions || []);
        }
        break;
      }

      case "streamChunk": {
        const entry = pipelines.get(pipelineId);
        if (!entry) return;
        const pass = entry.streams.get(msg.streamId);
        if (!pass || pass.destroyed) return;
        const buf = Buffer.from(msg.chunk);
        pass.write(buf);
        break;
      }

      case "streamEnd": {
        const entry = pipelines.get(pipelineId);
        if (!entry) return;
        const pass = entry.streams.get(msg.streamId);
        if (pass && !pass.destroyed) {
          if (typeof pass.isPaused === "function" && pass.isPaused()) {
            pass.resume();
          }
          pass.end();
        }
        entry.streams.delete(msg.streamId);
        break;
      }

      case "streamError": {
        const entry = pipelines.get(pipelineId);
        if (!entry) return;
        const pass = entry.streams.get(msg.streamId);
        if (pass && !pass.destroyed) {
          pass.destroy(new Error(msg.error || "Upstream error"));
        }
        entry.streams.delete(msg.streamId);
        break;
      }

      case "playOverlaySource": {
        const entry = pipelines.get(pipelineId);
        if (!entry) return;
        entry.pipeline.playOverlay(msg.source, msg.options || {});
        break;
      }

      case "pause": {
        const entry = pipelines.get(pipelineId);
        if (entry) entry.pipeline.pause();
        break;
      }

      case "resume": {
        const entry = pipelines.get(pipelineId);
        if (entry) entry.pipeline.resume();
        break;
      }

      case "setVolume": {
        const entry = pipelines.get(pipelineId);
        if (entry) entry.pipeline.setVolume(msg.volume);
        break;
      }

      case "setFilter": {
        const entry = pipelines.get(pipelineId);
        if (entry) entry.pipeline.setFilter(msg.filter);
        break;
      }

      case "setNormalisation": {
        const entry = pipelines.get(pipelineId);
        if (entry) entry.pipeline.setNormalisation(msg.enabled);
        break;
      }

      case "stop": {
        const entry = pipelines.get(pipelineId);
        if (!entry) return;
        for (const pass of entry.streams.values()) {
          try {
            pass.destroy();
          } catch (_) {}
        }
        entry.streams.clear();
        entry.pipeline.stop(msg.emitFinish !== false);
        break;
      }

      case "destroy": {
        const entry = pipelines.get(pipelineId);
        if (!entry) return;
        for (const pass of entry.streams.values()) {
          try {
            pass.destroy();
          } catch (_) {}
        }
        entry.streams.clear();
        entry.pipeline.destroy();
        pipelines.delete(pipelineId);
        break;
      }
    }
  });
}
