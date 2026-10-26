import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

test('React app server-render smoke test shows the default RTL project dashboard', async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem() {} }
  });
  let server;
  try {
    server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
    const { default: App } = await server.ssrLoadModule('/src/App.jsx');
    const html = renderToString(React.createElement(App));
    assert.match(html, /dir="rtl"/);
    assert.match(html, /نمای کلی پروژه/);
    assert.match(html, /پروژه نمونه/);
    assert.match(html, /لیست برش/);
  } finally {
    try {
      if (server) await server.close();
    } finally {
      if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
      else delete globalThis.localStorage;
    }
  }
});
