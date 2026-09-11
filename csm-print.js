const DEFAULTS = {
  width: 384,
  threshold: 160,
  chunkSize: 100,
  chunkPause: 14,
  feed: 40,
  energy: 40000,
};

const SERVICE_UUIDS = [0xae30, 0xaf30];
const WRITE_UUID = 0xae01;
const NOTIFY_UUID = 0xae02;
const READY = Uint8Array.from([0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x00, 0x00, 0xff]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function crc8(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 0x80 ? ((crc << 1) ^ 7) & 255 : (crc << 1) & 255;
  }
  return crc;
}

function packet(command, payload) {
  const body = Uint8Array.from(payload);
  const result = new Uint8Array(body.length + 8);
  result.set([0x51, 0x78, command, 0, body.length & 255, body.length >> 8]);
  result.set(body, 6);
  result[body.length + 6] = crc8(body);
  result[body.length + 7] = 255;
  return result;
}

function latticePacket(end) {
  return Uint8Array.from(end
    ? [0x51, 0x78, 0xa6, 0, 0x0b, 0, 0xaa, 0x55, 0x17, 0, 0, 0, 0, 0, 0, 0, 0x17, 0x11, 0xff]
    : [0x51, 0x78, 0xa6, 0, 0x0b, 0, 0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c, 0xa1, 0xff]);
}

function sameBytes(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function positiveNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number`);
  }
  return value;
}

function pixels(value, name) {
  return Math.max(1, Math.round(positiveNumber(value, name)));
}

function isImageDataLike(image) {
  return Boolean(image && image.data && image.width > 0 && image.height > 0);
}

/**
 * Resolve the output dimensions used by rasterize and the browser decoders.
 * `width`, `height`, and `scale` describe printer pixels, not CSS pixels.
 */
export function resolveOutputSize(sourceWidth, sourceHeight, options = {}) {
  const width = positiveNumber(sourceWidth, "sourceWidth");
  const height = positiveNumber(sourceHeight, "sourceHeight");
  const scale = options.scale ?? 1;
  positiveNumber(scale, "scale");
  const outputWidth = pixels((options.width ?? DEFAULTS.width) * scale, "width");
  const outputHeight = options.height == null
    ? pixels(height * outputWidth / width, "height")
    : pixels(options.height * scale, "height");
  return { width: outputWidth, height: outputHeight };
}

/**
 * Convert an RGBA ImageData-like value to rows of printer bitmap bytes.
 * Bits are packed least-significant-bit first, as required by the protocol.
 */
export function rasterize(image, options = {}) {
  if (!isImageDataLike(image)) throw new TypeError("Expected an ImageData-like object");
  const sourceWidth = pixels(image.width, "image.width");
  const sourceHeight = pixels(image.height, "image.height");
  const expectedBytes = sourceWidth * sourceHeight * 4;
  if (image.data.length < expectedBytes) throw new RangeError("ImageData-like data is shorter than width * height * 4");

  const { width, height } = resolveOutputSize(sourceWidth, sourceHeight, options);
  const threshold = options.threshold ?? DEFAULTS.threshold;
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) throw new RangeError("threshold must be a finite number");

  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = new Uint8Array(Math.ceil(width / 8));
    const sourceY = Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / width));
      const p = (sourceY * sourceWidth + sourceX) * 4;
      const alpha = (image.data[p + 3] ?? 255) / 255;
      const gray = (image.data[p] * 0.299 + image.data[p + 1] * 0.587 + image.data[p + 2] * 0.114) * alpha + 255 * (1 - alpha);
      if (gray < threshold) row[x >> 3] |= 1 << (x & 7);
    }
    rows.push(row);
  }
  return rows;
}

function pageRanges(height, options = {}) {
  const boundaries = [];
  if (options.pageHeight != null) {
    const pageHeight = pixels(options.pageHeight, "pageHeight");
    for (let y = pageHeight; y < height; y += pageHeight) boundaries.push(y);
  }
  if (options.pageBreaks != null) {
    if (!Array.isArray(options.pageBreaks)) throw new TypeError("pageBreaks must be an array of output-pixel offsets");
    for (const value of options.pageBreaks) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > height) {
        throw new RangeError(`page break must be between 0 and ${height}`);
      }
      const boundary = Math.round(value);
      if (boundary > 0 && boundary < height) boundaries.push(boundary);
    }
  }
  const points = [0, ...new Set(boundaries), height].sort((a, b) => a - b);
  return points.slice(0, -1).map((start, i) => ({ start, end: points[i + 1] }));
}

function splitRows(rows, options = {}) {
  return pageRanges(rows.length, options).map(({ start, end }) => rows.slice(start, end));
}

/** Browser Web Bluetooth transport. */
export class WebBluetoothTransport {
  async connect() {
    if (!globalThis.navigator?.bluetooth) throw new Error("Web Bluetooth is unavailable");
    this.device = await navigator.bluetooth.requestDevice({
      filters: SERVICE_UUIDS.map((uuid) => ({ services: [uuid] })), optionalServices: SERVICE_UUIDS,
    });
    this.server = await this.device.gatt.connect();
    for (const uuid of SERVICE_UUIDS) {
      try {
        this.service = await this.server.getPrimaryService(uuid);
        break;
      } catch {}
    }
    if (!this.service) throw new Error("Printer service AE30/AF30 not found");
    this.writeCharacteristic = await this.service.getCharacteristic(WRITE_UUID);
    const notify = await this.service.getCharacteristic(NOTIFY_UUID);
    await notify.startNotifications();
    notify.addEventListener("characteristicvaluechanged", (event) => {
      const v = event.target.value;
      if (sameBytes(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), READY)) this.onReady?.();
    });
    this.device.addEventListener("gattserverdisconnected", () => {
      this.server = null;
      this.service = null;
      this.writeCharacteristic = null;
    });
    return this.device;
  }

  async write(bytes) {
    if (!this.writeCharacteristic) throw new Error("Printer is not connected");
    const c = this.writeCharacteristic;
    const method = c.properties.writeWithoutResponse ? "writeValueWithoutResponse" : "writeValue";
    await c[method](bytes);
  }

  disconnect() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.server = null;
    this.service = null;
    this.writeCharacteristic = null;
  }

  get connected() {
    return Boolean(this.writeCharacteristic);
  }
}

function context2d(canvas) {
  const context = canvas?.getContext?.("2d", { willReadFrequently: true }) ?? canvas?.getContext?.("2d");
  if (!context) throw new Error("A 2D canvas context is required");
  return context;
}

function createCanvas(width, height, options = {}) {
  const canvas = options.canvas ?? globalThis.document?.createElement?.("canvas");
  if (!canvas) throw new Error("Canvas APIs are unavailable; run this method in a browser");
  canvas.width = width;
  canvas.height = height;
  return { canvas, context: context2d(canvas) };
}

function canvasImageData(canvas) {
  const width = pixels(canvas?.width, "canvas.width");
  const height = pixels(canvas?.height, "canvas.height");
  return context2d(canvas).getImageData(0, 0, width, height);
}

function drawableDimensions(image) {
  const width = image?.naturalWidth || image?.videoWidth || image?.width;
  const height = image?.naturalHeight || image?.videoHeight || image?.height;
  if (!width || !height) throw new TypeError("Expected a browser image, canvas, or encoded image");
  return { width, height };
}

function isDrawableInput(input) {
  return Boolean(input && (input.naturalWidth > 0 || input.videoWidth > 0 || (input.width > 0 && input.height > 0)));
}

function asBlob(input) {
  if (typeof globalThis.Blob !== "undefined" && input instanceof Blob) return input;
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) return new Blob([input]);
  throw new TypeError("Expected a Blob, File, ArrayBuffer, or Uint8Array");
}

async function loadEncodedImage(input) {
  const blob = asBlob(input);
  if (typeof globalThis.createImageBitmap === "function") {
    return { image: await globalThis.createImageBitmap(blob), owned: true };
  }
  throw new Error("This browser does not provide createImageBitmap for encoded image input");
}

async function decodeImage(input, options = {}) {
  if (isImageDataLike(input)) return input;

  let source;
  let owned = false;
  if (typeof input?.getContext === "function") {
    source = input;
  } else if (isDrawableInput(input) && typeof input !== "string") {
    source = input;
  } else {
    ({ image: source, owned } = await loadEncodedImage(input));
  }

  try {
    const sourceSize = drawableDimensions(source);
    const size = resolveOutputSize(sourceSize.width, sourceSize.height, options);
    const { canvas, context } = createCanvas(size.width, size.height, options);
    context.fillStyle = options.backgroundColor ?? "#fff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(source, 0, 0, size.width, size.height);
    return context.getImageData(0, 0, size.width, size.height);
  } finally {
    if (owned) source.close?.();
  }
}

function elementSize(element, options = {}) {
  if (!element || typeof element !== "object") throw new TypeError("Expected a DOM element");
  const rect = element.getBoundingClientRect?.() ?? {};
  const firstPositive = (...values) => values.find((value) => typeof value === "number" && value > 0);
  const width = options.captureWidth ?? firstPositive(element.scrollWidth, rect.width, element.offsetWidth);
  const height = options.captureHeight ?? firstPositive(element.scrollHeight, rect.height, element.offsetHeight);
  return { width: pixels(width, "element width"), height: pixels(height, "element height") };
}

async function captureElement(element, captureOptions, options) {
  if (typeof options.toCanvas === "function") return options.toCanvas(element, captureOptions);
  const htmlToImage = await import("html-to-image");
  return htmlToImage.toCanvas(element, captureOptions);
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
