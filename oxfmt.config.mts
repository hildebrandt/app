// Presets: ultracite/oxfmt (assembled in vite.config.ts).
import viteConfig from "./vite.config.ts";

const { fmt } = viteConfig;

if (!fmt) {
  throw new Error("Missing fmt config in vite.config.ts");
}

export default fmt;
