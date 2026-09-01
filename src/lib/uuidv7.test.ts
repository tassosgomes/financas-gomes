import { describe, expect, it } from "vitest";

import {
  generateUuidV7,
  getUuidV7Timestamp,
  isUuidV7,
} from "@/lib/uuidv7";

describe("UUIDv7 domain ID generator", () => {
  it("generates RFC 9562 UUIDv7 values", () => {
    const id = generateUuidV7();

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(isUuidV7(id)).toBe(true);
  });

  it("generates unique IDs without persistence", () => {
    const ids = Array.from({ length: 1_000 }, () => generateUuidV7());

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps generated IDs lexicographically ordered", () => {
    const first = generateUuidV7();
    const second = generateUuidV7();

    expect(getUuidV7Timestamp(second)).toBeGreaterThanOrEqual(
      getUuidV7Timestamp(first),
    );
    expect(second > first).toBe(true);
  });

  it("encodes the current timestamp before an INSERT can run", () => {
    const before = Date.now();
    const id = generateUuidV7();
    const after = Date.now();

    expect(getUuidV7Timestamp(id)).toBeGreaterThanOrEqual(before);
    expect(getUuidV7Timestamp(id)).toBeLessThanOrEqual(after);
  });

  it("rejects malformed or non-v7 UUIDs", () => {
    expect(isUuidV7("not-an-id")).toBe(false);
    expect(isUuidV7("00000000-0000-4000-8000-000000000000")).toBe(false);
    expect(() => getUuidV7Timestamp("not-an-id")).toThrow("Invalid UUIDv7");
  });
});

