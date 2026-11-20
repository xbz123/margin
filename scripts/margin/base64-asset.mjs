// "import data from './file.ttf?base64'" gives the file's bytes as a base64 string, in a module of
// its own. The renderer loads the PDF export font this way: the app runs from file://, where
// fetch() of a bundled asset is not available, and a dynamically imported module is split into
// its own chunk, loaded only when it is first imported.
import fs from 'node:fs';
import path from 'node:path';

export const BASE64_QUERY = '?base64';

/** The module source for a file imported with ?base64. */
export function base64AssetModule(file) {
  return `export default ${JSON.stringify(fs.readFileSync(file).toString('base64'))};\n`;
}

/** Vite plugin: loads "<path>?base64" imports. */
export function viteBase64Assets() {
  return {
    name: 'margin-base64-asset',
    enforce: 'pre',
    load(id) {
      if (!id.endsWith(BASE64_QUERY)) return null;
      const file = id.slice(0, -BASE64_QUERY.length);
      this.addWatchFile(file);
      return base64AssetModule(file);
    },
  };
}

/** esbuild plugin: loads "<path>?base64" imports the same way, for scripts and tests that bundle the renderer. */
export function esbuildBase64Assets() {
  return {
    name: 'margin-base64-asset',
    setup(b) {
      b.onResolve({ filter: /\?base64$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -BASE64_QUERY.length)), namespace: 'base64' }));
      b.onLoad({ filter: /.*/, namespace: 'base64' }, args => ({ contents: base64AssetModule(args.path), loader: 'js' }));
    },
  };
}
