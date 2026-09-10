import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // @ai/core ships TypeScript source, not a build step (see its package.json
  // exports: "." -> "./src/index.ts"). tsc resolves the package's internal
  // ".js"-suffixed relative imports (NodeNext-style ESM specifiers) straight
  // to their ".ts" files, but webpack's default resolver does not — it needs
  // extensionAlias told explicitly, or every deep import inside @ai/core
  // fails at build time even though `tsc --noEmit` is clean.
  transpilePackages: ["@ai/core"],
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return webpackConfig;
  },
};

export default config;
