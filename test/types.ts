import Printer, {
  Command,
  DEFAULTS,
  PROTOCOL,
  Printer as NamedPrinter,
  WebBluetoothTransport,
  makeCommand,
  parseNotification,
  rasterize,
  resolveOutputSize,
  type ImageDataLike,
  type ImageInput,
  type Notification,
  type PrintResult,
  type PrinterOptions,
  type PrinterTransport,
} from "csm-print";

const transport: PrinterTransport = {
  connected: true,
  connect: async () => ({ name: "fake" }),
  disconnect: async () => {},
  write: () => {},
  writeData: async () => {},
  waitForNotification: async () => new Uint8Array(),
};

const image: ImageDataLike = {
  width: 384,
  height: 100,
  data: new Uint8ClampedArray(384 * 100 * 4),
};

const options: PrinterOptions = {
  transport,
  width: 384,
  height: 800,
  pageHeight: 400,
  pageBreaks: [200, 600],
  backgroundColor: "#fff",
  htmlToImage: {
    pixelRatio: 1,
    filter: (element) => element.tagName !== "SCRIPT",
  },
  toCanvas: async (element, captureOptions) => {
    void element;
    void captureOptions;
    return document.createElement("canvas");
  },
};

const printer = new Printer(options);
const namedPrinter: typeof Printer = NamedPrinter;
const bluetoothTransport: PrinterTransport = new WebBluetoothTransport();
const commandFrame: Uint8Array = makeCommand(Command.GetStatus, [0]);
const notification: Notification | null = parseNotification(commandFrame);
const rows: Uint8Array[] = rasterize(image, options);
const outputSize: { width: number; height: number } = resolveOutputSize(100, 50, options);
const inputValues: ImageInput[] = [
  image,
  document.createElement("canvas"),
  document.createElement("img"),
  document.createElement("video"),
  new Blob(),
  new ArrayBuffer(0),
  new Uint8Array(),
];
const defaultWidth: number = DEFAULTS.width;
const protocolHeader: number = PROTOCOL.HEADER_BYTE_1;
const printResult: Promise<PrintResult> = printer.printBitmap(image, options);
const commandResult: Promise<Uint8Array | undefined> = printer.writeCommand(
  Command.GetStatus,
  [0],
  { waitForResponse: true, timeout: 1000 },
);
const rowsResult: Promise<void> = printer.writeRows([new Uint8Array(48)], options);

async function checkPrinter() {
  await printer.connect();
  await printer.initialize();
  await printer.printElement(document.body, options);
  await printer.printBitmap(image, options);
  await printer.printImage(inputValues[0], options);
  await printer.printImage(new Blob(), options);
  await printer.printImage(new ArrayBuffer(0), options);
  await printer.printImage(new Uint8Array(), options);
  await printer.disconnect();
}

void namedPrinter;
void bluetoothTransport;
void commandFrame;
void notification;
void rows;
void outputSize;
void defaultWidth;
void protocolHeader;
void printResult;
void commandResult;
void rowsResult;
void checkPrinter;
