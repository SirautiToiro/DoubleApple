import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  //HTMLとして出力（サーバーが要らない）
  output: 'export',
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
