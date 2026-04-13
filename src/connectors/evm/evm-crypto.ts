import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak256, toHex, toBytes, getAddress, encodePacked } from 'viem';

export type HexString = `0x${string}`;

export const STEALTH_SIGNING_MESSAGE =
  'Sign this message to generate your Wraith stealth keys.\n\nChain: Horizen\nNote: This signature is used for key derivation only. It does not authorize any transaction.';

export const SCHEME_ID = 1n;

export const META_ADDRESS_PREFIX = 'st:eth:0x';

export interface StealthKeys {
  spendingKey: HexString;
  viewingKey: HexString;
  spendingPubKey: HexString;
  viewingPubKey: HexString;
}

export interface GeneratedStealthAddress {
  stealthAddress: HexString;
  ephemeralPubKey: HexString;
  viewTag: number;
}

export interface Announcement {
  schemeId: bigint;
  stealthAddress: HexString;
  caller: HexString;
  ephemeralPubKey: HexString;
  metadata: HexString;
}

export interface MatchedAnnouncement extends Announcement {
  stealthPrivateKey: HexString;
}

export function deriveStealthKeys(signature: HexString): StealthKeys {
  const sigBytes = toBytes(signature);
  if (sigBytes.length !== 65) {
    throw new Error(`Expected 65-byte signature, got ${sigBytes.length} bytes`);
  }

  const r = sigBytes.slice(0, 32);
  const s = sigBytes.slice(32, 64);

  const spendingKey = keccak256(toHex(r));
  const viewingKey = keccak256(toHex(s));

  const n = secp256k1.CURVE.n;
  if (BigInt(spendingKey) === 0n || BigInt(spendingKey) >= n) {
    throw new Error('Derived spending key is not a valid secp256k1 scalar');
  }
  if (BigInt(viewingKey) === 0n || BigInt(viewingKey) >= n) {
    throw new Error('Derived viewing key is not a valid secp256k1 scalar');
  }

  const spendingPubKey = toHex(secp256k1.getPublicKey(toBytes(spendingKey), true)) as HexString;
  const viewingPubKey = toHex(secp256k1.getPublicKey(toBytes(viewingKey), true)) as HexString;

  return { spendingKey, viewingKey, spendingPubKey, viewingPubKey };
}

export function generateStealthAddress(
  spendingPubKey: HexString,
  viewingPubKey: HexString,
): GeneratedStealthAddress {
  const ephPrivKey = secp256k1.utils.randomPrivateKey();
  const ephPubKey = secp256k1.getPublicKey(ephPrivKey, true);

  const sharedSecret = secp256k1.getSharedSecret(ephPrivKey, toBytes(viewingPubKey), true);
  const hashedSecret = keccak256(toHex(sharedSecret));
  const hashedSecretBytes = toBytes(hashedSecret);
  const viewTag = hashedSecretBytes[0];

  const n = secp256k1.CURVE.n;
  const secretScalar = BigInt(hashedSecret) % n;
  if (secretScalar === 0n) {
    throw new Error('Hashed secret reduced to zero mod n');
  }

  const K_spend = secp256k1.ProjectivePoint.fromHex(toBytes(spendingPubKey));
  const sharedPoint = secp256k1.ProjectivePoint.BASE.multiply(secretScalar);
  const stealthPubKey = K_spend.add(sharedPoint);

  const uncompressed = stealthPubKey.toRawBytes(false);
  const pubKeyNoPrefix = uncompressed.slice(1);
  const addressHash = keccak256(toHex(pubKeyNoPrefix));
  const stealthAddress = getAddress(`0x${addressHash.slice(-40)}`) as HexString;

  return {
    stealthAddress,
    ephemeralPubKey: toHex(ephPubKey) as HexString,
    viewTag,
  };
}

export function checkStealthAddress(
  ephemeralPubKey: HexString,
  viewingKey: HexString,
  spendingPubKey: HexString,
  viewTag: number,
): { isMatch: boolean; stealthAddress: HexString | null } {
  const sharedSecret = secp256k1.getSharedSecret(
    toBytes(viewingKey),
    toBytes(ephemeralPubKey),
    true,
  );

  const hashedSecret = keccak256(toHex(sharedSecret));
  const hashedSecretBytes = toBytes(hashedSecret);

  if (hashedSecretBytes[0] !== viewTag) {
    return { isMatch: false, stealthAddress: null };
  }

  const n = secp256k1.CURVE.n;
  const secretScalar = BigInt(hashedSecret) % n;

  const K_spend = secp256k1.ProjectivePoint.fromHex(toBytes(spendingPubKey));
  const sharedPoint = secp256k1.ProjectivePoint.BASE.multiply(secretScalar);
  const stealthPubKey = K_spend.add(sharedPoint);

  const uncompressed = stealthPubKey.toRawBytes(false);
  const pubKeyNoPrefix = uncompressed.slice(1);
  const addressHash = keccak256(toHex(pubKeyNoPrefix));
  const stealthAddress = getAddress(`0x${addressHash.slice(-40)}`) as HexString;

  return { isMatch: true, stealthAddress };
}

export function scanAnnouncements(
  announcements: Announcement[],
  viewingKey: HexString,
  spendingPubKey: HexString,
  spendingKey: HexString,
): MatchedAnnouncement[] {
  const matched: MatchedAnnouncement[] = [];

  for (const ann of announcements) {
    if (ann.schemeId !== SCHEME_ID) continue;

    const metadataBytes = toBytes(ann.metadata);
    if (metadataBytes.length === 0) continue;
    const viewTag = metadataBytes[0];

    const result = checkStealthAddress(ann.ephemeralPubKey, viewingKey, spendingPubKey, viewTag);

    if (
      result.isMatch &&
      result.stealthAddress?.toLowerCase() === ann.stealthAddress.toLowerCase()
    ) {
      const stealthPrivateKey = deriveStealthPrivateKey(
        spendingKey,
        ann.ephemeralPubKey,
        viewingKey,
      );
      matched.push({ ...ann, stealthPrivateKey });
    }
  }

  return matched;
}

export function deriveStealthPrivateKey(
  spendingKey: HexString,
  ephemeralPubKey: HexString,
  viewingKey: HexString,
): HexString {
  const sharedSecret = secp256k1.getSharedSecret(
    toBytes(viewingKey),
    toBytes(ephemeralPubKey),
    true,
  );

  const hashedSecret = keccak256(toHex(sharedSecret));

  const n = secp256k1.CURVE.n;
  const m = BigInt(spendingKey);
  const s_h = BigInt(hashedSecret) % n;
  const stealthPrivKey = (m + s_h) % n;

  const hex = stealthPrivKey.toString(16).padStart(64, '0');
  return `0x${hex}` as HexString;
}

export function encodeStealthMetaAddress(
  spendingPubKey: HexString,
  viewingPubKey: HexString,
): string {
  const spendBytes = toBytes(spendingPubKey);
  const viewBytes = toBytes(viewingPubKey);

  if (spendBytes.length !== 33) {
    throw new Error(`Spending public key must be 33 bytes, got ${spendBytes.length}`);
  }
  if (viewBytes.length !== 33) {
    throw new Error(`Viewing public key must be 33 bytes, got ${viewBytes.length}`);
  }

  secp256k1.ProjectivePoint.fromHex(spendBytes);
  secp256k1.ProjectivePoint.fromHex(viewBytes);

  return `${META_ADDRESS_PREFIX}${spendingPubKey.slice(2)}${viewingPubKey.slice(2)}`;
}

export function decodeStealthMetaAddress(metaAddress: string): {
  spendingPubKey: HexString;
  viewingPubKey: HexString;
} {
  if (!metaAddress.startsWith(META_ADDRESS_PREFIX)) {
    throw new Error(`Invalid stealth meta-address prefix. Expected "${META_ADDRESS_PREFIX}"`);
  }

  const hex = metaAddress.slice(META_ADDRESS_PREFIX.length);
  if (hex.length !== 132) {
    throw new Error(
      `Invalid stealth meta-address length. Expected 132 hex chars, got ${hex.length}`,
    );
  }

  const spendingPubKey = `0x${hex.slice(0, 66)}` as HexString;
  const viewingPubKey = `0x${hex.slice(66)}` as HexString;

  secp256k1.ProjectivePoint.fromHex(toBytes(spendingPubKey));
  secp256k1.ProjectivePoint.fromHex(toBytes(viewingPubKey));

  return { spendingPubKey, viewingPubKey };
}

export function signNameRegistration(
  name: string,
  metaAddressBytes: HexString,
  spendingKey: HexString,
): HexString {
  const digest = keccak256(encodePacked(['string', 'bytes'], [name, metaAddressBytes]));
  const prefixed = keccak256(
    encodePacked(['string', 'bytes32'], ['\x19Ethereum Signed Message:\n32', digest]),
  );

  const sig = secp256k1.sign(toBytes(prefixed), toBytes(spendingKey).slice(0, 32));
  const r = sig.r.toString(16).padStart(64, '0');
  const s = sig.s.toString(16).padStart(64, '0');
  const v = sig.recovery === 0 ? '1b' : '1c';
  return `0x${r}${s}${v}` as HexString;
}

export function metaAddressToBytes(metaAddress: string): HexString {
  if (!metaAddress.startsWith('st:eth:0x')) {
    throw new Error('Invalid meta-address format');
  }
  return `0x${metaAddress.slice('st:eth:0x'.length)}` as HexString;
}
