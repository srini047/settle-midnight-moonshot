import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist', 'mammoth'],
  // Next.js configuration
  // Note: Use port 3001 (via npm scripts) to avoid conflict with SpacetimeDB on port 3000
};

export default nextConfig;
