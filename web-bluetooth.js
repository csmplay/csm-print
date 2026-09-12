import { sameBytes } from "./core.js";

const SERVICE_UUIDS = [0xae30, 0xaf30];
const WRITE_UUID = 0xae01;
const NOTIFY_UUID = 0xae02;
const READY = Uint8Array.from([0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x00, 0x00, 0xff]);

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
