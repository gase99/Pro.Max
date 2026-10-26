const { app, BrowserWindow, session, shell } = require('electron');
const path = require('node:path');

const APP_ID = 'com.promax.cabinetstudio';
const devServerUrl = process.env.VITE_DEV_SERVER_URL || '';
const isDev = devServerUrl.length > 0;

function isExternalUrlAllowed(rawUrl) {
  try {
    const { protocol } = new URL(rawUrl);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function isAllowedDevNavigation(rawUrl) {
  if (!isDev) return false;
  try {
    return new URL(rawUrl).origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}

function openExternalIfAllowed(rawUrl) {
  if (isExternalUrlAllowed(rawUrl)) {
    shell.openExternal(rawUrl).catch(() => {});
  }
}

// Central navigation/window policy for every web contents the app creates.
function hardenWebContents(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    openExternalIfAllowed(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (isAllowedDevNavigation(url)) return;
    event.preventDefault();
    openExternalIfAllowed(url);
  });

  contents.on('will-redirect', (event, url) => {
    if (isAllowedDevNavigation(url)) return;
    event.preventDefault();
    openExternalIfAllowed(url);
  });

  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#f4f6f8',
    autoHideMenuBar: true,
    title: 'Pro.Max — کابینت استودیو',
    webPreferences: {
      // The renderer is a plain local app: no Node.js, no IPC surface.
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      devTools: isDev
    }
  });

  if (isDev) {
    window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

  // Excel import/export, printing and storage are all local: every renderer
  // permission request (camera, microphone, geolocation, notifications…) is denied.
  const appSession = session.defaultSession;
  appSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  if (typeof appSession.setPermissionCheckHandler === 'function') {
    appSession.setPermissionCheckHandler(() => false);
  }

  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
