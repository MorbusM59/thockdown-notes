/**
 * Soundscape player: the AudioWorklet that plays the finished soundscape,
 * rendered ahead of time by a worker (src/sound/soundscapeRenderAhead.ts).
 * The desktop's output for it; Android plays the same chunks natively
 * (BackgroundAudioPlugin.java). It does no synthesis and no mixing, only
 * copies queued samples to its one stereo output, so the audio thread's
 * work per block is small.
 *
 * Plain JavaScript under public/ because an AudioWorklet module is loaded by
 * URL and cannot import the app's TypeScript.
 *
 * A QUEUE OF FRAMES AT ABSOLUTE POSITIONS. Chunks arrive as `{ type:
 * 'chunk', startFrame, left, right }` and are played in order of position.
 * A chunk starting before the end of what is queued REPLACES everything from
 * its start on: that is how a settings change arrives (the worker has
 * already crossfaded it into the old audio). If its start is already
 * behind the playhead, the part already due is dropped.
 *
 * Messages on this node's own port (from SoundscapeEngine):
 * - `connect` carries the MessagePort to the render worker; chunks arrive
 *   on it, and this player answers on it with `{ type: 'played', frame }`
 *   every REPORT_FRAMES, which is what lets the worker render more.
 * - `stop` ends the processor (process() returns false, which is how a
 *   processor tells the browser it may be collected).
 *
 * Statistics: every STATS_FRAMES played it posts `{ type: 'stats',
 * queuedFrames, dryFrames, dryEvents }` on its own port: what is queued past
 * the playhead, and the frames it played as silence for want of queued
 * audio, and how many separate times that began.
 */
const REPORT_FRAMES = 2048;
const STATS_FRAMES = 8192;

class SoundscapePlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.renderer = null;
    // Chunks in order: { start, left, right }, contiguous, the first
    // containing the playhead (or starting after it).
    this.chunks = [];
    this.playhead = 0;
    this.started = false;
    this.unreported = 0;
    this.stopped = false;
    this.dryFrames = 0;
    this.dryEvents = 0;
    this.wasDry = false;
    this.framesSinceStats = 0;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (data?.type === 'stop') {
        this.stopped = true;
        return;
      }
      if (data?.type === 'connect') {
        this.renderer = data.port;
        this.renderer.onmessage = (message) => {
          if (message.data?.type === 'chunk') this.receive(message.data.startFrame, message.data.left, message.data.right);
        };
      }
    };
  }

  receive(start, left, right) {
    if (!this.started) {
      this.started = true;
      this.playhead = start;
    }
    // Replace whatever is queued from `start` on.
    while (this.chunks.length > 0) {
      const last = this.chunks[this.chunks.length - 1];
      if (last.start >= start) {
        this.chunks.pop();
      } else {
        if (last.start + last.left.length > start) {
          last.left = last.left.subarray(0, start - last.start);
          last.right = last.right.subarray(0, start - last.start);
        }
        break;
      }
    }
    // A part already due is dropped.
    if (start < this.playhead) {
      const late = this.playhead - start;
      if (late >= left.length) return;
      left = left.subarray(late);
      right = right.subarray(late);
      start = this.playhead;
    }
    this.chunks.push({ start, left, right });
  }

  /** Frames queued past the playhead. */
  queued() {
    if (this.chunks.length === 0) return 0;
    const last = this.chunks[this.chunks.length - 1];
    return Math.max(0, last.start + last.left.length - this.playhead);
  }

  process(_inputs, outputs) {
    if (this.stopped) return false;
    const outLeft = outputs[0][0];
    const outRight = outputs[0][1] ?? outLeft;
    const length = outLeft.length;
    let written = 0;
    while (written < length && this.chunks.length > 0) {
      const chunk = this.chunks[0];
      if (chunk.start > this.playhead) break;
      const offset = this.playhead - chunk.start;
      const take = Math.min(length - written, chunk.left.length - offset);
      outLeft.set(chunk.left.subarray(offset, offset + take), written);
      if (outRight !== outLeft) outRight.set(chunk.right.subarray(offset, offset + take), written);
      written += take;
      this.playhead += take;
      if (offset + take >= chunk.left.length) this.chunks.shift();
    }
    const dry = this.started ? length - written : 0;
    outLeft.fill(0, written);
    if (outRight !== outLeft) outRight.fill(0, written);
    // Silence still moves the playhead: the position is time, so a gap is
    // a gap rather than a delay of everything after it.
    this.playhead += dry;

    if (this.started) {
      this.unreported += length;
      if (this.renderer && this.unreported >= REPORT_FRAMES) {
        this.renderer.postMessage({ type: 'played', frame: this.playhead });
        this.unreported = 0;
      }
      if (dry > 0 && !this.wasDry) this.dryEvents += 1;
      this.wasDry = dry > 0;
      this.dryFrames += dry;
      this.framesSinceStats += length;
      if (this.framesSinceStats >= STATS_FRAMES) {
        this.framesSinceStats = 0;
        this.port.postMessage({ type: 'stats', queuedFrames: this.queued(), dryFrames: this.dryFrames, dryEvents: this.dryEvents });
      }
    }
    return true;
  }
}

registerProcessor('soundscape-player', SoundscapePlayer);
