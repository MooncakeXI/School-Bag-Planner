import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // next dev blocks cross-origin requests to /_next/* (JS chunks, HMR) by
  // default since Next 15.3 — needed to test on a phone via ngrok, whose
  // random subdomain changes every restart on the free tier.
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app", "*.ngrok.io"],
};

export default nextConfig;
