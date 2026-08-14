import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/**
 * Keep the development server away from production build artifacts. Running
 * `next build` while `next dev` was active previously left a mixed `.next`
 * tree, so the dev page rendered HTML whose JavaScript chunks returned 404.
 *
 * @param {string} phase
 * @returns {import('next').NextConfig}
 */
const nextConfig = (phase) => ({
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  // Enable standalone output for Docker deployments
  // (only active when building for production)
  output: process.env.DOCKER_BUILD ? "standalone" : undefined,
});

export default nextConfig;
