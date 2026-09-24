export function buildSyntheticRoomImpulseResponse(ctx: AudioContext, roomSize: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const lengthSec = 0.1 + roomSize * 2.9;
  const length = Math.ceil(sampleRate * lengthSec);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / length, 2);
    }
  }
  return buffer;
}