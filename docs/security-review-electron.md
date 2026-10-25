# بازبینی امنیتی Electron — Pro.Max Cabinet Studio v0.1.0

تاریخ بازبینی: ۲۰۲۶-۱۰-۲۵ · دامنه: `electron/main.cjs`، `index.html`، `src/**`، `vite.config.js`، `package.json` (بخش build)

## خلاصه‌ی مدیریتی

معماری امنیتی پایه از ابتدا درست انتخاب شده بود: رندرر فقط یک صفحه‌ی محلی است، نه Node.js دارد و نه IPC. هیچ `preload`، `contextBridge`، `ipcMain`/`ipcRenderer`، `@electron/remote`، `eval`، `new Function` یا `dangerouslySetInnerHTML` در کد وجود ندارد. بنابراین سطح حمله بسیار کوچک است.

سه شکاف واقعی وجود داشت و همه در این شاخه بسته شدند:

1. نبود CSP (Content-Security-Policy) روی صفحه‌ی رندرر.
2. نبود محافظت در برابر ناوبری به بیرون (`will-navigate`) و امکان استفاده از `<webview>`/`window.open`.
3. نبود سیاست یکپارچه برای دسترسی‌های رندرر (permissions) و نبود `setAppUserModelId` روی ویندوز.

## پاسخ به پرسش‌های بازبینی

| پرسش | وضعیت قبلی | وضعیت فعلی |
| --- | --- | --- |
| `contextIsolation: true` | ✅ از قبل تنظیم بود | ✅ حفظ شد |
| `nodeIntegration: false` | ✅ از قبل تنظیم بود | ✅ + `nodeIntegrationInWorker` و `nodeIntegrationInSubFrames` صریحاً `false` |
| استفاده از `sandbox` | ✅ `sandbox: true` | ✅ حفظ شد (رندرر بدون preload اجرا می‌شود، پس محدودیتی ایجاد نمی‌کند) |
| IPC محدود با `contextBridge` + allowlist | ✅ هیچ IPC‌ای وجود ندارد (کمترین سطح ممکن) | ✅ همان، به‌علاوه‌ی ممنوعیت `<webview>` (`webviewTag: false`) و مسدودسازی `will-attach-webview` |
| تعریف CSP | ❌ تعریف نشده بود | ✅ تزریق `meta` در build تولیدی از طریق پلاگین Vite |
| `remote` module یا `eval` خطرناک | ✅ هیچ‌کدام استفاده نشده | ✅ هیچ‌کدام؛ `import()` تنها برای chunk محلی `exceljs` است |
| بازکردن لینک خارجی | ⚠️ فقط `setWindowOpenHandler` (بدون محدودسازی ناوبری درون پنجره) | ✅ allowlist پروتکل `http/https` برای هر دو مسیر `window.open` و `will-navigate` |
| دسترسی‌های رندرر (permission) | ⚠️ پیش‌فرض Chromium | ✅ همه‌ی درخواست‌ها و بررسی‌ها با `false` رد می‌شوند |
| `webSecurity` / محتوای ناامن | ⚠️ صریح نبود | ✅ `webSecurity: true` و `allowRunningInsecureContent: false` |
| DevTools در نسخه‌ی نصب‌شده | ⚠️ باز بود | ✅ فقط در حالت `desktop:dev` فعال است (`devTools: isDev`) |

## جزئیات و پچ‌های اعمال‌شده

### ۱) CSP — `vite.config.js`

پلاگین `promax-content-security-policy` فقط روی `apply: 'build'` تزریق می‌شود تا HMR و اسکریپت‌های inline حالت توسعه نشکنند:

```
default-src 'none'; script-src 'self' file:; style-src 'self' 'unsafe-inline' file:;
img-src 'self' data: blob: file:; font-src 'self' data: file:; connect-src 'self' data: blob: file:;
worker-src 'self' blob: file:; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
```

توضیح چند انتخاب:

- `style-src 'unsafe-inline'` لازم است چون React روی بعضی گره‌ها `style` attribute می‌گذارد و CSP3 آن را از `style-src` می‌خواند. اسکریپت هیچ‌گاه `'unsafe-inline'` ندارد.
- `file:` کنار `'self'` آمده چون بسته‌ی نصب‌شده صفحه را با `file://` بارگذاری می‌کند و در بعضی نسخه‌های Chromium مبدأ `file:` با `'self'` یکسان رفتار نمی‌کند.
- `default-src 'none'` باعث می‌شود هر منبع جدیدی که در آینده اضافه شود، به‌صورت پیش‌فرض مسدود باشد.
- `frame-ancestors` عمداً در `meta` نیامده (در `meta` نادیده گرفته می‌شود)؛ جای درست آن هدر HTTP است که در `file://` کاربردی ندارد و چون هیچ محتوای وب خارجی بارگذاری نمی‌شود، خطر framing منتفی است.

بررسی: پس از `npm run build` باید در `dist/index.html` تگ زیر دیده شود:

```bash
grep -o '<meta http-equiv="Content-Security-Policy"[^>]*>' dist/index.html
```

### ۲) سیاست ناوبری و پنجره — `electron/main.cjs`

```js
contents.setWindowOpenHandler(({ url }) => {
  openExternalIfAllowed(url); // فقط http/https
  return { action: 'deny' };
});

contents.on('will-navigate', (event, url) => {
  if (isDev && url.startsWith(devServerUrl)) return; // HMR در حالت توسعه
  event.preventDefault();
  openExternalIfAllowed(url);
});

contents.on('will-attach-webview', (event) => event.preventDefault());
```

پیش از این پچ، اگر کاربر یا محتوای مخدوش‌شده باعث ناوبری درون همان پنجره می‌شد (مثلاً کلیک روی لینک بدون `target=_blank`) صفحه‌ی جدید در بستر Electron باز می‌شد. اکنون همه‌ی ناوبری‌های خارج از اپ در مرورگر سیستم باز می‌شوند و پنجره‌ی اپ هرگز به مبدأ بیرونی نمی‌رود.

### ۳) دسترسی‌ها و شناسه‌ی اپ

```js
appSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
appSession.setPermissionCheckHandler(() => false);
if (process.platform === 'win32') app.setAppUserModelId('com.promax.cabinetstudio');
```

هیچ قابلیت رندرر (دوربین، میکروفن، اعلان، موقعیت، کلیپ‌بورد خواندنی) نیاز نیست؛ رد کردن پیش‌فرض همه‌ی آن‌ها دفاع در عمق است. `setAppUserModelId` هم باعث می‌شود آیکون و نام اپ در Taskbar و اعلان‌های ویندوز درست نمایش داده شود.

### ۴) سایر سخت‌سازی‌ها در `webPreferences`

```js
sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
experimentalFeatures: false, webviewTag: false, devTools: isDev,
nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false
```

### ۵) موارد بررسی‌شده و پاک

- `src/lib/workbook.js`: تنها `import('exceljs')` پویا (chunk محلی) و ساخت `<a download>` برای Blob؛ هیچ `eval`/`Function` ندارد. ورودی اکسل با `ExcelJS` پارس می‌شود و مقادیر عددی با `parseNumber` اعتبارسنجی می‌شوند.
- `index.html`: بدون اسکریپت inline، بدون `onclick` درون‌خطی، بدون منبع CDN.
- `src/App.jsx`: داده‌ی ذخیره‌شده در `localStorage` با `JSON.parse` در `try/catch` خوانده و شکل آن (`Array.isArray(units)`) بررسی می‌شود؛ هیچ HTML خام رندر نمی‌شود.
- `package.json`: هیچ اسکریپت `postinstall` مشکوک یا credential هاردکدشده وجود ندارد.

## ریسک‌های باقی‌مانده و پیشنهادهای بعدی (خارج از دامنه‌ی این پچ)

| ریسک | شدت | پیشنهاد |
| --- | --- | --- |
| نصب‌کننده بدون امضای دیجیتال است (SmartScreen هشدار می‌دهد) | متوسط | خرید گواهی Code Signing (EV یا OV) و فعال‌سازی در workflow با `CSC_LINK`/`CSC_KEY_PASSWORD` از Secrets |
| نبود `autoUpdater` و مسیر امضاشده‌ی به‌روزرسانی | پایین | پس از امضای بسته، `electron-updater` با `publish.provider: github` و امضای `latest.yml` |
| CSP حاوی `'unsafe-inline'` برای استایل | پایین | در صورت بازنویسی استایل‌ها به کلاس‌های CSS، حذف `'unsafe-inline'` |
| ذخیره‌سازی پروژه در `localStorage` بدون سقف حجم | پایین | مهاجرت به فایل پروژه‌ی JSON در `app.getPath('userData')` با IPC محدود + `contextBridge` |
| فایل اکسل ورودی از منبع نامعتبر | پایین | محدود کردن حجم فایل پیش از پارس و نمایش هشدار در صورت ناشناخته‌بودن شیت‌ها |
| نبود `electron` در حالت `sandbox` روی توزیع‌های لینوکسی قدیمی | پایین | مستندسازی پشتیبانی رسمی فقط Windows x64 |

## جمع‌بندی

- هیچ‌کدام از مشکلات از نوع «کد اجرایی از راه دور» (RCE) نبود؛ سطح حمله فقط به دلیل نبود CSP و نبود کنترل ناوبری، متوسط بود.
- همه‌ی موارد بالا در همین شاخه برطرف شده‌اند. برای تأیید، `npm run build` و سپس بازبینی `dist/index.html` کافی است.
