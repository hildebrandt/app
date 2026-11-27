import { access, copyFile, glob, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const appsDirectory = path.resolve(root, "apps");
const stagingDirectory = path.resolve(root, "coverage/blob-merged");
const manifests = glob("*/package.json", { cwd: appsDirectory });
const blobs = [];

for await (const manifest of manifests) {
  const name = path.dirname(manifest);
  const source = path.join(appsDirectory, name, "coverage", "blob", "report.json");

  try {
    await access(source);
  } catch {
    throw new Error(`Missing blob report: ${source}`);
  }

  blobs.push({ name, source });
}

if (blobs.length === 0) {
  throw new Error("No blob reports found");
}

await rm(stagingDirectory, { force: true, recursive: true });

await mkdir(stagingDirectory, { recursive: true });

await Promise.all(
  blobs.map(async ({ name, source }) =>
    copyFile(source, path.join(stagingDirectory, `${name}.json`))
  )
);

process.stdout.write(
  `Staged ${blobs.length} blob reports in ${stagingDirectory}\n`
);
