import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 是原生模块；pi 系列含 Turbopack 无法打包的动态 require，
  // 统一走 serverExternalPackages（Node 运行时原生加载）
  serverExternalPackages: [
    'better-sqlite3',
    '@earendil-works/pi-agent-core',
    '@earendil-works/pi-coding-agent',
    '@earendil-works/pi-ai',
  ],
};

export default nextConfig;
