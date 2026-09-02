import type { NextConfig } from "next";

const config: NextConfig = {
  // LadybugDB ships a native binary. Next must require it at runtime rather
  // than trying to bundle it into the server build.
  serverExternalPackages: ["@ladybugdb/core"],
};

export default config;
