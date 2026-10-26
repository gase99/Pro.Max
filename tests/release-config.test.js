import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import viteConfig from '../vite.config.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const workflow = readFileSync(new URL('../.github/workflows/build-win.yml', import.meta.url), 'utf8');

test('desktop scripts and NSIS x64 installer configuration are present', () => {
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.match(packageJson.scripts.start, /npm run build.*electron/);
  assert.match(packageJson.scripts.dist, /npm run build.*electron-builder/);
  assert.match(packageJson.scripts['dist:win'], /npm run build.*--win nsis.*--publish never/);
  // The merged runner must keep both feature suites: the Excel/engine node
  // tests, the TypeScript cut-optimizer tests and the Excel round-trip tests.
  assert.match(packageJson.scripts.test, /typecheck/);
  assert.match(packageJson.scripts.test, /test:node/);
  assert.match(packageJson.scripts.test, /test:optimizer/);
  assert.match(packageJson.scripts.test, /test:import-export/);
  assert.match(packageJson.scripts['test:node'], /node --test/);
  assert.match(packageJson.scripts['test:optimizer'], /vitest run tests\/optimizer\.test\.ts/);
  assert.match(packageJson.scripts['test:optimizer'], /tests\/cutmap\.test\.tsx/);
  // Pricing logic, storage and formatting are part of the same TypeScript suite.
  assert.match(packageJson.scripts['test:optimizer'], /tests\/pricing\.test\.ts/);
  assert.match(packageJson.scripts['test:import-export'], /vitest run tests\/import-export\.test\.js/);
  assert.match(packageJson.scripts.typecheck, /tsc --noEmit/);
  assert.equal(packageJson.devDependencies.vitest, '^4.1.12');

  assert.equal(packageJson.build.appId, 'com.promax.cabinetstudio');
  assert.equal(packageJson.build.productName, 'Pro.Max Cabinet Studio');
  assert.equal(packageJson.build.win.target[0].target, 'nsis');
  assert.ok(packageJson.build.win.target[0].arch.includes('x64'));
  assert.ok(existsSync(new URL(`../${packageJson.build.win.icon}`, import.meta.url)));
});

test('Windows workflow uploads dist/*.exe and supports tagged releases', () => {
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /node-version: '20'/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run dist:win/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /path: dist\/\*\.exe/);
  assert.match(workflow, /tags:\s*\n\s+- 'v\*'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /softprops\/action-gh-release@v2/);
});

test('production CSP is build-only, local-only and excludes unsafe-eval', () => {
  const plugin = viteConfig.plugins.find((item) => item.name === 'promax-content-security-policy');
  assert.ok(plugin);
  assert.equal(plugin.apply, 'build');
  const transformed = plugin.transformIndexHtml('<html><head></head><body></body></html>');
  const csp = transformed.tags.find((tag) => tag.attrs?.['http-equiv'] === 'Content-Security-Policy')?.attrs?.content;
  assert.ok(csp);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self' file:/);
  assert.doesNotMatch(csp, /unsafe-eval|https:/);
});
