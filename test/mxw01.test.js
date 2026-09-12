import assert from "node:assert/strict";
import test from "node:test";
import { Command, Printer, makeCommand } from "csm-print";

function bytes(value) {
  return Array.from(value);
}

function captureTransport() {
  return {
    connected: true,
    controlWrites: [],
    dataWrites: [],
    connect() {
      return Promise.resolve({ name: "MXW01" });
    },
    write(value) {
      this.controlWrites.push(bytes(value));
    },
    writeData(value) {
      this.dataWrites.push(bytes(value));
    },
    waitForNotification(command) {
      if (command === Command.GetStatus) return Promise.resolve(new Uint8Array(10));
      if (command === Command.PrintRequest) return Promise.resolve(Uint8Array.of(0));
      if (command === Command.PrintComplete) return Promise.resolve(Uint8Array.of(0, 0, 0));
      if (command === Command.GetIdentity) return Promise.resolve(Uint8Array.of(0, 1, 2, 3, 4, 5));
      if (command === Command.GetVersion) return Promise.resolve(new TextEncoder().encode("1.9.3.1.1"));
      throw new Error(`unexpected notification command 0x${command.toString(16)}`);
    },
  };
}

test("matches captured MXW01 command frames", () => {
  assert.deepEqual(bytes(makeCommand(Command.GetIdentity, [])), [
    0x22, 0x21, 0xa7, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  assert.deepEqual(bytes(makeCommand(Command.GetVersion, [0])), [
    0x22, 0x21, 0xb1, 0x00, 0x01, 0x00, 0x00, 0x00, 0xff,
  ]);
  assert.deepEqual(bytes(makeCommand(Command.GetStatus, [0])), [
    0x22, 0x21, 0xa1, 0x00, 0x01, 0x00, 0x00, 0x00, 0xff,
  ]);
  assert.deepEqual(bytes(makeCommand(Command.SetIntensity, [0x5d])), [
    0x22, 0x21, 0xa2, 0x00, 0x01, 0x00, 0x5d, 0x94, 0xff,
  ]);
  assert.deepEqual(bytes(makeCommand(Command.PrintRequest, [0x94, 0x01, 0x30, 0x00])), [
    0x22, 0x21, 0xa9, 0x00, 0x04, 0x00, 0x94, 0x01, 0x30, 0x00, 0x00, 0x00,
  ]);
  assert.deepEqual(bytes(makeCommand(Command.FlushData, [0])), [
    0x22, 0x21, 0xad, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  ]);
});

test("performs the captured MXW01 initialization exchange", async () => {
  const transport = captureTransport();
  const printer = new Printer({ transport, commandPause: 0 });

  await printer.connect();

  assert.deepEqual(transport.controlWrites, [
    [0x22, 0x21, 0xa7, 0x00, 0x00, 0x00, 0x00, 0x00],
    [0x22, 0x21, 0xb1, 0x00, 0x01, 0x00, 0x00, 0x00, 0xff],
  ]);
});

test("prints through the MXW01 control and data channels", async () => {
  const transport = captureTransport();
  const printer = new Printer({ transport });
  const imageData = new Uint8ClampedArray(384 * 10 * 4).fill(255);

  const result = await printer.printBitmap(
    { width: 384, height: 10, data: imageData },
    { width: 384, feed: 0, minimumDataRows: 1, commandPause: 0, chunkPause: 0 },
  );

  assert.deepEqual(result, { width: 384, height: 10, pages: 1 });
  assert.deepEqual(transport.controlWrites, [
    [0x22, 0x21, 0xa1, 0x00, 0x01, 0x00, 0x00, 0x00, 0xff],
    [0x22, 0x21, 0xa2, 0x00, 0x01, 0x00, 0x5d, 0x94, 0xff],
    [0x22, 0x21, 0xa9, 0x00, 0x04, 0x00, 0x0a, 0x00, 0x30, 0x00, 0x00, 0x00],
    [0x22, 0x21, 0xad, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00],
  ]);
  assert.equal(transport.dataWrites.length, 1);
  assert.equal(transport.dataWrites[0].length, 480);
});
