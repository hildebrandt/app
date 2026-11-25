/**
 * Package manifest shape used by the pnpm hook.
 * @typedef {object} PackageManifest
 * @property {string} [name] Package name.
 * @property {Record<string, string>} [peerDependencies] Peer dependency ranges.
 * @property {Record<string, string>} [dependencies] Direct dependency ranges.
 */

/**
 * Removes the TypeScript peer from the Stryker checker and pins its compiler API.
 * @param {PackageManifest} pkg Package manifest to adjust.
 * @returns {PackageManifest} Adjusted package manifest.
 */
const readPackage = (pkg) => {
  if (pkg.name === "@stryker-mutator/typescript-checker") {
    if (pkg.peerDependencies?.typescript !== undefined) {
      delete pkg.peerDependencies.typescript;
    }

    pkg.dependencies = { ...pkg.dependencies, typescript: "6.0.3" };
  }

  return pkg;
};

export const hooks = { readPackage };
