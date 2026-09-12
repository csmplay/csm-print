import assert from "node:assert/strict";
import Printer, {
  Printer as NamedPrinter,
  WebBluetoothTransport,
  rasterize,
  resolveOutputSize,
} from "csm-print";

assert.equal(Printer, NamedPrinter);
assert.equal(typeof Printer, "function");
assert.equal(typeof WebBluetoothTransport, "function");
assert.equal(typeof rasterize, "function");
assert.deepEqual(resolveOutputSize(100, 50, { width: 384 }), { width: 384, height: 192 });
