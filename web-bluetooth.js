import { parseNotification } from "./core.js";

const SERVICE_UUIDS = [0xae30, 0xaf30];
const WRITE_UUID = 0xae01;
const DATA_UUID = 0xae03;
const NOTIFY_UUID = 0xae02;

/** Browser Web Bluetooth transport for the MXW01 GATT layout. */
export class WebBluetoothTransport {
  constructor() {
    this.notificationQueue = [];
    this.notificationWaiters = [];
    this.handleNotification = (event) => {
      const value = event.target.value;
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const notification = parseNotification(bytes);
      if (notification) this.dispatchNotification(notification);
      this.onNotification?.(bytes);
    };
    this.handleDisconnect = (event) => {
      if (event.target === this.device && !this.device.gatt.connected) this.clearConnection();
    };
  }

  async connect() {
    if (this.connected) return this.device;
    if (this.device) this.clearConnection();
    if (!this.device) {
      if (!globalThis.navigator?.bluetooth) throw new Error("Web Bluetooth is unavailable");
      this.device = await navigator.bluetooth.requestDevice({
        filters: SERVICE_UUIDS.map((uuid) => ({ services: [uuid] })), optionalServices: SERVICE_UUIDS,
      });
      this.device.addEventListener("gattserverdisconnected", this.handleDisconnect);
    }
    this.server = await this.device.gatt.connect();
    this.service = null;
    for (const uuid of SERVICE_UUIDS) {
      try {
        this.service = await this.server.getPrimaryService(uuid);
        break;
      } catch {}
    }
    if (!this.service) throw new Error("Printer service AE30/AF30 not found");

    this.writeCharacteristic = await this.service.getCharacteristic(WRITE_UUID);
    this.dataCharacteristic = await this.service.getCharacteristic(DATA_UUID);
    const notify = await this.service.getCharacteristic(NOTIFY_UUID);
    this.notifyCharacteristic = notify;
    this.notificationQueue = [];
    await notify.startNotifications();
    notify.addEventListener("characteristicvaluechanged", this.handleNotification);
    return this.device;
  }

  async write(bytes) {
    if (!this.writeCharacteristic) throw new Error("Printer is not connected");
    const characteristic = this.writeCharacteristic;
    const method = characteristic.properties.writeWithoutResponse
      ? "writeValueWithoutResponse"
      : "writeValue";
    await characteristic[method](bytes);
  }

  async writeData(bytes) {
    if (!this.dataCharacteristic) throw new Error("Printer data channel is unavailable");
    const characteristic = this.dataCharacteristic;
    const method = characteristic.properties.writeWithoutResponse
      ? "writeValueWithoutResponse"
      : "writeValue";
    await characteristic[method](bytes);
  }

  waitForNotification(command, timeout = 5000) {
    const queuedIndex = this.notificationQueue.findIndex((notification) => notification.command === command);
    if (queuedIndex >= 0) {
      const [notification] = this.notificationQueue.splice(queuedIndex, 1);
      return Promise.resolve(notification.payload);
    }
    if (!this.notifyCharacteristic) throw new Error("Printer notifications are unavailable");

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.notificationWaiters.indexOf(waiter);
        if (index >= 0) this.notificationWaiters.splice(index, 1);
        reject(new Error(`Timeout waiting for notification 0x${command.toString(16)}`));
      }, timeout);
      const waiter = { command, resolve, reject, timer };
      this.notificationWaiters.push(waiter);
    });
  }

  dispatchNotification(notification) {
    const waiterIndex = this.notificationWaiters.findIndex((waiter) => waiter.command === notification.command);
    if (waiterIndex < 0) {
      this.notificationQueue.push(notification);
      return;
    }
    const [waiter] = this.notificationWaiters.splice(waiterIndex, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(notification.payload);
  }

  rejectNotificationWaiters(error) {
    for (const waiter of this.notificationWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  clearConnection() {
    this.notifyCharacteristic?.removeEventListener("characteristicvaluechanged", this.handleNotification);
    this.server = null;
    this.service = null;
    this.writeCharacteristic = null;
    this.dataCharacteristic = null;
    this.notifyCharacteristic = null;
    this.notificationQueue = [];
    this.rejectNotificationWaiters(new Error("Printer disconnected"));
  }

  disconnect() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.clearConnection();
    this.device?.removeEventListener("gattserverdisconnected", this.handleDisconnect);
    this.device = null;
  }

  get connected() {
    return Boolean(this.device?.gatt?.connected && this.writeCharacteristic && this.dataCharacteristic);
  }
}
