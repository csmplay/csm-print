import {
  Command,
  DEFAULTS,
  makeCommand,
  nonNegativePixels,
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

const PRINTER_WIDTH_BYTES = 48;

function byte(value, name) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`${name} must be an integer between 0 and 255`);
  }
  return value;
}

function rowsToData(rows, minimumRows) {
  const rowCount = Math.max(rows.length, minimumRows);
  const data = new Uint8Array(rowCount * PRINTER_WIDTH_BYTES);
  for (let y = 0; y < rows.length; y += 1) {
    data.set(rows[y].subarray(0, PRINTER_WIDTH_BYTES), y * PRINTER_WIDTH_BYTES);
  }
  return data;
}

function appendBlankRows(rows, count) {
  if (count === 0) return rows;
  const result = rows.slice();
  for (let i = 0; i < count; i += 1) result.push(new Uint8Array(PRINTER_WIDTH_BYTES));
  return result;
}

function printerError(status) {
  const flags = status?.[6] ?? 0;
  if (flags & 0x04) return "Printer reports out of paper";
  if (flags & 0x02) return "Printer reports a paper jam";
  if (flags & 0x08) return "Printer reports an open cover";
  return null;
}

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
    try {
      const device = await this.transport.connect();
      this._connected = true;
      await this.initialize();
      return device;
    } catch (error) {
      this._connected = false;
      await this.transport.disconnect?.();
      throw error;
    }
  }

  async initialize() {
    if (typeof this.transport.waitForNotification !== "function") {
      throw new Error("Printer transport does not support notifications");
    }

    // These two requests are sent back-to-back by the captured MXW01 app.
    await this.writeCommand(Command.GetIdentity, []);
    await this.writeCommand(Command.GetVersion, [0]);
    await this.transport.waitForNotification(Command.GetIdentity, DEFAULTS.responseTimeout);
    await this.transport.waitForNotification(Command.GetVersion, DEFAULTS.responseTimeout);
  }

  async disconnect() {
    try {
      return await this.transport.disconnect?.();
    } finally {
      this._connected = false;
    }
  }

  async writeCommand(command, payload, options = {}) {
    await this.transport.write(makeCommand(command, payload));
    if (!options.waitForResponse) return undefined;
    if (typeof this.transport.waitForNotification !== "function") {
      throw new Error("Printer transport does not support notifications");
    }
    return this.transport.waitForNotification(command, options.timeout ?? DEFAULTS.responseTimeout);
  }

  async writeRows(rows, options) {
    const settings = { ...this.options, ...options };
    const status = await this.writeCommand(
      Command.GetStatus,
      [0],
      { waitForResponse: true, timeout: settings.responseTimeout },
    );
    const statusFailure = printerError(status);
    if (statusFailure) throw new Error(statusFailure);

    const intensity = byte(settings.intensity ?? DEFAULTS.intensity, "intensity");
    await this.writeCommand(Command.SetIntensity, [intensity]);
    await sleep(settings.commandPause ?? DEFAULTS.commandPause);

    const feed = nonNegativePixels(settings.feed ?? DEFAULTS.feed, "feed");
    const printableRows = appendBlankRows(rows, feed);
    if (printableRows.length > 0xffff) {
      throw new RangeError("print job is too tall for the MXW01 line-count field");
    }

    const lines = printableRows.length;
    const acknowledgement = await this.writeCommand(
      Command.PrintRequest,
      [lines & 255, lines >> 8, 0x30, 0],
      { waitForResponse: true, timeout: settings.responseTimeout },
    );
    if (!acknowledgement || acknowledgement[0] !== 0) {
      throw new Error("Print request rejected");
    }

    const data = rowsToData(
      printableRows,
      pixels(settings.minimumDataRows ?? DEFAULTS.minimumDataRows, "minimumDataRows"),
    );
    const chunkSize = pixels(settings.chunkSize ?? DEFAULTS.chunkSize, "chunkSize");
    const writeData = typeof this.transport.writeData === "function"
      ? this.transport.writeData.bind(this.transport)
      : this.transport.write.bind(this.transport);
    for (let i = 0; i < data.length; i += chunkSize) {
      await writeData(data.slice(i, i + chunkSize));
      const pause = settings.chunkPause ?? DEFAULTS.chunkPause;
      if (pause > 0) await sleep(pause);
    }

    await this.writeCommand(Command.FlushData, [0]);
    await sleep(settings.commandPause ?? DEFAULTS.commandPause);
    if (typeof this.transport.waitForNotification !== "function") {
      throw new Error("Printer transport does not support print completion notifications");
    }
    await this.transport.waitForNotification(Command.PrintComplete, settings.completionTimeout ?? DEFAULTS.completionTimeout);
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
