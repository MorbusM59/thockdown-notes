/**
 * Soundscape player: the AudioWorklet that plays a soundscape rendered ahead
 * of time by a worker (src/sound/soundscapeRenderAhead.ts). It does no
 * synthesis, only copies finished samples to its outputs, so the audio
 * thread's work per block is small and a stall of the CPU is covered by the
 * seconds of audio already queued here rather than by one output buffer.
 *
 * Plain JavaScript under public/ because an AudioWorklet module is loaded by
 * URL and cannot import the app's TypeScript.
 *
 * Outputs: the same two stereo outputs the generator renders, so the graph
 * after this node is unchanged -- 0 the DIRECT sound, 1 the SEND to the
 * space (the engine's reverb).
 *
 * Messages on this node's own port (from SoundscapeEngine):
 * - `connect` carries a MessagePort to the render worker. Chunks arrive on
 *   it, `{ type: 'chunk', generation, channels: [directL, directR, sendL,
 *   sendR] }`, and this player answers on it with `{ type: 'consumed',
 *   generation, frames }` every REPORT_FRAMES played, which is what lets
 *   the worker render more.
 * - `stop` ends the processor (process() returns false, which is how a
 *   processor tells the browser it may be collected).
 *
 * Statistics: every STATS_FRAMES played it posts `{ type: 'stats',
 * queuedFrames, dryFrames, dryEvents }` on its own port. `queuedFrames` is
 * what the playing generation has left; `dryFrames`/`dryEvents` count, since
 * the player started, the frames it had to play as silence because the
 * playing generation had nothing queued, and how many separate times that
 * began. They tell a starved render worker (the player ran dry) apart from a
 * stall further down the output path (the output ran dry while this player
 * still had audio queued), which need different fixes.
 *
 * GENERATIONS. Each change of settings starts a new generation in the
 * worker. When the first chunk of a newer generation arrives, the player
 * crossfades to it from what it is playing over CROSSFADE_SEC, equal-power
 * (the two are uncorrelated, so their powers add), then discards whatever
 * was left of the old. At most three generations are held: the one playing
 * (`current`), the one fading in (`incoming`), and the newest one waiting
 * for that fade to finish (`waiting`); a still newer one replaces
 * `waiting`, so a burst of changes costs at most two fades.
 *
 * Underrun: a generation with no samples left plays silence until more
 * arrive. That is the failure this design makes rare, not one it removes.
 */
const CROSSFADE_SEC = 0.05;
const REPORT_FRAMES = 2048;
const STATS_FRAMES = 8192;

/** One generation's queued audio, read front to back. */
class Stream {
  constructor(generation) {
    this.generation = generation;
    this.chunks = [];
    // Frames already read from chunks[0].
    this.offset = 0;
    // Frames queued and not yet read.
    this.available = 0;
    this.unreported = 0;
  }

  push(channels) {
    this.chunks.push(channels);
    this.available += channels[0].length;
  }

  /**
   * Copy the next `count` frames into the four arrays of `into` and
   * return how many were available; the rest of `into` is zeroed.
   */
  read(into, count) {
    let written = 0;
    while (written < count && this.chunks.length > 0) {
      const chunk = this.chunks[0];
      const take = Math.min(count - written, chunk[0].length - this.offset);
      for (let channel = 0; channel < 4; channel += 1) {
        into[channel].set(chunk[channel].subarray(this.offset, this.offset + take), written);
      }
      written += take;
      this.offset += take;
      if (this.offset >= chunk[0].length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    for (let channel = 0; channel < 4; channel += 1) into[channel].fill(0, written);
    this.unreported += written;
    this.available -= written;
    return written;
  }
}

class SoundscapePlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.renderer = null;
    this.current = null;
    this.incoming = null;
    this.waiting = null;
    this.fadeFrame = 0;
    this.fadeFrames = Math.max(1, Math.round(CROSSFADE_SEC * sampleRate));
    this.newestGeneration = -1;
    this.stopped = false;
    this.dryFrames = 0;
    this.dryEvents = 0;
    this.wasDry = false;
    this.framesSinceStats = 0;
    this.scratchA = [0, 1, 2, 3].map(() => new Float32Array(128));
    this.scratchB = [0, 1, 2, 3].map(() => new Float32Array(128));
    this.port.onmessage = (event) => {
      const data = event.data;
      if (data?.type === 'stop') {
        this.stopped = true;
        return;
      }
      if (data?.type === 'connect') {
        this.renderer = data.port;
        this.renderer.onmessage = (message) => {
          if (message.data?.type === 'chunk') this.receive(message.data.generation, message.data.channels);
        };
      }
    };
  }

  receive(generation, channels) {
    for (const stream of [this.current, this.incoming, this.waiting]) {
      if (stream && stream.generation === generation) {
        stream.push(channels);
        return;
      }
    }
    // A chunk of a generation already replaced: discard it.
    if (generation <= this.newestGeneration) return;
    this.newestGeneration = generation;
    const stream = new Stream(generation);
    stream.push(channels);
    if (!this.current) {
      this.current = stream;
    } else if (!this.incoming) {
      this.incoming = stream;
      this.fadeFrame = 0;
    } else {
      this.waiting = stream;
    }
  }

  /** Count `dry` silent frames of a block of `length`, and post statistics when due. */
  countDry(dry, length) {
    if (dry > 0 && !this.wasDry) this.dryEvents += 1;
    this.wasDry = dry > 0;
    this.dryFrames += dry;
    this.framesSinceStats += length;
    if (this.framesSinceStats < STATS_FRAMES) return;
    this.framesSinceStats = 0;
    this.port.postMessage({
      type: 'stats',
      queuedFrames: this.current ? this.current.available : 0,
      dryFrames: this.dryFrames,
      dryEvents: this.dryEvents,
    });
  }

  report(stream) {
    if (!this.renderer || stream.unreported < REPORT_FRAMES) return;
    this.renderer.postMessage({ type: 'consumed', generation: stream.generation, frames: stream.unreported });
    stream.unreported = 0;
  }

  process(_inputs, outputs) {
    if (this.stopped) return false;
    const length = outputs[0][0].length;
    if (this.scratchA[0].length < length) {
      this.scratchA = [0, 1, 2, 3].map(() => new Float32Array(length));
      this.scratchB = [0, 1, 2, 3].map(() => new Float32Array(length));
    }
    const targets = [outputs[0][0], outputs[0][1], outputs[1][0], outputs[1][1]];
    if (!this.current) {
      for (const target of targets) target.fill(0);
      return true;
    }
    const a = this.scratchA;
    const read = this.current.read(a, length);
    this.report(this.current);
    this.countDry(length - read, length);
    if (!this.incoming) {
      for (let channel = 0; channel < 4; channel += 1) targets[channel].set(a[channel].subarray(0, length));
      return true;
    }
    const b = this.scratchB;
    this.incoming.read(b, length);
    this.report(this.incoming);
    for (let index = 0; index < length; index += 1) {
      const t = Math.min(1, (this.fadeFrame + index + 1) / this.fadeFrames);
      const out = Math.cos(t * Math.PI * 0.5);
      const into = Math.sin(t * Math.PI * 0.5);
      for (let channel = 0; channel < 4; channel += 1) {
        targets[channel][index] = (a[channel][index] * out) + (b[channel][index] * into);
      }
    }
    this.fadeFrame += length;
    if (this.fadeFrame >= this.fadeFrames) {
      this.current = this.incoming;
      this.incoming = this.waiting;
      this.waiting = null;
      this.fadeFrame = 0;
    }
    return true;
  }
}

registerProcessor('soundscape-player', SoundscapePlayer);
