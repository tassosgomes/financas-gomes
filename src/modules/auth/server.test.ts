import { describe, expect, it } from "vitest";

import {
  AuthGuardError,
  toServerAuthSession,
} from "./server";

const validSession = {
  session: {
    id: "session-id",
    userId: "user-id",
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
    updatedAt: new Date("2026-08-29T00:00:00.000Z"),
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    token: "opaque-session-token",
  },
  user: {
    id: "user-id",
    email: "person@example.test",
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
    updatedAt: new Date("2026-08-29T00:00:00.000Z"),
    emailVerified: true,
    name: "Person",
    image: null,
  },
} as const;

describe("server authentication contract", () => {
  it("normalizes an authenticated Better Auth session", () => {
    expect(
      toServerAuthSession(
        validSession,
        new Date("2026-08-29T00:00:00.000Z"),
      ),
    ).toEqual({
      id: "session-id",
      userId: "user-id",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      user: {
        id: "user-id",
        email: "person@example.test",
        name: "Person",
        image: null,
      },
    });
  });

  it("rejects an absent session with a safe expected error", () => {
    expect(() => toServerAuthSession(null)).toThrowError(AuthGuardError);
    try {
      toServerAuthSession(null);
    } catch (error) {
      expect(error).toMatchObject({
        code: "UNAUTHENTICATED",
        status: 401,
        expected: true,
      });
    }
  });

  it("rejects a session whose user and session IDs do not match", () => {
    expect(() =>
      toServerAuthSession({
        ...validSession,
        session: { ...validSession.session, userId: "another-user-id" },
      }),
    ).toThrowError("Sua sessão não é válida");
  });
});
