import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("test"),
  },
  test: {
    globals: true,
    environment: "jsdom",
    testTimeout: 10000,
    include: ["src/tests/**/*.test.{ts,tsx}"],
    reporters: ["verbose"],
    server: {
      deps: {
        inline: ["react", "react-dom", "@testing-library/react", "@testing-library/user-event"],
      },
    },
  },
});
