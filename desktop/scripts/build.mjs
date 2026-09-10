import { build } from 'esbuild';
import { mkdir, copyFile, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const fixture = process.argv.includes('--fixture');
const destination = fixture ? 'test-build' : 'dist';
await rm(destination, { recursive: true, force: true });
await mkdir(`${destination}/renderer`, { recursive: true });
// Map outputs, never production imports, for the isolated acceptance build.
const compile = options => build({ ...options, outfile: options.outfile.replace(/^dist\//, `${destination}/`),
  ...(fixture && options.entryPoints.includes('src/main/index.ts') ? { plugins: [{ name: 'synthetic-runtime', setup(build) {
    build.onResolve({ filter: /^\.\/runtime$/ }, args => args.importer.endsWith('/src/main/index.ts') ? { path: fileURLToPath(new URL('../tests/fixtures/runtime.ts', import.meta.url)) } : undefined);
  } }] } : {}) });
const copy = (source, output) => copyFile(source, output.replace(/^dist\//, `${destination}/`));
await Promise.all([
  compile({ entryPoints: ['src/main/index.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], outfile: 'dist/main.cjs' }),
  compile({ entryPoints: ['src/main/mcp.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: 'dist/mcp.cjs' }),
  compile({ entryPoints: ['src/main/preload.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], outfile: 'dist/preload.cjs' }),
  compile({ entryPoints: ['src/capture/preload.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], outfile: 'dist/capture-preload.cjs' }),
  compile({ entryPoints: ['src/capture/index.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'chrome140', outfile: 'dist/renderer/capture.js', minify: true }),
  compile({ entryPoints: ['src/capture/worklet.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'chrome140', outfile: 'dist/renderer/worklet.js', minify: true }),
  compile({ entryPoints: ['src/renderer/companion.tsx'], bundle: true, platform: 'browser', format: 'esm', target: 'chrome140', outfile: 'dist/renderer/companion.js', minify: true, define: { 'process.env.NODE_ENV': '"production"' } }),
  compile({ entryPoints: ['src/renderer/index.tsx'], bundle: true, platform: 'browser', format: 'esm', target: 'chrome140', outfile: 'dist/renderer/app.js', minify: true, define: { 'process.env.NODE_ENV': '"production"' } }),
  copy('src/renderer/index.html', 'dist/renderer/index.html'),
  copy('src/renderer/companion.html', 'dist/renderer/companion.html'),
  copy('src/capture/index.html', 'dist/renderer/capture.html'),
  copy('../LICENSE', 'dist/LICENSE.txt'),
  copy('../macOS/Artwork/Chirpberry.png', 'dist/renderer/chirpberry.png')
]);
const notices = await Promise.all(['react', 'react-dom', 'scheduler', 'lucide-react', 'zod', 'ws'].map(async name => `${name}\n\n${await readFile(`node_modules/${name}/LICENSE`, 'utf8')}`));
await writeFile(`${destination}/THIRD-PARTY-NOTICES.txt`, notices.join('\n\n--------------------\n\n'));

if (fixture) await writeFile(`${destination}/package.json`, JSON.stringify({ name: "chirpberry-fixture", main: "main.cjs", version: "0.2.0" }));
