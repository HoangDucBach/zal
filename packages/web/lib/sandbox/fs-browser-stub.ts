// @tevm/node imports `fs` only for a checkpoint file the sandbox never configures. The browser build aliases `fs`
// here (next.config.mjs), so the import resolves and any use fails loudly.

const unavailable = (): never => {
  throw new Error("The file system is not available in the browser sandbox.");
};

export const existsSync = unavailable;
export const readFileSync = unavailable;
