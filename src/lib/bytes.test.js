import { describe, expect, it } from "vitest"
import { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes } from "./bytes"

describe("bytes", () => {
  const sample = new Uint8Array([0, 1, 15, 16, 127, 128, 255])

  it("round-trips through the hex form Postgres stores bytea as", () => {
    expect(bytesToHex(sample)).toBe("\\x00010f107f80ff")
    expect(hexToBytes(bytesToHex(sample))).toEqual(sample)
  })

  it("reads hex back with or without the leading marker", () => {
    expect(hexToBytes("00010f")).toEqual(new Uint8Array([0, 1, 15]))
    expect(hexToBytes("\\x00010f")).toEqual(new Uint8Array([0, 1, 15]))
  })

  it("treats an absent value as absent rather than as empty bytes", () => {
    expect(bytesToHex(null)).toBeNull()
    expect(hexToBytes(null)).toBeNull()
  })

  it("round-trips through the base64 form a broadcast payload carries", () => {
    expect(base64ToBytes(bytesToBase64(sample))).toEqual(sample)
  })

  it("encodes a payload far past the argument limit a spread would hit", () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 256)

    expect(base64ToBytes(bytesToBase64(big))).toEqual(big)
  })
})
