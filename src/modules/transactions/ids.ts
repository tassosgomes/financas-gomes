/**
 * S03 has no local identifier strategy. These helpers deliberately delegate
 * to S01's UUIDv7 implementation for resource IDs and retry-safe command IDs.
 */
export {
  generateUuidV7,
  getUuidV7Timestamp,
  isUuidV7,
  uuidV7Timestamp,
} from "@/lib/uuidv7";
export type { UuidV7 } from "@/lib/uuidv7";

export {
  generateUuidV7 as generateTransactionId,
  generateUuidV7 as generateTransactionCommandId,
  generateUuidV7 as generateCommandId,
} from "@/lib/uuidv7";

