// Runs one of the Node build steps, if Node and its packages are there.
//
//   pre-render: scripts/node-step.ts covers.mjs
//
// Quarto runs a .ts script with its own Deno, so this needs no Node to
// start. The GitHub workflow installs Node and runs npm ci, so there each
// step runs. A render with no Node or no node_modules, such as Posit
// Connect Cloud or a fresh clone, skips the step with a warning instead of
// failing. The site then renders without the generated images: the share
// covers and the PNG hero of the feed.

const script = Deno.args[0];
if (!script) {
  console.error("node-step.ts: name a script in scripts/, such as covers.mjs.");
  Deno.exit(1);
}

const skip = (why: string) => {
  console.warn(`WARNING: skipped scripts/${script}: ${why}. Run npm ci to make the generated images.`);
  Deno.exit(0);
};

try {
  Deno.statSync("node_modules");
} catch {
  skip("node_modules is missing");
}

let status;
try {
  status = await new Deno.Command("node", { args: [`scripts/${script}`], stdout: "inherit", stderr: "inherit" }).output();
} catch {
  skip("Node is not installed");
}
// A step that starts and then fails is a real error: stop the render.
Deno.exit(status!.code);
