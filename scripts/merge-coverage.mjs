import { access, copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = process.cwd();
const appsDirectory = resolve(root, "apps");
const stagingDirectory = resolve(root, "coverage/blob-merged");
const entries = await readdir(appsDirectory, { withFileTypes: true });
const blobs = [];

for (const entry of entries) {
  if (!entry.isDirectory()) {
    continue;
  }

  const source = join(
    appsDirectory,
    entry.name,
    "coverage",
    "blob",
    "report.json"
  );

  try {
    await access(source);
  } catch {
    throw new Error(`Missing blob report: ${source}`);
  }

  blobs.push({ name: entry.name, source });
}

if (blobs.length === 0) {
  throw new Error("No blob reports found");
}

await rm(stagingDirectory, { force: true, recursive: true });
await mkdir(stagingDirectory, { recursive: true });

await Promise.all(
  blobs.map(({ name, source }) =>
    copyFile(source, join(stagingDirectory, `${name}.json`))
  )
);

process.stdout.write(
  `Staged ${blobs.length} blob reports in ${stagingDirectory}\n`
);
