import {
  DEFAULTS,
  latticePacket,
  packet,
  pixels,
  sleep,
} from "./core.js";
import {
  canvasImageData,
  decodeImage,
  isImageDataLike,
  rasterize,
  resolveOutputSize,
  splitRows,
} from "./image.js";
import { captureElement, elementSize } from "./element.js";
import { WebBluetoothTransport } from "./web-bluetooth.js";

export class Printer {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.transport = options.transport ?? new WebBluetoothTransport();
    this._connected = false;
  }

  get connected() {
    return this.transport.connected ?? this._connected;
  }

  async connect() {
    const device = await this.transport.connect();
    this._connected = true;
    return device;
  }

  async disconnect() {
    try {
      return await this.transport.disconnect?.();
    } finally {
      this._connected = false;
    }
  }

  async writeRows(rows, options) {
    const write = async (bytes) => {
      await this.transport.write(bytes);
      const pause = options.chunkPause ?? DEFAULTS.chunkPause;
      if (pause > 0) await sleep(pause);
    };
    const chunkSize = pixels(options.chunkSize ?? DEFAULTS.chunkSize, "chunkSize");
    const energy = Math.max(12000, Math.min(65535, options.energy ?? DEFAULTS.energy));
    const commands = [
      packet(0xa3, [0]),
      packet(0xa4, [0x32]),
      packet(0xaf, [energy >> 8, energy & 255]),
      packet(0xbe, [1]),
      latticePacket(false),
    ];
    for (const command of commands) await write(command);
    for (const row of rows) {
      const bytes = packet(0xa2, row);
      for (let i = 0; i < bytes.length; i += chunkSize) await write(bytes.slice(i, i + chunkSize));
    }
    for (const command of [
      packet(0xbd, [options.feed ?? DEFAULTS.feed]),
      packet(0xa1, [0x30, 0]),
      packet(0xa1, [0x30, 0]),
      packet(0xa1, [0x30, 0]),
      latticePacket(true),
      packet(0xa3, [0]),
    ]) await write(command);
  }

  async printBitmap(image, options = {}) {
    if (!this.connected) throw new Error("Printer is not connected");
    const settings = { ...this.options, ...options };
    const rows = rasterize(image, settings);
    const pages = splitRows(rows, settings);
    for (const page of pages) await this.writeRows(page, settings);
    const size = resolveOutputSize(image.width, image.height, settings);
    return { width: size.width, height: size.height, pages: pages.length };
  }

  async printImage(input, options = {}) {
    const settings = { ...this.options, ...options };
    if (isImageDataLike(input)) return this.printBitmap(input, options);
    const image = await decodeImage(input, settings);
    return this.printBitmap(image, { ...options, width: image.width, height: image.height, scale: 1 });
  }

  async printElement(element, options = {}) {
    const settings = { ...this.options, ...options };
    const sourceSize = elementSize(element, options);
    const outputSize = resolveOutputSize(sourceSize.width, sourceSize.height, settings);
    const captureOptions = {
      ...(options.htmlToImage ?? {}),
      width: sourceSize.width,
      height: sourceSize.height,
      canvasWidth: outputSize.width,
      canvasHeight: outputSize.height,
      pixelRatio: 1,
    };
    if (options.backgroundColor !== undefined) captureOptions.backgroundColor = options.backgroundColor;

    const canvas = await captureElement(element, captureOptions, options);
    const image = isImageDataLike(canvas) ? canvas : canvasImageData(canvas);
    return this.printBitmap(image, { ...options, width: outputSize.width, height: outputSize.height, scale: 1 });
  }
}

export default Printer;
