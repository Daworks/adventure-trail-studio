/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  env: {
    NEXT_PUBLIC_KAKAO_MAP_API_KEY:
      process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY ?? process.env.KAKAO_API_KEY ?? "",
  },
};

export default nextConfig;
