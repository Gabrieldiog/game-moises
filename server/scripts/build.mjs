// Production build: bundles server/src/main.ts into dist/main.js with esbuild.
// Workspace packages (@moises/*) export TypeScript sources, so they are bundled
// in. Every other package (socket.io, zod, ...) stays external and is loaded
// from node_modules at runtime (npm ci --omit=dev). Type checking is a separate
// step (npm run typecheck); esbuild only strips types.
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outdir = `${root}dist`;

/** Bundle workspace packages, keep third-party packages external. */
const externalPackages = {
  name: 'external-packages',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('@moises/')) return undefined;
      return { path: args.path, external: true };
    });
  },
};

await rm(outdir, { recursive: true, force: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/main.ts'],
  outfile: `${outdir}/main.js`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
  plugins: [externalPackages],
});
