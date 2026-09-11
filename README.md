# csm-print

Small browser library for 384-dot thermal printers. For js webapps using Web Bluetooth.

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
