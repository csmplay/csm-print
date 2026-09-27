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
    this._device = null;
    this._connectPromise = null;
    this._connectionId = 0;
    this._printQueue = Promise.resolve();
  }

  get connected() {
    return this.transport.connected ?? this._connected;
  }

  connect() {
    if (this._connectPromise) return this._connectPromise;
    if (this._connected && this.connected) return Promise.resolve(this._device);

    const connection = (async () => {
      try {
        const device = await this.transport.connect();
        await this.initialize();
        this._device = device;
        this._connected = true;
        this._connectionId += 1;
        return device;
      } catch (error) {
        this._connected = false;
        this._device = null;
        this._connectionId += 1;
        await this.transport.disconnect?.();
        throw error;
      }
    })();
    this._connectPromise = connection.finally(() => { this._connectPromise = null; });
    return this._connectPromise;
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
      this._device = null;
      this._connectionId += 1;
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

  writeRows(rows, options) {
    return this._enqueuePrint((connectionId) => this._writeRows(rows, options, connectionId));
  }

  _checkPrintConnection(connectionId) {
    if (!this.connected) throw new Error("Printer is not connected");
    if (this._connectionId !== connectionId) throw new Error("Printer connection changed during print");
  }

  async _writeRows(rows, options, connectionId) {
    this._checkPrintConnection(connectionId);
    const settings = { ...this.options, ...options };
    const status = await this.writeCommand(
      Command.GetStatus,
      [0],
      { waitForResponse: true, timeout: settings.responseTimeout },
    );
    this._checkPrintConnection(connectionId);
    const statusFailure = printerError(status);
    if (statusFailure) throw new Error(statusFailure);

    const intensity = byte(settings.intensity ?? DEFAULTS.intensity, "intensity");
    await this.writeCommand(Command.SetIntensity, [intensity]);
    await sleep(settings.commandPause ?? DEFAULTS.commandPause);
    this._checkPrintConnection(connectionId);

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
    this._checkPrintConnection(connectionId);
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
      this._checkPrintConnection(connectionId);
      await writeData(data.slice(i, i + chunkSize));
      const pause = settings.chunkPause ?? DEFAULTS.chunkPause;
      if (pause > 0) await sleep(pause);
    }

    this._checkPrintConnection(connectionId);
    await this.writeCommand(Command.FlushData, [0]);
    await sleep(settings.commandPause ?? DEFAULTS.commandPause);
    this._checkPrintConnection(connectionId);
    if (typeof this.transport.waitForNotification !== "function") {
      throw new Error("Printer transport does not support print completion notifications");
    }
    await this.transport.waitForNotification(Command.PrintComplete, settings.completionTimeout ?? DEFAULTS.completionTimeout);
    this._checkPrintConnection(connectionId);
  }

  _enqueuePrint(print) {
    const connectionId = this._connectionId;
    const job = this._printQueue.then(() => {
      this._checkPrintConnection(connectionId);
      return print(connectionId);
    });
    this._printQueue = job.catch(() => {});
    return job;
  }

  printBitmap(image, options = {}) {
    return this._enqueuePrint((connectionId) => this._printBitmap(image, options, connectionId));
  }

  async _printBitmap(image, options, connectionId) {
    this._checkPrintConnection(connectionId);
    const settings = { ...this.options, ...options };
    const rows = rasterize(image, settings);
    const pages = splitRows(rows, settings);
    for (const page of pages) {
      this._checkPrintConnection(connectionId);
      await this._writeRows(page, settings, connectionId);
    }
    const size = resolveOutputSize(image.width, image.height, settings);
    return { width: size.width, height: size.height, pages: pages.length };
  }

  printImage(input, options = {}) {
    return this._enqueuePrint(async (connectionId) => {
      if (isImageDataLike(input)) return this._printBitmap(input, options, connectionId);
      const settings = { ...this.options, ...options };
      const image = await decodeImage(input, settings);
      return this._printBitmap(image, { ...options, width: image.width, height: image.height, scale: 1 }, connectionId);
    });
  }

  printElement(element, options = {}) {
    return this._enqueuePrint(async (connectionId) => {
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
      return this._printBitmap(image, { ...options, width: outputSize.width, height: outputSize.height, scale: 1 }, connectionId);
    });
  }
}

export default Printer;
