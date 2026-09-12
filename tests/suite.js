// The assertions on the command line, and a check that every module loads.
//
// `tests.html` runs the same assertions in a browser; this is for a terminal,
// and for whatever runs one. No dependencies: the stub is a file next door and
// everything else is node's own.

import { install } from "./dom-stub.js";

install();

// Importing each module is the syntax check: a parse error, a bad import
// specifier or a throw at module scope all show up here rather than as a
// blank page. app.js is not among them — it boots the drill, which is what
// tests/smoke.js is for.
const modules = [
  "notes.js",
  "scheduler.js",
  "staff.js",
  "storage.js",
  "history.js",
  "audio.js",
  "midi.js",
];
for (const name of modules) {
  try {
    await import(`../${name}`);
  } catch (err) {
    console.log(`FAIL ${name} does not load  — ${err.message}`);
    process.exit(1);
  }
}

const { run } = await import("./assertions.js");

const failures = [];
const { passed, failed } = run((name, ok, detail) => {
  if (!ok) failures.push(detail ? `${name}  — ${detail}` : name);
});

for (const line of failures) console.log(`FAIL ${line}`);
console.log(`${modules.length} modules load, ${passed} assertions passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
