import { describe, expect, it } from "vitest";

import {
  formatFileSize,
  formatGeneratedAt,
  formatRowCount,
} from "./formatters";

describe("export UI formatters", () => {
  it("formats file sizes with pt-BR decimal comma and binary units", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(12 * 1024)).toBe("12 KB");
    expect(formatFileSize(Math.floor(1.5 * 1024 * 1024))).toBe("1,5 MB");
    expect(formatFileSize(10 * 1024 * 1024)).toBe("10 MB");
    expect(formatFileSize(-1)).toBe("—");
    expect(formatFileSize(Number.NaN)).toBe("—");
  });

  it("formats row counts with Portuguese pluralization and grouping", () => {
    expect(formatRowCount(0)).toBe("0 linhas");
    expect(formatRowCount(1)).toBe("1 linha");
    expect(formatRowCount(12)).toBe("12 linhas");
    expect(formatRowCount(12_345)).toBe("12.345 linhas");
    expect(formatRowCount(-1)).toBe("—");
    expect(formatRowCount(1.5)).toBe("—");
  });

  it("formats UTC instants without local timezone drift", () => {
    expect(formatGeneratedAt("2026-09-03T14:30:00.000Z")).toBe(
      "03/09/2026, 14:30",
    );
    expect(formatGeneratedAt("not-an-instant")).toBe("not-an-instant");
  });
});
