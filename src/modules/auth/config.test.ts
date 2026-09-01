import { describe, expect, it } from "vitest";

import {
  AUTH_GOOGLE_CALLBACK_PATH,
  getGoogleOAuthCallbackURL,
} from "@/modules/auth";

describe("Better Auth runtime configuration", () => {
  it("derives the Google callback from the environment base URL", () => {
    expect(
      getGoogleOAuthCallbackURL(
        "https://preview.financas.example/app/?redirect=ignored#fragment",
      ),
    ).toBe(
      `https://preview.financas.example/app${AUTH_GOOGLE_CALLBACK_PATH}`,
    );
  });

  it("uses the local callback path for a root application URL", () => {
    expect(getGoogleOAuthCallbackURL("http://localhost:3000/")).toBe(
      `http://localhost:3000${AUTH_GOOGLE_CALLBACK_PATH}`,
    );
  });
});
