// Use the installed TypeScript compiler with Node's built-in test runner.
// This hook is confined to test processes; production uses Next.js compilation.
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
    fileName: filename,
  });
  module._compile(result.outputText, filename);
};
