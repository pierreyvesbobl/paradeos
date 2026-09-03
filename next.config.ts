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
  /**
   * Métadonnées de découverte OAuth (RFC 9728 / RFC 8414). Les clients MCP
   * les cherchent à la racine, sous `/.well-known/…`. On les sert depuis
   * des route handlers classiques plutôt que via un dossier `app/.well-known`
   * — un segment commençant par un point est fragile côté résolution de
   * routes, le rewrite est explicite et testable.
   *
   * Le suffixe `/:path*` couvre la variante « path-inserted » de RFC 9728 :
   * pour une ressource `https://host/api/mcp`, le client interroge
   * `/.well-known/oauth-protected-resource/api/mcp`.
   */
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-protected-resource/:path*",
        destination: "/api/oauth/protected-resource",
      },
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/oauth/protected-resource",
      },
      {
        source: "/.well-known/oauth-authorization-server/:path*",
        destination: "/api/oauth/authorization-server",
      },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/oauth/authorization-server",
      },
    ];
  },
};

export default config;
