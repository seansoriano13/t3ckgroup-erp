import { describe, it, expect } from "vitest"
import { keyOutNearWhite } from "./signatureImage"

describe("keyOutNearWhite", () => {
  it("makes a white pixel fully transparent", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255])

    expect(keyOutNearWhite(rgba)[3]).toBe(0)
  })

  it("leaves a dark ink pixel opaque and untouched", () => {
    const rgba = new Uint8ClampedArray([20, 20, 30, 255])

    expect(Array.from(keyOutNearWhite(rgba))).toEqual([20, 20, 30, 255])
  })

  it("keys out near-white paper texture, not just pure white", () => {
    const offWhitePaper = new Uint8ClampedArray([245, 243, 238, 255])

    expect(keyOutNearWhite(offWhitePaper)[3]).toBe(0)
  })

  it("respects a custom threshold", () => {
    const midGray = new Uint8ClampedArray([150, 150, 150, 255])

    expect(keyOutNearWhite(midGray, 200)[3]).toBe(255)
    expect(keyOutNearWhite(midGray, 100)[3]).toBe(0)
  })

  it("processes every pixel in a multi-pixel buffer independently", () => {
    // white pixel, then a dark pixel
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 10, 10, 10, 255])

    const result = keyOutNearWhite(rgba)

    expect(result[3]).toBe(0)
    expect(result[7]).toBe(255)
  })

  it("does not mutate the input array", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255])

    keyOutNearWhite(rgba)

    expect(rgba[3]).toBe(255)
  })
})
