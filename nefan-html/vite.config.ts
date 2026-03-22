import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "../../nefan-core": resolve(__dirname, "../nefan-core"),
      "../../godot": resolve(__dirname, "../godot"),
    },
  },
  server: {
    port: 3000,
  },
});
