/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(process.env.DESKTOP_EXPORT === "1"
    ? {
        output: "export",
        images: {
          unoptimized: true,
        },
      }
    : {}),
  outputFileTracingRoot: process.cwd(),
  env: {
    NEXT_PUBLIC_KAKAO_MAP_API_KEY:
      process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY ?? process.env.KAKAO_API_KEY ?? "",
    NEXT_PUBLIC_TOURMAP_API_BASE_URL: process.env.NEXT_PUBLIC_TOURMAP_API_BASE_URL ?? "",
  },
};

export default nextConfig;
