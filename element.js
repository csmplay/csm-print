import { pixels } from "./core.js";

export function elementSize(element, options = {}) {
  if (!element || typeof element !== "object") throw new TypeError("Expected a DOM element");
  const rect = element.getBoundingClientRect?.() ?? {};
  const firstPositive = (...values) => values.find((value) => typeof value === "number" && value > 0);
  const width = options.captureWidth ?? firstPositive(element.scrollWidth, rect.width, element.offsetWidth);
  const height = options.captureHeight ?? firstPositive(element.scrollHeight, rect.height, element.offsetHeight);
  return { width: pixels(width, "element width"), height: pixels(height, "element height") };
}

export async function captureElement(element, captureOptions, options) {
  if (typeof options.toCanvas === "function") return options.toCanvas(element, captureOptions);
  const htmlToImage = await import("html-to-image");
  return htmlToImage.toCanvas(element, captureOptions);
}
