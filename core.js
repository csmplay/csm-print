export const DEFAULTS = Object.freeze({
  width: 384,
  threshold: 160,
  chunkSize: 480,
  chunkPause: 15,
  feed: 0,
  intensity: 0x5d,
  commandPause: 50,
  responseTimeout: 5000,
  completionTimeout: 20000,
  minimumDataRows: 90,
});

export const Command = Object.freeze({
  GetStatus: 0xa1,
  SetIntensity: 0xa2,
  PrintRequest: 0xa9,
  FlushData: 0xad,
  PrintComplete: 0xaa,
  GetIdentity: 0xa7,
  GetVersion: 0xb1,
});

export const PROTOCOL = Object.freeze({
  HEADER_BYTE_1: 0x22,
  HEADER_BYTE_2: 0x21,
  TERMINATOR: 0xff,
});

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function crc8(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 0x80 ? ((crc << 1) ^ 7) & 255 : (crc << 1) & 255;
  }
  return crc;
}

/**
 * Build an MXW01 control command.
 * The checksum covers the payload only.
 */
export function makeCommand(command, payload = []) {
  const body = Uint8Array.from(payload);
  const result = new Uint8Array(body.length + 8);
  result.set([
    PROTOCOL.HEADER_BYTE_1,
    PROTOCOL.HEADER_BYTE_2,
    command,
    0,
    body.length & 255,
    body.length >> 8,
  ]);
  result.set(body, 6);
  // The captured MXW01 app uses a zero checksum/trailer for A7, A9, and AD.
  // A1, A2, and B1 use the normal payload CRC followed by FF.
  const zeroTail = command === Command.GetIdentity
    || command === Command.PrintRequest
    || command === Command.FlushData;
  result[body.length + 6] = zeroTail ? 0 : crc8(body);
  result[body.length + 7] = zeroTail ? 0 : PROTOCOL.TERMINATOR;
  return result;
}

/**
 * Parse an MXW01 notification. Notification CRCs are intentionally not
 * verified here: the reference protocol exposes command/payload parsing only,
 * and the transport already delivers a complete GATT value.
 */
export function parseNotification(message) {
  if (!message || message.length < 6) return null;
  if (message[0] !== PROTOCOL.HEADER_BYTE_1 || message[1] !== PROTOCOL.HEADER_BYTE_2) return null;

  const command = message[2];
  const length = message[4] | (message[5] << 8);
  if (message.length < 6 + length) return null;
  return { command, payload: message.slice(6, 6 + length) };
}

export function positiveNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number`);
  }
  return value;
}

export function nonNegativeNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative number`);
  }
  return value;
}

export function pixels(value, name) {
  return Math.max(1, Math.round(positiveNumber(value, name)));
}

export function nonNegativePixels(value, name) {
  return Math.round(nonNegativeNumber(value, name));
}
