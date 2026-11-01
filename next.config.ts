import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Isolate the fixture server from an existing development server. */
  distDir: process.env.NEIRO_E2E === "1" ? ".next-e2e" : ".next",
  cacheComponents: true,
  partialPrefetching: true,
  // laya-ts loads a native ONNX runtime; keep both out of the server bundle.
  serverExternalPackages: ["laya-ts", "onnxruntime-node"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
