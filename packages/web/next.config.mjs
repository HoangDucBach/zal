/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // The dev indicator sits bottom-left, over the canvas tool bar.
  devIndicators: false,
  turbopack: {
    // The sandbox engine (tevm) imports `fs` for an option it never uses in the browser.
    resolveAlias: { fs: { browser: "./lib/sandbox/fs-browser-stub.ts" } },
  },
};

export default nextConfig;
