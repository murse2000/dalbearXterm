const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
if (process.env.DALBEAR_SOFTWARE_RENDERING) app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1480, height: 920, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL('data:text/html;charset=utf-8,<html><body>시작 시간 비교용 빈 창</body></html>');
  fs.writeFileSync(path.resolve(`test-results/performance/minimal-${process.env.DALBEAR_VARIANT || 'default'}.json`), JSON.stringify({ elapsedMs: Date.now() - Number(process.env.DALBEAR_STARTED), uptimeMs: process.uptime() * 1000, gpu: app.getGPUFeatureStatus() }, null, 2));
  app.quit();
});
