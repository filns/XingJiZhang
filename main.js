const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// ─── Existing modules ───────────────────────────────────────────────────────────
const database = require('./database');
const ocr = require('./ocr');
const exportModule = require('./export');
const importModule = require('./import');

let mainWindow = null;

// ─── Window Creation ────────────────────────────────────────────────────────────

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    titleBarOverlay: {
      color: '#f0f0f5',
      symbolColor: '#1a1a2e',
      height: 32
    },
    backgroundColor: '#f0f0f5',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.ico')
      : path.join(__dirname, 'assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile('index.html');
}

// ─── Seed API Credentials ────────────────────────────────────────────────────────

function loadSecrets() {
  const searchPaths = [path.join(__dirname, 'secrets.json')];
  if (app.isPackaged) {
    searchPaths.push(path.join(process.resourcesPath, 'secrets.json'));
  }
  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
      catch (e) { console.error('Failed to parse secrets.json:', e.message); }
    }
  }
  return null;
}

function seedApiCredentials() {
  if (!database.getSetting('app_id')) {
    const secrets = loadSecrets();
    const ocr = (secrets && secrets.baidu_ocr) ? secrets.baidu_ocr : {};
    database.setSetting('app_id', ocr.app_id || '');
    database.setSetting('api_key', ocr.api_key || '');
    database.setSetting('secret_key', ocr.secret_key || '');
  }
}

// ─── Image Format Detection ──────────────────────────────────────────────────

function detectImageFormat(buffer) {
  if (buffer.length < 4) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpeg';
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
  // BMP: 42 4D
  if (buffer[0] === 0x42 && buffer[1] === 0x4D) return 'bmp';
  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'gif';
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer.length >= 12 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return 'webp';
  }
  return null;
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────────

function registerIpcHandlers() {
  // ── Settings ────────────────────────────────────────────────────────────────

  ipcMain.handle('settings:get', (_, key) => {
    return database.getSetting(key);
  });

  ipcMain.handle('settings:set', (_, key, value) => {
    database.setSetting(key, value);
    return true;
  });

  ipcMain.handle('settings:get-all', () => {
    return {
      app_id: database.getSetting('app_id'),
      api_key: database.getSetting('api_key'),
      secret_key: database.getSetting('secret_key'),
      background_type: database.getSetting('background_type'),
      background_value: database.getSetting('background_value')
    };
  });

  // ── CRUD: Transactions ──────────────────────────────────────────────────────

  ipcMain.handle('crud:add-transaction', (_, data) => {
    return database.addTransaction(data);
  });

  ipcMain.handle('crud:get-transactions', (_, filters) => {
    return database.getTransactions(filters || {});
  });

  ipcMain.handle('crud:update-transaction', (_, id, data) => {
    database.updateTransaction(id, data);
    return true;
  });

  ipcMain.handle('crud:delete-transaction', (_, id) => {
    database.deleteTransaction(id);
    return true;
  });

  // ── Categories ──────────────────────────────────────────────────────────────

  ipcMain.handle('categories:list', (_, type) => {
    return database.getCategories(type);
  });

  ipcMain.handle('categories:add', (_, data) => {
    return database.addCategory(data);
  });

  ipcMain.handle('categories:update', (_, id, data) => {
    database.updateCategory(id, data);
    return true;
  });

  ipcMain.handle('categories:delete', (_, id) => {
    database.deleteCategory(id);
    return true;
  });

  // ── Accounts ────────────────────────────────────────────────────────────────

  ipcMain.handle('accounts:list', () => {
    return database.getAccounts();
  });

  ipcMain.handle('accounts:add', (_, data) => {
    return database.addAccount(data);
  });

  ipcMain.handle('accounts:update', (_, id, data) => {
    database.updateAccount(id, data);
    return true;
  });

  ipcMain.handle('accounts:delete', (_, id) => {
    database.deleteAccount(id);
    return true;
  });

  // ── Statistics ──────────────────────────────────────────────────────────────

  ipcMain.handle('stats:monthly', (_, month) => {
    return database.getMonthlyStats(month);
  });

  ipcMain.handle('stats:daily', (_, month) => {
    return database.getDailyStats(month);
  });

  ipcMain.handle('stats:category', (_, month, type) => {
    return database.getCategoryStats(month, type);
  });

  ipcMain.handle('stats:today', (_, date) => {
    return database.getTodayStats(date);
  });

  // ── OCR ─────────────────────────────────────────────────────────────────────

  ipcMain.handle('ocr:recognize', async (_, imageBase64, mode) => {
    console.log('[OCR main] recognize called, mode:', mode, 'base64 length:', imageBase64 ? imageBase64.length : 'null');

    let ocrPromise;

    if (mode === 'paddle') {
      ocrPromise = ocr.recognizePaddle(imageBase64);
    } else if (mode === 'high') {
      ocrPromise = ocr.recognizeHighPrecision(imageBase64);
    } else {
      ocrPromise = ocr.recognizeReceipt(imageBase64);
    }

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('OCR识别超时(60s)，请检查网络或稍后重试')), 60000)
    );

    const result = await Promise.race([ocrPromise, timeoutPromise]);
    console.log('[OCR main] API response received, rawText length:', result.rawText ? result.rawText.length : 'null');
    const extracted = ocr.extractTransactionInfo(result.rawText);
    console.log('[OCR main] extractTransactionInfo done:', JSON.stringify(extracted));
    return { ...result, ...extracted };
  });

  ipcMain.handle('ocr:paddle-status', async () => {
    return ocr.isPaddleAvailable();
  });

  // ── Export ──────────────────────────────────────────────────────────────────

  ipcMain.handle('export:csv', async (_, filters) => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `记账导出_${dateStr}.csv`,
      filters: [
        { name: 'CSV Files', extensions: ['csv'] }
      ]
    });
    if (result.canceled || !result.filePath) return null;
    exportModule.exportCSV(result.filePath, filters || {});
    return result.filePath;
  });

  ipcMain.handle('export:excel', async (_, filters) => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `记账导出_${dateStr}.xlsx`,
      filters: [
        { name: 'Excel Files', extensions: ['xlsx'] }
      ]
    });
    if (result.canceled || !result.filePath) return null;
    exportModule.exportExcel(result.filePath, filters || {});
    return result.filePath;
  });

  // ── Dialog: Open Image ──────────────────────────────────────────────────────

  ipcMain.handle('dialog:open-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'png', 'jpeg', 'bmp', 'webp', 'gif'] }]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const buffer = fs.readFileSync(result.filePaths[0]);
      const format = detectImageFormat(buffer);
      if (!format) {
        throw new Error('无法识别的图片格式，请使用 JPG/PNG/BMP 图片');
      }
      return `data:image/${format};base64,${buffer.toString('base64')}`;
    }
    return null;
  });

  // ── Import ──────────────────────────────────────────────────────────────────

  ipcMain.handle('import:open-file', async (_, fileType) => {
    const extensions = fileType === 'csv' ? ['csv'] : ['xlsx'];
    const name = fileType === 'csv' ? 'CSV Files' : 'Excel Files';
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name, extensions }]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('import:parse', async (_, filePath) => {
    return importModule.parseFile(filePath);
  });

  ipcMain.handle('import:execute', async (_, transactions) => {
    return importModule.executeImport(transactions);
  });
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await database.initDatabase();
  seedApiCredentials();
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
