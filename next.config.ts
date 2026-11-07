import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app is fully dynamic (auth + SQLite); skip static prerender at build time
  staticPageGenerationTimeout: 1,
  // Resolve build dependencies from this checkout, independent of parent lockfiles.
  turbopack: { root: process.cwd() },
  // node:sqlite باید فقط سمت سرور باندل شود
  serverExternalPackages: ["node:sqlite"],
  compress:true,
  async headers(){return [{source:'/fonts/vazirmatn/33.003/:file',headers:[{key:'Cache-Control',value:'public, max-age=31536000, immutable'},{key:'X-Content-Type-Options',value:'nosniff'}]}];},
  experimental: {
    cpus: process.env.NEXT_BUILD_CPUS === "1" ? 1 : undefined,
    // avoid worker processes racing on the SQLite file during build
    workerThreads: false,
  },
  // خروجی self-contained فقط وقتی خواسته شود (داکر/سرور اختصاصی):
  // BUILD_STANDALONE=1 npm run build  →  .next/standalone/server.js
  // SQLite به سرور اختصاصی و فضای پایدار نیاز دارد؛ serverless مجاز نیست.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
};

export default nextConfig;
