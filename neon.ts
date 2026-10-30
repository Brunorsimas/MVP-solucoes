import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Declare your Neon services here
  auth: true,
  functions: {
    hello: { name: "MVP Soluções API", source: "./functions/mvpapi.mjs", env: {
      // Published site plus the local previews: 4189 is `npm start` in Neon mode
      // and 4180 serves dist/ directly. Any other origin is rejected with 403.
      APP_ORIGINS: "https://mpv-solucoes.netlify.app,http://localhost:4189,http://127.0.0.1:4189,http://localhost:4180,http://127.0.0.1:4180",
      // Demonstration accounts, disabled in production: the shared password `123`
      // would let anyone read other people's tickets, messages and attachments.
      // Set to "1" and redeploy only on a test branch, never on production.
      TEST_LOGIN_ENABLED: "0",
      // Server-only direct connection for LISTEN, never included in the browser.
      ...(process.env.DATABASE_URL_UNPOOLED ? { LIVE_DATABASE_URL: process.env.DATABASE_URL_UNPOOLED } : {}),
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
