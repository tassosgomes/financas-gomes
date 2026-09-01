import { describe, expect, it } from "vitest";

import {
  getPublicAuthErrorFromSearchParams,
  toPublicAuthError,
} from "@/modules/auth/public-auth";

function params(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values);
}

describe("public authentication error mapping", () => {
  it("does not expose provider descriptions from callback URLs", () => {
    const error = getPublicAuthErrorFromSearchParams(
      params({
        error: "server_error",
        error_description: "access_token=do-not-display",
      }),
    );

    expect(error).toEqual({
      kind: "request",
      message:
        "Não foi possível concluir a autenticação. Tente novamente em instantes.",
    });
    expect(error?.message).not.toContain("do-not-display");
  });

  it("distinguishes cancellation from callback failures", () => {
    expect(
      getPublicAuthErrorFromSearchParams(params({ error: "access_denied" })),
    ).toMatchObject({ kind: "cancelled" });
    expect(
      getPublicAuthErrorFromSearchParams(
        params({ error: "state_mismatch" }),
      ),
    ).toMatchObject({ kind: "callback" });
  });

  it("only treats unauthorized responses as expired in session context", () => {
    expect(toPublicAuthError({ status: 401 })).toMatchObject({
      kind: "request",
    });
    expect(toPublicAuthError({ status: 401 }, { sessionError: true })).toMatchObject({
      kind: "session-expired",
    });
  });
});
