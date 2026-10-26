import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');

test('Electron renderer keeps Node access disabled and runs sandboxed', () => {
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.match(mainSource, /nodeIntegrationInWorker:\s*false/);
  assert.match(mainSource, /nodeIntegrationInSubFrames:\s*false/);
  assert.match(mainSource, /sandbox:\s*true/);
  assert.match(mainSource, /webSecurity:\s*true/);
  assert.match(mainSource, /allowRunningInsecureContent:\s*false/);
  assert.match(mainSource, /webviewTag:\s*false/);
  assert.match(mainSource, /devTools:\s*isDev/);
  assert.doesNotMatch(mainSource, /\bpreload\s*:/);
});

test('Electron restricts navigation, redirects, windows, and permissions', () => {
  assert.match(mainSource, /new URL\(rawUrl\)\.origin === new URL\(devServerUrl\)\.origin/);
  assert.match(mainSource, /contents\.on\('will-navigate'/);
  assert.match(mainSource, /contents\.on\('will-redirect'/);
  assert.match(mainSource, /contents\.setWindowOpenHandler/);
  assert.match(mainSource, /contents\.on\('will-attach-webview'/);
  assert.match(mainSource, /setPermissionRequestHandler\([^\n]*callback\(false\)/);
  assert.match(mainSource, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.doesNotMatch(mainSource, /\b(?:ipcMain|ipcRenderer|contextBridge)\b/);
});
