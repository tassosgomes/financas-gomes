import { createHash } from "node:crypto";

import type {
  CsvImportCandidate,
  CsvImportFingerprintCandidate,
} from "./contracts";

const NULL_FIELD_LENGTH = 0xffffffff;
const FIELD_LENGTH_BYTES = 4;
const textEncoder = new TextEncoder();

function encodeLength(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0 || length >= NULL_FIELD_LENGTH) {
    throw new RangeError("CSV fingerprint field is too large");
  }

  const output = new Uint8Array(FIELD_LENGTH_BYTES);
  new DataView(output.buffer).setUint32(0, length, false);
  return output;
}

function encodeField(value: string | null): Uint8Array {
  if (value === null) {
    // The reserved all-ones length is an explicit null marker. It cannot be
    // confused with an empty (non-null) field and still prefixes every field
    // with a byte length as required by ADR-005.
    return new Uint8Array([
      (NULL_FIELD_LENGTH >>> 24) & 0xff,
      (NULL_FIELD_LENGTH >>> 16) & 0xff,
      (NULL_FIELD_LENGTH >>> 8) & 0xff,
      NULL_FIELD_LENGTH & 0xff,
    ]);
  }

  const bytes = textEncoder.encode(value);
  return concatBytes(encodeLength(bytes.byteLength), bytes);
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function encodeCandidate(candidate: CsvImportFingerprintCandidate): Uint8Array {
  return concatBytes(
    encodeField(candidate.occurredOn),
    encodeField(candidate.description),
    encodeField(candidate.signedAmountCents),
    encodeField(candidate.externalId),
  );
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return left.byteLength - right.byteLength;
}

function toFingerprintCandidate(
  candidate: CsvImportCandidate | CsvImportFingerprintCandidate,
): CsvImportFingerprintCandidate {
  return {
    occurredOn: candidate.occurredOn,
    description: candidate.description,
    signedAmountCents: candidate.signedAmountCents,
    externalId: candidate.externalId,
  };
}

/**
 * Builds the canonical byte stream for the valid-line multiset.
 *
 * Records are sorted by their framed byte representation. Equal records are
 * intentionally retained, so duplicate legitimate lines affect the digest.
 */
export function buildCsvImportCanonicalBytes(
  candidates: readonly (
    | CsvImportCandidate
    | CsvImportFingerprintCandidate
  )[],
): Uint8Array {
  const records = candidates
    .map(toFingerprintCandidate)
    .map(encodeCandidate)
    .sort(compareBytes);

  return concatBytes(...records);
}

/** Hex representation useful for staging/audit diagnostics without raw CSV. */
export function buildCsvImportCanonicalInput(
  candidates: readonly (
    | CsvImportCandidate
    | CsvImportFingerprintCandidate
  )[],
): string {
  return Buffer.from(buildCsvImportCanonicalBytes(candidates)).toString("hex");
}

/**
 * SHA-256 fingerprint of the normalized candidate multiset, in lowercase hex.
 * No source filename, BOM, newline style, invalid line, or raw CSV byte is
 * included in this digest.
 */
export function fingerprintCsvImport(
  candidates: readonly (
    | CsvImportCandidate
    | CsvImportFingerprintCandidate
  )[],
): string {
  return createHash("sha256")
    .update(Buffer.from(buildCsvImportCanonicalBytes(candidates)))
    .digest("hex");
}

export const computeCsvImportFingerprint = fingerprintCsvImport;
export const csvImportFingerprint = fingerprintCsvImport;
export const canonicalCsvImportInput = buildCsvImportCanonicalInput;

