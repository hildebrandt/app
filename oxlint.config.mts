import viteConfig from "./vite.config.ts";

const { lint } = viteConfig;

if (!lint) {
  throw new Error("Missing lint config in vite.config.ts");
}

export default lint;
