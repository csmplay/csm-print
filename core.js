export const DEFAULTS = {
  width: 384,
  threshold: 160,
  chunkSize: 100,
  chunkPause: 14,
  feed: 40,
  energy: 40000,
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function crc8(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 0x80 ? ((crc << 1) ^ 7) & 255 : (crc << 1) & 255;
  }
  return crc;
}

export function packet(command, payload) {
  const body = Uint8Array.from(payload);
  const result = new Uint8Array(body.length + 8);
  result.set([0x51, 0x78, command, 0, body.length & 255, body.length >> 8]);
  result.set(body, 6);
  result[body.length + 6] = crc8(body);
  result[body.length + 7] = 255;
  return result;
}

export function latticePacket(end) {
  return Uint8Array.from(end
    ? [0x51, 0x78, 0xa6, 0, 0x0b, 0, 0xaa, 0x55, 0x17, 0, 0, 0, 0, 0, 0, 0, 0x17, 0x11, 0xff]
    : [0x51, 0x78, 0xa6, 0, 0x0b, 0, 0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c, 0xa1, 0xff]);
}

export function sameBytes(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function positiveNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number`);
  }
  return value;
}

export function pixels(value, name) {
  return Math.max(1, Math.round(positiveNumber(value, name)));
}
