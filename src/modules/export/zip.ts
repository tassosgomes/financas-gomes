import { deflateRawSync, inflateRawSync } from "node:zlib";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const COMPRESSION_DEFLATE = 8;
const VERSION_NEEDED = 20;

/** One archive entry with a stable, user-data-free file name. */
export interface ZipEntry {
  readonly name: string;
  readonly data: Buffer;
}

/** CRC-32 (IEEE) for ZIP local/central headers. */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index]!;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUInt16LE(buffer: Buffer, offset: number, value: number): void {
  buffer.writeUInt16LE(value, offset);
}

function writeUInt32LE(buffer: Buffer, offset: number, value: number): void {
  buffer.writeUInt32LE(value, offset);
}

interface PreparedEntry {
  readonly name: string;
  readonly nameBytes: Buffer;
  readonly uncompressed: Buffer;
  readonly compressed: Buffer;
  readonly crc: number;
}

function prepareEntry(entry: ZipEntry): PreparedEntry {
  const nameBytes = Buffer.from(entry.name, "utf8");
  const uncompressed = entry.data;
  const compressed = deflateRawSync(uncompressed);
  return {
    name: entry.name,
    nameBytes,
    uncompressed,
    compressed,
    crc: crc32(uncompressed),
  };
}

/**
 * Builds a minimal ZIP archive with DEFLATE compression.
 * Entries are stored in the order supplied by the caller (deterministic when
 * the caller sorts names). No timestamps or extra fields are written.
 */
export function createZipArchive(entries: readonly ZipEntry[]): Buffer {
  if (entries.length === 0) {
    throw new RangeError("ZIP archive requires at least one entry");
  }

  const prepared = entries.map(prepareEntry);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of prepared) {
    const localHeader = Buffer.alloc(30);
    writeUInt32LE(localHeader, 0, LOCAL_FILE_HEADER_SIGNATURE);
    writeUInt16LE(localHeader, 4, VERSION_NEEDED);
    writeUInt16LE(localHeader, 6, 0);
    writeUInt16LE(localHeader, 8, COMPRESSION_DEFLATE);
    writeUInt16LE(localHeader, 10, 0);
    writeUInt16LE(localHeader, 12, 0);
    writeUInt32LE(localHeader, 14, entry.crc);
    writeUInt32LE(localHeader, 18, entry.compressed.length);
    writeUInt32LE(localHeader, 22, entry.uncompressed.length);
    writeUInt16LE(localHeader, 26, entry.nameBytes.length);
    writeUInt16LE(localHeader, 28, 0);

    localParts.push(localHeader, entry.nameBytes, entry.compressed);

    const centralHeader = Buffer.alloc(46);
    writeUInt32LE(centralHeader, 0, CENTRAL_DIRECTORY_SIGNATURE);
    writeUInt16LE(centralHeader, 4, VERSION_NEEDED);
    writeUInt16LE(centralHeader, 6, VERSION_NEEDED);
    writeUInt16LE(centralHeader, 8, 0);
    writeUInt16LE(centralHeader, 10, COMPRESSION_DEFLATE);
    writeUInt16LE(centralHeader, 12, 0);
    writeUInt16LE(centralHeader, 14, 0);
    writeUInt32LE(centralHeader, 16, entry.crc);
    writeUInt32LE(centralHeader, 20, entry.compressed.length);
    writeUInt32LE(centralHeader, 24, entry.uncompressed.length);
    writeUInt16LE(centralHeader, 28, entry.nameBytes.length);
    writeUInt16LE(centralHeader, 30, 0);
    writeUInt16LE(centralHeader, 32, 0);
    writeUInt16LE(centralHeader, 34, 0);
    writeUInt16LE(centralHeader, 36, 0);
    writeUInt16LE(centralHeader, 38, 0);
    writeUInt32LE(centralHeader, 42, offset);

    centralParts.push(centralHeader, entry.nameBytes);

    offset += localHeader.length + entry.nameBytes.length + entry.compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  writeUInt32LE(endRecord, 0, END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  writeUInt16LE(endRecord, 4, 0);
  writeUInt16LE(endRecord, 6, 0);
  writeUInt16LE(endRecord, 8, prepared.length);
  writeUInt16LE(endRecord, 10, prepared.length);
  writeUInt32LE(endRecord, 12, centralDirectory.length);
  writeUInt32LE(endRecord, 16, offset);
  writeUInt16LE(endRecord, 20, 0);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

/** Reads one entry body as UTF-8 text from a ZIP built by `createZipArchive`. */
export function readZipEntryText(zip: Buffer, entryName: string): string {
  const endOffset = zip.lastIndexOf(
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  );
  if (endOffset < 0) {
    throw new Error("ZIP end record not found");
  }

  const centralDirectoryOffset = zip.readUInt32LE(endOffset + 16);
  const entryCount = zip.readUInt16LE(endOffset + 10);
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (zip.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("ZIP central directory signature mismatch");
    }

    const compressionMethod = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const localHeaderOffset = zip.readUInt32LE(offset + 42);
    const nameLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 46;
    const name = zip.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    offset += 46 + nameLength + extraLength + commentLength;

    if (name !== entryName) {
      continue;
    }

    if (compressionMethod !== COMPRESSION_DEFLATE) {
      throw new Error(`Unsupported ZIP compression for ${entryName}`);
    }

    const localNameLength = zip.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
    const dataStart =
      localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = zip.subarray(dataStart, dataStart + compressedSize);
    return inflateRawSync(compressed).toString("utf8");
  }

  throw new Error(`ZIP entry not found: ${entryName}`);
}

/** Lists entry names from a ZIP built by `createZipArchive` (tests and fixtures). */
export function listZipEntryNames(zip: Buffer): string[] {
  const endOffset = zip.lastIndexOf(
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  );
  if (endOffset < 0) {
    throw new Error("ZIP end record not found");
  }

  const centralDirectoryOffset = zip.readUInt32LE(endOffset + 16);
  const entryCount = zip.readUInt16LE(endOffset + 10);
  const names: string[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (zip.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("ZIP central directory signature mismatch");
    }
    const nameLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 46;
    names.push(zip.subarray(nameStart, nameStart + nameLength).toString("utf8"));
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return names;
}
