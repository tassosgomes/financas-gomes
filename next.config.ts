import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextDistDir = process.env.NEXT_DIST_DIR?.trim() || ".next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Keep concurrent local E2E and development servers from racing on the
  // same webpack/dev manifest and cache files.
  distDir: nextDistDir,
};

export default withSentryConfig(nextConfig, {
  // Runtime initialization remains gated by the DSN. Keep tracing in the
  // bundle; the runtime sanitizer controls what reaches Sentry.
  silent: true,
  sourcemaps: { disable: true },
  webpack: {
    treeshake: {
      removeTracing: false,
      removeDebugLogging: true,
    },
  },
});
