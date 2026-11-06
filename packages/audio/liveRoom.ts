/**
 * A room (room.ts) played LIVE through the browser's own ConvolverNode: what
 * every desktop consumer of a room uses (the soundscape's voices, the music
 * player's reverb). Android's soundscape renders ahead and convolves in
 * JavaScript instead (@thockdown/soundscape/soundscapeMix.ts), from the same
 * impulse response and the same ROOM_CROSSFADE_SEC.
 *
 *   input -> convolver A -> gain A -> output
 *         -> convolver B -> gain B ->
 *
 * A playing convolver's buffer cannot be swapped without a click, so a new
 * room is built into the convolver NOT heard and crossfaded in over
 * ROOM_CROSSFADE_SEC. It is built on the main thread (a long room is several
 * milliseconds of arithmetic), so a changed room waits until the control has
 * rested for ROOM_REBUILD_DELAY_MS: a drag or a run of wheel notches would
 * otherwise build dozens. The FIRST room is built at once, because nothing
 * is heard until it is there. A room whose key (roomKey) has not changed is
 * not rebuilt at all.
 *
 * Costs: two ConvolverNodes, of which only one carries signal outside a
 * crossfade (a convolver fed silence by a zero gain still runs, but its
 * output is silence; the browser keeps the tail on a background thread). The
 * output gain is 0 or 1 except during the crossfade, so an idle consumer
 * should zero its own send rather than rely on this to be free.
 */
import { buildRoomImpulseResponse, roomKey, ROOM_CROSSFADE_SEC, type RoomShape } from './room';

/** How long a room control must rest before its room is built. */
export const ROOM_REBUILD_DELAY_MS = 120;

export class LiveRoom {
  /** What is sent into the room. */
  readonly input: GainNode;
  /** The room's return, the wet signal alone. */
  readonly output: GainNode;
  private readonly rooms: Array<{ convolver: ConvolverNode; gain: GainNode }>;
  private liveRoom = 0;
  private builtKey: string | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly context: BaseAudioContext) {
    this.input = context.createGain();
    this.output = context.createGain();
    this.rooms = [0, 1].map(() => {
      const convolver = context.createConvolver();
      // The response is calibrated by buildRoomImpulseResponse; the
      // browser's normalisation would rescale away what foliage takes away.
      // Must be set before a buffer is assigned.
      convolver.normalize = false;
      const gain = context.createGain();
      gain.gain.value = 0;
      this.input.connect(convolver);
      convolver.connect(gain);
      gain.connect(this.output);
      return { convolver, gain };
    });
  }

  /** Move to `shape`: at once for the first room, otherwise once the control has rested, crossfaded. */
  setRoom(shape: RoomShape): void {
    const key = roomKey(shape);
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    if (key === this.builtKey) return;
    if (this.builtKey === null) {
      this.install(shape, key);
      return;
    }
    const target = { ...shape };
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.install(target, key);
    }, ROOM_REBUILD_DELAY_MS);
  }

  private install(shape: RoomShape, key: string): void {
    const context = this.context;
    const [left, right] = buildRoomImpulseResponse(shape, context.sampleRate);
    const buffer = context.createBuffer(2, left.length, context.sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    const first = this.builtKey === null;
    const incoming = first ? this.liveRoom : 1 - this.liveRoom;
    const now = context.currentTime;
    this.rooms[incoming].convolver.buffer = buffer;
    for (const [index, room] of this.rooms.entries()) {
      const target = index === incoming ? 1 : 0;
      room.gain.gain.cancelScheduledValues(now);
      if (first) {
        room.gain.gain.setValueAtTime(target, now);
      } else {
        room.gain.gain.setValueAtTime(room.gain.gain.value, now);
        room.gain.gain.linearRampToValueAtTime(target, now + ROOM_CROSSFADE_SEC);
      }
    }
    this.liveRoom = incoming;
    this.builtKey = key;
  }

  /** Cancel a pending build and take the room's nodes down. */
  dispose(): void {
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    this.input.disconnect();
    for (const room of this.rooms) {
      room.convolver.disconnect();
      room.gain.disconnect();
    }
    this.output.disconnect();
  }
}
