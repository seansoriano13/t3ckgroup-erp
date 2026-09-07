/**
 * Byte encodings for the two places a Flow Plan's document has to leave the
 * browser: `bytea` in Postgres, which PostgREST speaks as a `\x`-prefixed hex
 * string, and a realtime broadcast payload, which has to be JSON.
 *
 * Neither encoder spreads the array into a call: `bytesToHex` walks it a byte
 * at a time, and `bytesToBase64` hands `String.fromCharCode` fixed-size chunks.
 * A plan of any real size would overrun the argument limit that
 * `String.fromCharCode(...bytes)` runs into.
 */

const CHUNK = 0x8000;

export function bytesToHex(bytes) {
  if (!bytes) return null;
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `\\x${hex}`;
}

export function hexToBytes(hex) {
  if (!hex) return null;
  const body = hex.startsWith('\\x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(body.length / 2);
  for (let i = 0; i < body.length; i += 2) {
    bytes[i / 2] = parseInt(body.substring(i, i + 2), 16);
  }
  return bytes;
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
