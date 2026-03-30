// electron.vite.config.ts
import { resolve } from "node:path";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
var __electron_vite_injected_dirname = "/Users/sonwork/Workspace/voice-bridge-desktop/apps/studio";
function copyMainAssets() {
  return {
    name: "copy-main-assets",
    closeBundle() {
      const outDir = resolve(__electron_vite_injected_dirname, "dist/main");
      mkdirSync(outDir, { recursive: true });
      const lspSrc = resolve(__electron_vite_injected_dirname, "../../packages/pi-coding-agent/src/core/lsp");
      for (const file of readdirSync(lspSrc)) {
        if (file.endsWith(".json") || file.endsWith(".md")) {
          copyFileSync(resolve(lspSrc, file), resolve(outDir, file));
        }
      }
    }
  };
}
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [copyMainAssets()],
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: {
          index: resolve(__electron_vite_injected_dirname, "src/main/index.ts")
        }
      }
    }
  },
  preload: {
    build: {
      outDir: "dist/preload",
      lib: {
        entry: resolve(__electron_vite_injected_dirname, "src/preload/index.ts"),
        formats: ["cjs"],
        fileName: () => "index.js"
      },
      rollupOptions: {
        external: ["electron"]
      }
    }
  },
  renderer: {
    root: resolve(__electron_vite_injected_dirname, "src/renderer"),
    resolve: {
      alias: {
        "@": resolve(__electron_vite_injected_dirname, "src/renderer/src")
      }
    },
    plugins: [tailwindcss(), react()],
    build: {
      outDir: resolve(__electron_vite_injected_dirname, "dist/renderer")
    }
  }
});
export {
  electron_vite_config_default as default
};
