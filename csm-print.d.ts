export interface ImageDataLike {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface Notification {
  command: number;
  payload: Uint8Array;
}

export interface PrintResult {
  width: number;
  height: number;
  pages: number;
}

export interface PrinterTransport {
  readonly connected?: boolean;
  connect(): Promise<unknown>;
  disconnect?(): void | Promise<void>;
  write(bytes: Uint8Array): void | Promise<void>;
  writeData?(bytes: Uint8Array): void | Promise<void>;
  waitForNotification(command: number, timeout?: number): Promise<Uint8Array>;
}

export interface HtmlToImageOptions {
  width?: number;
  height?: number;
  backgroundColor?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  style?: Partial<CSSStyleDeclaration>;
  filter?: (domNode: HTMLElement) => boolean;
  quality?: number;
  cacheBust?: boolean;
  includeQueryParams?: boolean;
  imagePlaceholder?: string;
  pixelRatio?: number;
  skipFonts?: boolean;
  preferredFontFormat?: string;
  fontEmbedCSS?: string;
  skipAutoScale?: boolean;
  type?: string;
  fetchRequestInit?: RequestInit;
}

export interface OutputSizeOptions {
  width?: number;
  height?: number;
  scale?: number;
}

export interface RasterizeOptions extends OutputSizeOptions {
  threshold?: number;
}

export interface WriteCommandOptions {
  waitForResponse?: boolean;
  timeout?: number;
}

export interface PrinterOptions extends RasterizeOptions {
  transport?: PrinterTransport;
  chunkSize?: number;
  chunkPause?: number;
  feed?: number;
  intensity?: number;
  commandPause?: number;
  responseTimeout?: number;
  completionTimeout?: number;
  minimumDataRows?: number;
  pageHeight?: number;
  pageBreaks?: number[];
  backgroundColor?: string;
  captureWidth?: number;
  captureHeight?: number;
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  htmlToImage?: HtmlToImageOptions;
  toCanvas?: (
    element: HTMLElement,
    options: HtmlToImageOptions,
  ) => HTMLCanvasElement | ImageDataLike | Promise<HTMLCanvasElement | ImageDataLike>;
}

export type ImageInput =
  | ImageDataLike
  | HTMLCanvasElement
  | HTMLImageElement
  | HTMLVideoElement
  | ImageBitmap
  | OffscreenCanvas
  | Blob
  | ArrayBuffer
  | ArrayBufferView;

export declare const DEFAULTS: {
  readonly width: 384;
  readonly threshold: 160;
  readonly chunkSize: 480;
  readonly chunkPause: 15;
  readonly feed: 0;
  readonly intensity: 0x5d;
  readonly commandPause: 50;
  readonly responseTimeout: 5000;
  readonly completionTimeout: 20000;
  readonly minimumDataRows: 90;
};

export declare const Command: {
  readonly GetStatus: 0xa1;
  readonly SetIntensity: 0xa2;
  readonly PrintRequest: 0xa9;
  readonly FlushData: 0xad;
  readonly PrintComplete: 0xaa;
  readonly GetIdentity: 0xa7;
  readonly GetVersion: 0xb1;
};

export declare const PROTOCOL: {
  readonly HEADER_BYTE_1: 0x22;
  readonly HEADER_BYTE_2: 0x21;
  readonly TERMINATOR: 0xff;
};

export declare function makeCommand(
  command: number,
  payload?: ArrayLike<number> | Iterable<number>,
): Uint8Array;

export declare function parseNotification(message: Uint8Array): Notification | null;

export declare function rasterize(
  image: ImageDataLike,
  options?: RasterizeOptions,
): Uint8Array[];

export declare function resolveOutputSize(
  sourceWidth: number,
  sourceHeight: number,
  options?: OutputSizeOptions,
): { width: number; height: number };

export declare class Printer {
  options: PrinterOptions;
  transport: PrinterTransport;
  readonly connected: boolean;

  constructor(options?: PrinterOptions);
  connect(): Promise<unknown>;
  initialize(): Promise<void>;
  disconnect(): Promise<void>;
  writeCommand(
    command: number,
    payload?: ArrayLike<number> | Iterable<number>,
    options?: WriteCommandOptions,
  ): Promise<Uint8Array | undefined>;
  writeRows(rows: readonly Uint8Array[], options?: PrinterOptions): Promise<void>;
  printElement(element: HTMLElement, options?: PrinterOptions): Promise<PrintResult>;
  printBitmap(image: ImageDataLike, options?: PrinterOptions): Promise<PrintResult>;
  printImage(input: ImageInput, options?: PrinterOptions): Promise<PrintResult>;
}

export declare class WebBluetoothTransport implements PrinterTransport {
  readonly connected: boolean;
  onNotification?: (bytes: Uint8Array) => void;

  constructor();
  connect(): Promise<unknown>;
  disconnect(): void;
  write(bytes: Uint8Array): Promise<void>;
  writeData(bytes: Uint8Array): Promise<void>;
  waitForNotification(command: number, timeout?: number): Promise<Uint8Array>;
}

export default Printer;
