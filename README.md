# csm-print

Small browser library for MXW01 384-dot thermal printers. For JS webapps using Web Bluetooth.

The implementation uses the MXW01 BLE layout: framed control commands on `AE01`, raw 48-byte raster rows on `AE03`, and responses on `AE02`. It defaults to 480-byte data writes (ten rows per write), matching the captured MXW01 app; pass `chunkSize: 48` for a smaller negotiated MTU.

```sh
npm install csm-print
```

```js
import Printer from "csm-print";

const printer = new Printer();
await printer.connect();

await printer.printElement(document.querySelector(".receipt"));
await printer.printImage(file);
await printer.printBitmap({ width, height, data });

printer.disconnect();
```

```js
await printer.printElement(element, {
  width: 384,
  pageHeight: 800,
});
```
