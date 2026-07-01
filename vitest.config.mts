import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
	test: {
		environment: "jsdom",
		setupFiles: ["./tests/setup.ts"],
		include: ["tests/**/*.test.ts"],
	},
	resolve: {
		alias: {
			// `obsidian` is provided by the app at runtime; tests use a light mock.
			obsidian: fileURLToPath(new URL("./tests/mocks/obsidian.ts", import.meta.url)),
		},
	},
});
