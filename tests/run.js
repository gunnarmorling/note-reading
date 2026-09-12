// Everything, in one command: `node tests/run.js`.
//
// Each suite runs in its own process, so the small stub the assertions use and
// the whole fictional browser the app needs cannot be confused for one
// another — and a crash in one still leaves the other's result readable.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

let bad = 0;
for (const suite of ["suite.js", "smoke.js"]) {
  const { status } = spawnSync(process.execPath, [join(here, suite)], { stdio: "inherit" });
  if (status !== 0) bad += 1;
}

process.exit(bad === 0 ? 0 : 1);
