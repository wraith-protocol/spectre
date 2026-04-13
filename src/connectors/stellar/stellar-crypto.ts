import { ed25519 } from '@noble/curves/ed25519';
import { x25519 } from '@noble/curves/ed25519';
import { edwardsToMontgomeryPub, edwardsToMontgomeryPriv } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { StrKey } from '@stellar/stellar-sdk';

export const STEALTH_SIGNING_MESSAGE =
  'Sign this message to generate your Wraith stealth keys.\n\nChain: Stellar\nNote: This signature is used for key derivation only and does not authorize any transaction.';

export const SCHEME_ID = 1;

export const META_ADDRESS_PREFIX = 'st:xlm:';

export const L = BigInt(
  '7237005577332262213973186563042994240857116359379907606001950938285454250989',
);

export interface StealthKeys {
  spendingKey: Uint8Array;
  spendingScalar: bigint;
  viewingKey: Uint8Array;
  viewingScalar: bigint;
  spendingPubKey: Uint8Array;
  viewingPubKey: Uint8Array;
}

export interface GeneratedStealthAddress {
  stealthAddress: string;
  ephemeralPubKey: Uint8Array;
  viewTag: number;
}

export interface Announcement {
  schemeId: number;
  stealthAddress: string;
  caller: string;
  ephemeralPubKey: string;
  metadata: string;
}

export interface MatchedAnnouncement extends Announcement {
  stealthPrivateScalar: bigint;
  stealthPubKeyBytes: Uint8Array;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('Invalid hex string length');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToScalar(bytes: Uint8Array): bigint {
  let scalar = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    scalar = (scalar << 8n) | BigInt(bytes[i]);
  }
  return scalar;
}

function scalarToBytes(scalar: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let s = scalar;
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(s & 0xffn);
    s >>= 8n;
  }
  return bytes;
}

export function seedToScalar(seed: Uint8Array): bigint {
  const h = sha512(seed);
  const a = new Uint8Array(h.slice(0, 32));
  a[0] &= 248;
  a[31] &= 127;
  a[31] |= 64;
  return bytesToScalar(a);
}

function hashToScalar(sharedSecret: Uint8Array): bigint {
  const prefix = new TextEncoder().encode('wraith:scalar:');
  const input = new Uint8Array(prefix.length + sharedSecret.length);
  input.set(prefix);
  input.set(sharedSecret, prefix.length);
  const hash = sha256(input);
  return bytesToScalar(hash) % L;
}

function deriveStealthPubKey(spendingPubKey: Uint8Array, hashScalar: bigint): Uint8Array {
  const K_spend = ed25519.ExtendedPoint.fromHex(spendingPubKey);
  const hashPoint = ed25519.ExtendedPoint.BASE.multiply(hashScalar);
  return K_spend.add(hashPoint).toRawBytes();
}

function pubKeyToStellarAddress(pubKeyBytes: Uint8Array): string {
  return StrKey.encodeEd25519PublicKey(Buffer.from(pubKeyBytes));
}

function computeSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const privX = edwardsToMontgomeryPriv(privateKey);
  const pubX = edwardsToMontgomeryPub(publicKey);
  return x25519.getSharedSecret(privX, pubX);
}

function computeViewTag(sharedSecret: Uint8Array): number {
  const prefix = new TextEncoder().encode('wraith:tag:');
  const input = new Uint8Array(prefix.length + sharedSecret.length);
  input.set(prefix);
  input.set(sharedSecret, prefix.length);
  return sha256(input)[0];
}

export function signWithScalar(
  message: Uint8Array,
  scalar: bigint,
  publicKey: Uint8Array,
): Uint8Array {
  const scBytes = scalarToBytes(scalar);
  const prefix = sha256(scBytes);

  const rInput = new Uint8Array(prefix.length + message.length);
  rInput.set(prefix);
  rInput.set(message, prefix.length);
  const rHash = sha512(rInput);
  const r = bytesToScalar(rHash) % L;

  const R = ed25519.ExtendedPoint.BASE.multiply(r);
  const encodedR = R.toRawBytes();

  const kInput = new Uint8Array(encodedR.length + publicKey.length + message.length);
  kInput.set(encodedR);
  kInput.set(publicKey, encodedR.length);
  kInput.set(message, encodedR.length + publicKey.length);
  const kHash = sha512(kInput);
  const k = bytesToScalar(kHash) % L;

  const S = (r + ((k * scalar) % L)) % L;
  const encodedS = scalarToBytes(S);

  const sig = new Uint8Array(64);
  sig.set(encodedR);
  sig.set(encodedS, 32);
  return sig;
}

export function signStellarTransaction(
  transactionHash: Uint8Array,
  stealthScalar: bigint,
  stealthPubKey: Uint8Array,
): Uint8Array {
  return signWithScalar(transactionHash, stealthScalar, stealthPubKey);
}

export function deriveStealthKeys(signature: Uint8Array): StealthKeys {
  if (signature.length !== 64) {
    throw new Error(`Expected 64-byte ed25519 signature, got ${signature.length} bytes`);
  }

  const spendingPrefix = new TextEncoder().encode('wraith:spending:');
  const viewingPrefix = new TextEncoder().encode('wraith:viewing:');

  const spendingInput = new Uint8Array(spendingPrefix.length + signature.length);
  spendingInput.set(spendingPrefix);
  spendingInput.set(signature, spendingPrefix.length);

  const viewingInput = new Uint8Array(viewingPrefix.length + signature.length);
  viewingInput.set(viewingPrefix);
  viewingInput.set(signature, viewingPrefix.length);

  const spendingKey = sha256(spendingInput);
  const viewingKey = sha256(viewingInput);

  const spendingScalar = seedToScalar(spendingKey);
  const viewingScalar = seedToScalar(viewingKey);

  const spendingPubKey = ed25519.getPublicKey(spendingKey);
  const viewingPubKey = ed25519.getPublicKey(viewingKey);

  return { spendingKey, spendingScalar, viewingKey, viewingScalar, spendingPubKey, viewingPubKey };
}

export function generateStealthAddress(
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array,
): GeneratedStealthAddress {
  const ephSeed = ed25519.utils.randomPrivateKey();
  const ephPubKey = ed25519.getPublicKey(ephSeed);

  const sharedSecret = computeSharedSecret(ephSeed, viewingPubKey);
  const viewTag = computeViewTag(sharedSecret);
  const hScalar = hashToScalar(sharedSecret);
  const stealthPubKeyBytes = deriveStealthPubKey(spendingPubKey, hScalar);
  const stealthAddress = pubKeyToStellarAddress(stealthPubKeyBytes);

  return { stealthAddress, ephemeralPubKey: ephPubKey, viewTag };
}

export function encodeStealthMetaAddress(
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array,
): string {
  if (spendingPubKey.length !== 32) {
    throw new Error(`Spending public key must be 32 bytes, got ${spendingPubKey.length}`);
  }
  if (viewingPubKey.length !== 32) {
    throw new Error(`Viewing public key must be 32 bytes, got ${viewingPubKey.length}`);
  }
  ed25519.ExtendedPoint.fromHex(spendingPubKey);
  ed25519.ExtendedPoint.fromHex(viewingPubKey);
  return `${META_ADDRESS_PREFIX}${bytesToHex(spendingPubKey)}${bytesToHex(viewingPubKey)}`;
}

export function decodeStealthMetaAddress(metaAddress: string): {
  spendingPubKey: Uint8Array;
  viewingPubKey: Uint8Array;
} {
  if (!metaAddress.startsWith(META_ADDRESS_PREFIX)) {
    throw new Error(`Invalid stealth meta-address prefix. Expected "${META_ADDRESS_PREFIX}"`);
  }
  const hex = metaAddress.slice(META_ADDRESS_PREFIX.length);
  if (hex.length !== 128) {
    throw new Error(
      `Invalid stealth meta-address length. Expected 128 hex chars, got ${hex.length}`,
    );
  }
  const spendingPubKey = hexToBytes(hex.slice(0, 64));
  const viewingPubKey = hexToBytes(hex.slice(64));
  ed25519.ExtendedPoint.fromHex(spendingPubKey);
  ed25519.ExtendedPoint.fromHex(viewingPubKey);
  return { spendingPubKey, viewingPubKey };
}

function checkStealthAddress(
  ephemeralPubKey: Uint8Array,
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  viewTag: number,
): {
  isMatch: boolean;
  stealthAddress: string | null;
  hashScalar: bigint | null;
  stealthPubKeyBytes: Uint8Array | null;
} {
  const sharedSecret = computeSharedSecret(viewingKey, ephemeralPubKey);
  const computedTag = computeViewTag(sharedSecret);
  if (computedTag !== viewTag) {
    return { isMatch: false, stealthAddress: null, hashScalar: null, stealthPubKeyBytes: null };
  }
  const hScalar = hashToScalar(sharedSecret);
  const stealthPubKeyBytes = deriveStealthPubKey(spendingPubKey, hScalar);
  const stealthAddress = pubKeyToStellarAddress(stealthPubKeyBytes);
  return { isMatch: true, stealthAddress, hashScalar: hScalar, stealthPubKeyBytes };
}

export function scanAnnouncements(
  announcements: Announcement[],
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  spendingScalar: bigint,
): MatchedAnnouncement[] {
  const matched: MatchedAnnouncement[] = [];
  for (const ann of announcements) {
    if (ann.schemeId !== SCHEME_ID) continue;
    const metadataBytes = hexToBytes(ann.metadata);
    if (metadataBytes.length === 0) continue;
    const viewTag = metadataBytes[0];
    const ephPubKey = hexToBytes(ann.ephemeralPubKey);
    if (ephPubKey.length !== 32) continue;
    const result = checkStealthAddress(ephPubKey, viewingKey, spendingPubKey, viewTag);
    if (
      result.isMatch &&
      result.stealthAddress === ann.stealthAddress &&
      result.hashScalar !== null &&
      result.stealthPubKeyBytes !== null
    ) {
      const stealthPrivateScalar = (spendingScalar + result.hashScalar) % L;
      matched.push({ ...ann, stealthPrivateScalar, stealthPubKeyBytes: result.stealthPubKeyBytes });
    }
  }
  return matched;
}
