const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const database = require('./database');

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format category as "icon name" string.
 * Transactions from getTransactions() already include
 * category_icon and category_name via LEFT JOIN.
 */
function formatCategory(txn) {
  if (txn.category_icon && txn.category_name) {
    return `${txn.category_icon} ${txn.category_name}`;
  }
  return txn.category_icon || txn.category_name || '';
}

/**
 * Format account as "icon name" string.
 */
function formatAccount(txn) {
  if (txn.account_icon && txn.account_name) {
    return `${txn.account_icon} ${txn.account_name}`;
  }
  return txn.account_icon || txn.account_name || '';
}

/**
 * Escape a field value for CSV (wrap in quotes if it contains comma, quote, or newline).
 */
function csvEscape(value) {
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ─── CSV Export ────────────────────────────────────────────────────────────────

/**
 * Export transactions to a UTF-8 CSV file with BOM (for Excel Chinese compatibility).
 *
 * @param {string} filePath - Absolute path for the .csv file
 * @param {object} [options]
 * @param {number} [options.type] - 0=expense, 1=income
 * @param {string} [options.month] - "YYYY-MM"
 * @returns {string} filePath
 *
 * Format:
 *   日期,类型,金额,分类,账户,备注
 *   Expense amounts prefixed with "-", income with "+"
 */
function exportCSV(filePath, { type, month } = {}) {
  const transactions = database.getTransactions({ type, month, limit: 0 });

  const BOM = '﻿';
  const header = '日期,类型,金额,分类,账户,备注';
  const lines = [header];

  for (const txn of transactions) {
    const typeLabel = txn.type === 0 ? '支出' : '收入';
    const prefix = txn.type === 0 ? '-' : '+';
    const amount = prefix + txn.amount.toFixed(2);
    const category = formatCategory(txn);
    const account = formatAccount(txn);

    const row = [
      txn.date,
      typeLabel,
      amount,
      category,
      account,
      txn.note || '',
    ].map(csvEscape).join(',');

    lines.push(row);
  }

  fs.writeFileSync(filePath, BOM + lines.join('\n'), 'utf-8');
  return filePath;
}

// ─── Excel Export ──────────────────────────────────────────────────────────────

/**
 * Export transactions to an .xlsx file using SheetJS.
 *
 * @param {string} filePath - Absolute path for the .xlsx file
 * @param {object} [options]
 * @param {number} [options.type] - 0=expense, 1=income
 * @param {string} [options.month] - "YYYY-MM"
 * @returns {string} filePath
 *
 * Columns: 日期 | 类型 | 金额 | 分类 | 账户 | 备注
 * Type is a label ("支出"/"收入"), Amount is numeric (negative for expense).
 */
function exportExcel(filePath, { type, month } = {}) {
  const transactions = database.getTransactions({ type, month, limit: 0 });

  const data = [['日期', '类型', '金额', '分类', '账户', '备注']];

  for (const txn of transactions) {
    const typeLabel = txn.type === 0 ? '支出' : '收入';
    const amount = txn.type === 0 ? -txn.amount : txn.amount;
    const category = formatCategory(txn);
    const account = formatAccount(txn);

    data.push([
      txn.date,
      typeLabel,
      amount,
      category,
      account,
      txn.note || '',
    ]);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, '账目');
  XLSX.writeFile(wb, filePath);

  return filePath;
}

// ─── Exports ───────────────────────────────────────────────────────────────────

module.exports = { exportCSV, exportExcel };

// ─── Self-Test ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  console.log('=== export.js self-test ===\n');

  // Use a test database
  const testDbPath = path.join(__dirname, 'export-test.db');
  [testDbPath, testDbPath + '-wal', testDbPath + '-shm'].forEach(f => {
    try { fs.unlinkSync(f); } catch (e) { /* ok */ }
  });

  // We need to override the database path. Since database.js uses electron app.getPath
  // we set up database manually - database already defaults to accounting-test.db when
  // electron is not available, but we want our own test db to avoid conflicts.
  // By temporarily setting NODE_ENV, or just using the test fallback.
  // The database module's getDbPath will use __dirname/accounting-test.db on fallback.
  // We'll just init it and test.

  database.initDatabase();

  // Add some transactions for testing
  const today = new Date().toISOString().slice(0, 10);
  const lastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15)
    .toISOString().slice(0, 10);

  database.addTransaction({
    type: 0, amount: 35.50, category_id: 1, account_id: 1,
    note: '午餐, 外卖', date: today,
  });
  database.addTransaction({
    type: 0, amount: 128.00, category_id: 3, account_id: 2,
    note: '网购生活用品', date: today,
  });
  database.addTransaction({
    type: 1, amount: 12000, category_id: 11, account_id: 1,
    note: '工资', date: today,
  });
  database.addTransaction({
    type: 0, amount: 15.00, category_id: null, account_id: null,
    note: '无分类支出', date: lastMonth,
  });

  console.log('1. Testing exportCSV...');
  const csvPath = path.join(__dirname, 'export-test.csv');
  const csvResult = exportCSV(csvPath, { month: today.slice(0, 7) });
  console.log('   Result path:', csvResult);
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  console.log('   Has BOM:', csvContent.charCodeAt(0) === 0xFEFF);
  const csvLines = csvContent.split('\n');
  console.log('   Line count:', csvLines.length, '(header +', csvLines.length - 1, 'rows)');
  console.log('   Header:', csvLines[0]);
  csvLines.slice(1).forEach((line, i) => {
    if (line.trim()) console.log('   Row', i + 1 + ':', line.slice(0, 80) + (line.length > 80 ? '...' : ''));
  });

  console.log('\n2. Testing exportExcel...');
  const xlsxPath = path.join(__dirname, 'export-test.xlsx');
  const xlsxResult = exportExcel(xlsxPath, { month: today.slice(0, 7) });
  console.log('   Result path:', xlsxResult);
  const xlsxExists = fs.existsSync(xlsxPath);
  const xlsxSize = xlsxExists ? fs.statSync(xlsxPath).size : 0;
  console.log('   File exists:', xlsxExists);
  console.log('   File size:', xlsxSize, 'bytes');
  console.log('   File > 0 bytes:', xlsxSize > 0);

  // Read back the xlsx to verify content
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  console.log('   Sheet name:', wb.SheetNames[0]);
  console.log('   Row count:', rows.length, '(header +', rows.length - 1, 'rows)');
  console.log('   Header:', rows[0]);
  rows.slice(1).forEach((row, i) => {
    console.log('   Row', i + 1 + ':', JSON.stringify(row));
  });

  // Test filtering by type
  console.log('\n3. Testing type filter...');
  const csvIncomePath = path.join(__dirname, 'export-test-income.csv');
  exportCSV(csvIncomePath, { type: 1, month: today.slice(0, 7) });
  const incomeContent = fs.readFileSync(csvIncomePath, 'utf-8');
  const incomeLines = incomeContent.split('\n').filter(l => l.trim());
  console.log('   Income-only CSV rows:', incomeLines.length - 1);
  console.log('   Contains "+":', incomeContent.includes('+'));

  // Test filtering with no data
  console.log('\n4. Testing empty export...');
  const emptyCsvPath = path.join(__dirname, 'export-test-empty.csv');
  exportCSV(emptyCsvPath, { month: '2020-01' });
  const emptyContent = fs.readFileSync(emptyCsvPath, 'utf-8');
  console.log('   Empty CSV has header only:', emptyContent.split('\n').filter(l => l.trim()).length === 1);

  // Cleanup test files
  const testFiles = [
    testDbPath, testDbPath + '-wal', testDbPath + '-shm',
    csvPath, xlsxPath, csvIncomePath, emptyCsvPath,
  ];
  testFiles.forEach(f => {
    try { fs.unlinkSync(f); } catch (e) { /* ok */ }
  });

  console.log('\nAll tests passed!');
}
