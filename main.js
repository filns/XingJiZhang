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
    searchPaths.push(path.join(app.getPath('userData'), 'secrets.json'));
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

// ─── Input Validation ────────────────────────────────────────────────────────────

const MAX_AMOUNT = 9999999.99;

function assert(condition, message) {
  if (!condition) {
    const err = new Error(message);
    err.name = 'ValidationError';
    throw err;
  }
}

function validateId(id) {
  assert(Number.isInteger(id) && id > 0, 'Invalid id: must be a positive integer');
}

function validateOptionalId(id) {
  if (id === null || id === undefined) return;
  assert(Number.isInteger(id) && id > 0, 'Invalid id: must be a positive integer or null');
}

function validateAmount(amount) {
  assert(typeof amount === 'number' && !isNaN(amount), 'Amount must be a number');
  assert(amount > 0 && amount <= MAX_AMOUNT, `Amount must be between 0 and ${MAX_AMOUNT}`);
}

function validateType(type) {
  assert(type === 0 || type === 1, 'Type must be 0 (expense) or 1 (income)');
}

function validateDate(date) {
  assert(typeof date === 'string' && date.length >= 10, 'Date must be a string');
  assert(/^\d{4}-\d{2}-\d{2}/.test(date), 'Date must start with YYYY-MM-DD');
}

function validateNote(note) {
  if (note === null || note === undefined) return;
  assert(typeof note === 'string', 'Note must be a string');
  assert(note.length <= 500, 'Note must not exceed 500 characters');
}

function validateName(name) {
  assert(typeof name === 'string' && name.trim().length > 0, 'Name must be a non-empty string');
  assert(name.length <= 20, 'Name must not exceed 20 characters');
}

function validateIcon(icon) {
  assert(typeof icon === 'string' && icon.length > 0, 'Icon must be a non-empty string');
  assert(icon.length <= 5, 'Icon must not exceed 5 characters');
}

function validateTransaction(data) {
  validateAmount(data.amount);
  validateType(data.type);
  validateOptionalId(data.category_id);
  validateOptionalId(data.account_id);
  validateNote(data.note);
  validateDate(data.date);
}

function validateTransactionUpdate(data) {
  assert(data, 'Update data is required');
  if (data.amount !== undefined) validateAmount(data.amount);
  if (data.type !== undefined) validateType(data.type);
  if (data.category_id !== undefined) validateOptionalId(data.category_id);
  if (data.account_id !== undefined) validateOptionalId(data.account_id);
  if (data.note !== undefined) validateNote(data.note);
  if (data.date !== undefined) validateDate(data.date);
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────────

function registerIpcHandlers() {
  // ── Settings ────────────────────────────────────────────────────────────────

  ipcMain.handle('settings:get', (_, key) => {
    return database.getSetting(key);
  });

  ipcMain.handle('settings:set', (_, key, value) => {
    const allowedKeys = ['app_id', 'api_key', 'secret_key', 'background_type', 'background_value', 'watch_folder', 'watch_enabled'];
    assert(typeof key === 'string' && allowedKeys.includes(key),
      `Invalid setting key: ${key}`);
    assert(typeof value === 'string', 'Setting value must be a string');
    assert(value.length <= 500, 'Setting value must not exceed 500 characters');
    database.setSetting(key, value);
    return true;
  });

  ipcMain.handle('settings:get-all', () => {
    return {
      app_id: database.getSetting('app_id'),
      api_key: database.getSetting('api_key'),
      secret_key: database.getSetting('secret_key'),
      background_type: database.getSetting('background_type'),
      background_value: database.getSetting('background_value'),
      watch_folder: database.getSetting('watch_folder'),
      watch_enabled: database.getSetting('watch_enabled')
    };
  });

  // ── CRUD: Transactions ──────────────────────────────────────────────────────

  ipcMain.handle('crud:add-transaction', (_, data) => {
    assert(data, 'Transaction data is required');
    validateTransaction(data);
    return database.addTransaction(data);
  });

  ipcMain.handle('crud:get-transactions', (_, filters) => {
    return database.getTransactions(filters || {});
  });

  ipcMain.handle('crud:update-transaction', (_, id, data) => {
    validateId(id);
    validateTransactionUpdate(data);
    database.updateTransaction(id, data);
    return true;
  });

  ipcMain.handle('crud:delete-transaction', (_, id) => {
    validateId(id);
    database.deleteTransaction(id);
    return true;
  });

  // ── Categories ──────────────────────────────────────────────────────────────

  ipcMain.handle('categories:list', (_, type) => {
    return database.getCategories(type);
  });

  ipcMain.handle('categories:add', (_, data) => {
    assert(data, 'Category data is required');
    validateName(data.name);
    validateIcon(data.icon);
    validateType(data.type);
    return database.addCategory(data);
  });

  ipcMain.handle('categories:update', (_, id, data) => {
    validateId(id);
    assert(data, 'Update data is required');
    if (data.name !== undefined) validateName(data.name);
    if (data.icon !== undefined) validateIcon(data.icon);
    database.updateCategory(id, data);
    return true;
  });

  ipcMain.handle('categories:delete', (_, id) => {
    validateId(id);
    database.deleteCategory(id);
    return true;
  });

  // ── Accounts ────────────────────────────────────────────────────────────────

  ipcMain.handle('accounts:list', () => {
    return database.getAccounts();
  });

  ipcMain.handle('accounts:add', (_, data) => {
    assert(data, 'Account data is required');
    validateName(data.name);
    validateIcon(data.icon);
    return database.addAccount(data);
  });

  ipcMain.handle('accounts:update', (_, id, data) => {
    validateId(id);
    assert(data, 'Update data is required');
    if (data.name !== undefined) validateName(data.name);
    if (data.icon !== undefined) validateIcon(data.icon);
    database.updateAccount(id, data);
    return true;
  });

  ipcMain.handle('accounts:delete', (_, id) => {
    validateId(id);
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

  // ── Auto-Sync (Folder Watch) ──────────────────────────────────────────────

  ipcMain.handle('watch:get-config', () => {
    return { folder: getWatchFolder(), enabled: isWatchEnabled() };
  });

  ipcMain.handle('watch:choose-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: '选择账单文件夹'
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('watch:set-config', (_, config) => {
    assert(config && typeof config === 'object', 'Invalid watch config');
    const folder = typeof config.folder === 'string' ? config.folder : '';
    const enabled = config.enabled ? '1' : '0';
    assert(folder.length <= 500, 'Folder path must not exceed 500 characters');
    database.setSetting('watch_folder', folder);
    database.setSetting('watch_enabled', enabled);
    startWatcher();
    return { folder: getWatchFolder(), enabled: isWatchEnabled() };
  });

  ipcMain.handle('watch:scan-now', async () => {
    const folder = getWatchFolder();
    if (!folder || !fs.existsSync(folder)) return { error: '未设置账单文件夹' };
    await scanWatchFolder(folder);
    return { ok: true };
  });
}

// ─── Auto-Sync (Folder Watch) ──────────────────────────────────────────────

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif'];
const BILL_EXTS = ['.csv', '.xlsx'];
const WATCH_INTERVAL_MS = 5000;
let watchTimer = null;
const processedFiles = new Map(); // "path|mtime|size" → true

function getWatchFolder() {
  return database.getSetting('watch_folder') || '';
}

function isWatchEnabled() {
  return database.getSetting('watch_enabled') === '1';
}

function startWatcher() {
  stopWatcher();
  if (!isWatchEnabled()) return;
  const folder = getWatchFolder();
  if (!folder || !fs.existsSync(folder)) return;
  watchTimer = setInterval(() => scanWatchFolder(folder), WATCH_INTERVAL_MS);
}

function stopWatcher() {
  if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
}

function notifyAutoImport(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('import:auto-result', payload);
  }
}

async function scanWatchFolder(folder) {
  let entries;
  try { entries = fs.readdirSync(folder); } catch (e) { return; }

  for (const name of entries) {
    const filePath = path.join(folder, name);
    let stat;
    try { stat = fs.statSync(filePath); } catch (e) { continue; }
    if (!stat.isFile()) continue;

    const ext = path.extname(name).toLowerCase();
    const isImage = IMAGE_EXTS.includes(ext);
    const isBill = BILL_EXTS.includes(ext);
    if (!isImage && !isBill) continue;

    const key = `${filePath}|${stat.mtimeMs}|${stat.size}`;
    if (processedFiles.has(key)) continue;
    processedFiles.set(key, true);

    try {
      const result = isImage ? await importImageFile(filePath) : await importBillFile(filePath);
      notifyAutoImport({ file: name, ...result });
    } catch (err) {
      notifyAutoImport({ file: name, error: err.message || String(err) });
    }
  }
}

async function importBillFile(filePath) {
  const parsed = importModule.parseFile(filePath);
  return importModule.executeImport(parsed.transactions);
}

async function importImageFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const format = detectImageFormat(buffer);
  if (!format) throw new Error('无法识别的图片格式');

  const base64 = buffer.toString('base64');
  let ocrResult;
  if (await ocr.isPaddleAvailable()) {
    ocrResult = await ocr.recognizePaddle(base64);
  } else {
    ocrResult = await ocr.recognizeReceipt(base64);
  }

  const extracted = ocr.extractTransactionInfo(ocrResult.rawText);
  const transactions = (extracted.transactions || []).map(t => {
    const amount = Math.round(t.amount * 100) / 100;
    return {
      type: t.type,
      amount,
      category_id: t.category_id || null,
      account_id: null,
      note: t.merchant || '未知商户',
      date: t.date,
      unique_key: 'gen:' + [t.date, t.type, amount, t.merchant || ''].join('|'),
    };
  });

  if (transactions.length === 0) {
    throw new Error('未识别到可导入的交易（无法确定金额或收支类型）');
  }

  return importModule.executeImport(transactions);
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await database.initDatabase();
  seedApiCredentials();
  registerIpcHandlers();
  createWindow();
  startWatcher();
});

app.on('window-all-closed', () => {
  app.quit();
});
