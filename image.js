import { DEFAULTS, pixels, positiveNumber } from "./core.js";

export function isImageDataLike(image) {
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

export function splitRows(rows, options = {}) {
  return pageRanges(rows.length, options).map(({ start, end }) => rows.slice(start, end));
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

export function canvasImageData(canvas) {
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

export async function decodeImage(input, options = {}) {
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
