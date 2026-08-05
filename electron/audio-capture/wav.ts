const TARGET_SAMPLE_RATE = 16_000;

/** Converts captured PCM to the mono 16 kHz WAV shape used by Ledger's speech path. */
export function encodePcmWav(buffers: Float32Array[][], frameCount: number, sampleRate: number) {
  const channels = Math.max(1, buffers.length);
  const flattened = buffers.map((channelBuffers) => {
    const channel = new Float32Array(frameCount);
    let offset = 0;
    channelBuffers.forEach((buffer) => {
      const length = Math.min(buffer.length, frameCount - offset);
      if (length > 0) channel.set(buffer.subarray(0, length), offset);
      offset += buffer.length;
    });
    return channel;
  });
  const outputFrames = Math.max(1, Math.round(frameCount * TARGET_SAMPLE_RATE / Math.max(1, sampleRate)));
  const dataLength = outputFrames * 2;
  const output = new ArrayBuffer(44 + dataLength);
  const view = new DataView(output);
  const text = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + dataLength, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true); view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, dataLength, true);
  for (let outputFrame = 0; outputFrame < outputFrames; outputFrame += 1) {
    const position = outputFrame * Math.max(1, sampleRate) / TARGET_SAMPLE_RATE;
    const left = Math.floor(position);
    const right = Math.min(frameCount - 1, left + 1);
    const ratio = position - left;
    let sample = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const values = flattened[channel];
      sample += (values?.[left] ?? 0) * (1 - ratio) + (values?.[right] ?? values?.[left] ?? 0) * ratio;
    }
    sample /= channels;
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + outputFrame * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return output;
}

export { TARGET_SAMPLE_RATE };
