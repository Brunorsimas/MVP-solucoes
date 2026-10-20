import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Declare your Neon services here
  auth: true,
  functions: {
    hello: { name: "MVP Soluções API", source: "./functions/mvpapi.mjs", env: {
      APP_ORIGINS: "https://stellar-tiramisu-56e571.netlify.app,http://localhost:4189,http://127.0.0.1:4189",
      ...(process.env.PILOT_TIME ? { PILOT_TIME: process.env.PILOT_TIME } : {}),
    } },
  },
  triggers: {
    "mvp-retention": { type: "schedule", function: "hello", functionPath: "/internal/retention", cron: "0 * * * *" },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
