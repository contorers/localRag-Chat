// 使用 import 而不是 require
import { app, BrowserWindow } from 'electron';
import path from 'node:path'; // 显式使用 node: 前缀
import { fileURLToPath } from 'node:url';

// 在 ESM 模式下，__dirname 是不存在的，必须手动构建
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true, 
      contextIsolation: false, 
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // 确保路径指向 dist/index.html
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);