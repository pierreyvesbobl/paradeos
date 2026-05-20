import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Tree-shake les imports nommés des libs lourdes (lucide-react =
  // ~600 icônes, sans ça tout le pack est inclus dans chaque chunk).
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns", "@radix-ui/react-icons"],
  },
};

export default config;
