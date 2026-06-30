const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Settings
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  getAllSettings: () => ipcRenderer.invoke('settings:get-all'),

  // Transactions
  addTransaction: (data) => ipcRenderer.invoke('crud:add-transaction', data),
  getTransactions: (filters) => ipcRenderer.invoke('crud:get-transactions', filters),
  updateTransaction: (id, data) => ipcRenderer.invoke('crud:update-transaction', id, data),
  deleteTransaction: (id) => ipcRenderer.invoke('crud:delete-transaction', id),

  // Categories
  getCategories: (type) => ipcRenderer.invoke('categories:list', type),
  addCategory: (data) => ipcRenderer.invoke('categories:add', data),
  updateCategory: (id, data) => ipcRenderer.invoke('categories:update', id, data),
  deleteCategory: (id) => ipcRenderer.invoke('categories:delete', id),

  // Accounts
  getAccounts: () => ipcRenderer.invoke('accounts:list'),
  addAccount: (data) => ipcRenderer.invoke('accounts:add', data),
  updateAccount: (id, data) => ipcRenderer.invoke('accounts:update', id, data),
  deleteAccount: (id) => ipcRenderer.invoke('accounts:delete', id),

  // Stats
  getMonthlyStats: (month) => ipcRenderer.invoke('stats:monthly', month),
  getDailyStats: (month) => ipcRenderer.invoke('stats:daily', month),
  getCategoryStats: (month, type) => ipcRenderer.invoke('stats:category', month, type),
  getTodayStats: (date) => ipcRenderer.invoke('stats:today', date),

  // OCR
  recognizeOCR: (imageBase64, mode) => ipcRenderer.invoke('ocr:recognize', imageBase64, mode),
  paddleStatus: () => ipcRenderer.invoke('ocr:paddle-status'),

  // Export
  exportCSV: (filters) => ipcRenderer.invoke('export:csv', filters),
  exportExcel: (filters) => ipcRenderer.invoke('export:excel', filters),

  // Import
  openImportFile: (fileType) => ipcRenderer.invoke('import:open-file', fileType),
  parseImportFile: (filePath) => ipcRenderer.invoke('import:parse', filePath),
  executeImport: (transactions) => ipcRenderer.invoke('import:execute', transactions),

  // Dialog
  openImageDialog: () => ipcRenderer.invoke('dialog:open-image')
});
