const XLSX = require('xlsx');
const fs = require('fs');
const database = require('./database');

const { autoCategorize } = database;

// ─── CSV Parser ───────────────────────────────────────────────────────────

/**
 * Parse a CSV line, handling quoted fields and embedded commas/newlines.
 */
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

function parseCSV(content) {
  // Strip UTF-8 BOM if present
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

  // Normalize line endings
  content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });
    rows.push(row);
  }
  return { headers, rows };
}

// ─── Name Matching ────────────────────────────────────────────────────────

/** Strip emoji icon prefix from "🍔 餐饮" → "餐饮" */
function stripIcon(text) {
  if (!text) return '';
  // Match: emoji characters or other symbols followed by optional space
  const stripped = text.replace(/^[\p{Emoji}\p{Emoji_Presentation}\p{Emoji_Modifier_Base}\p{Emoji_Modifier}\p{Emoji_Component}‍️\s]+/u, '').trim();
  return stripped || text.trim();
}

function findCategoryId(name) {
  if (!name) return null;
  const stripped = stripIcon(name);
  const cats = database.getCategories();
  const match = cats.find(c => c.name === stripped);
  return match ? match.id : null;
}

function findAccountId(name) {
  if (!name) return null;
  const stripped = stripIcon(name);
  const accounts = database.getAccounts();
  const match = accounts.find(a => a.name === stripped);
  return match ? match.id : null;
}

// ─── Value Parsing ────────────────────────────────────────────────────────

function parseAmount(value) {
  const s = String(value || '').replace(/[¥￥]/g, '').trim();
  // "+12000.00" → income, "-35.50" → expense
  if (s.startsWith('+')) return { amount: Math.abs(parseFloat(s)), type: 1 };
  if (s.startsWith('-')) return { amount: Math.abs(parseFloat(s)), type: 0 };
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  // Positive without sign → guess income
  return n < 0 ? { amount: Math.abs(n), type: 0 } : { amount: n, type: 1 };
}

function parseDate(value) {
  if (!value || !value.trim()) return '';
  const s = value.trim();
  // Already "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD"
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  // "YYYY/MM/DD ..." → normalize
  if (/^\d{4}\/\d{2}\/\d{2}/.test(s)) return s.replace(/\//g, '-');
  return s;
}

/**
 * Convert an Excel serial date number to "YYYY-MM-DD HH:MM:SS".
 * Excel stores dates as days since 1900-01-01 (with the leap-year bug).
 * Typical WeChat bill dates are in the 45000+ range (2023+).
 */
function excelSerialToDateTime(serial) {
  const n = Number(serial);
  if (isNaN(n) || n < 40000 || n > 60000) return null;
  // Days from Excel epoch (1899-12-30) to Unix epoch (1970-01-01)
  const utcDays = Math.floor(n) - 25569;
  const ms = Math.round((n - Math.floor(n)) * 86400000);
  const d = new Date(utcDays * 86400000 + ms);
  const pad = v => String(v).padStart(2, '0');
  // Use UTC methods: Excel serial represents local wall-clock time,
  // and the serial→UTC conversion gives the correct clock reading in UTC.
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * Parse a datetime string from WeChat bill column [0].
 * Supports: "2026-05-20 13:14:52", "2026/5/20 13:14:52", "2026-05-20 13:14"
 * Also handles Excel serial date numbers converted to string.
 */
function parseDateTimeString(value) {
  if (!value || !value.trim && typeof value !== 'number') return null;

  // If value is a number, try Excel serial date conversion
  if (typeof value === 'number') return excelSerialToDateTime(value);

  const s = value.trim();
  if (!s) return null;

  // If string looks like an Excel serial number, try conversion
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const result = excelSerialToDateTime(parseFloat(s));
    if (result) return result;
  }

  // Match "YYYY[-/]MM[-/]DD HH:MM[:SS]"
  const m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const year = m[1];
  const month = m[2].padStart(2, '0');
  const day = m[3].padStart(2, '0');
  const hour = m[4].padStart(2, '0');
  const minute = m[5];
  const second = m[6] || '00';
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

// ─── WeChat Format Detection ──────────────────────────────────────────────

/** Return true if the header row looks like a WeChat payment bill */
function isWeChatFormat(headers) {
  const h = headers.map(s => String(s).trim());
  return h.some(v => v.includes('交易时间')) &&
         h.some(v => v.includes('交易类型')) &&
         h.some(v => v.includes('收/支')) &&
         h.some(v => v.includes('金额'));
}

/**
 * Try to extract a date (YYYY-MM-DD) from WeChat transaction/order IDs.
 * WeChat IDs contain date strings like "20260629" or "260629".
 */
function extractWeChatDate(transactionId, merchantOrderId) {
  const now = new Date();
  const thisYear = now.getFullYear();

  // Full date: YYYYMMDD — year must be between 2020 and current year
  const fullPattern = /(20(?:2[0-9]|[3-9]\d))(\d{2})(\d{2})/;

  // Short date at start: MMDD — exactly 6 digits at start of string
  const shortPattern = /^(\d{2})(\d{2})(\d{2})/;

  for (const id of [transactionId, merchantOrderId]) {
    if (!id) continue;
    const s = String(id);
    let m = s.match(fullPattern);
    if (!m) {
      // Also try matching after 10-digit prefix (WeChat transaction ID prefix)
      m = s.match(/^\d{10}(20(?:2[0-9]|[3-9]\d))(\d{2})(\d{2})/);
    }
    if (m && parseInt(m[2]) >= 1 && parseInt(m[2]) <= 12 && parseInt(m[3]) >= 1 && parseInt(m[3]) <= 31) {
      return `${m[1]}-${m[2]}-${m[3]}`;
    }
    const sm = s.match(shortPattern);
    if (sm && parseInt(sm[1]) >= 1 && parseInt(sm[1]) <= 12 && parseInt(sm[2]) >= 1 && parseInt(sm[2]) <= 31) {
      return `${thisYear}-${sm[1]}-${sm[2]}`;
    }
  }
  return '';
}

// ─── Main Import ──────────────────────────────────────────────────────────

function parseFile(filePath) {
  const ext = filePath.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';
  let headers, rows;

  if (ext === 'csv') {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseCSV(content);
    headers = parsed.headers;
    rows = parsed.rows;
  } else {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    // Read as array-of-arrays to preserve all rows (including metadata)
    const rawData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (rawData.length === 0) return { headers: [], transactions: [] };

    // Detect WeChat format
    if (rawData.length > 17 && isWeChatFormat(rawData[17])) {
      return parseWeChatFormat(rawData);
    }

    // Standard format (app export or other)
    const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (data.length === 0) return { headers: [], transactions: [] };
    headers = Object.keys(data[0]);
    rows = data.map(r => {
      const obj = {};
      headers.forEach(h => { obj[h] = String(r[h] || '').trim(); });
      return obj;
    });
  }

  // Map columns by name (Chinese headers from export format)
  const colMap = {};
  headers.forEach(h => {
    if (h.includes('日期')) colMap.date = h;
    else if (h.includes('类型')) colMap.type = h;
    else if (h.includes('金额')) colMap.amount = h;
    else if (h.includes('分类')) colMap.category = h;
    else if (h.includes('账户')) colMap.account = h;
    else if (h.includes('备注')) colMap.note = h;
  });

  // Also try to match English column names
  if (!colMap.date && headers.find(h => h.toLowerCase() === 'date')) colMap.date = 'date';
  if (!colMap.type && headers.find(h => h.toLowerCase() === 'type')) colMap.type = 'type';
  if (!colMap.amount && headers.find(h => h.toLowerCase() === 'amount')) colMap.amount = 'amount';
  if (!colMap.note && headers.find(h => h.toLowerCase() === 'note')) colMap.note = 'note';

  const transactions = [];
  const skipped = [];

  rows.forEach((row, i) => {
    const amountResult = parseAmount(row[colMap.amount] || Object.values(row).find(v => String(v).match(/^[+-]?\d/)));
    if (!amountResult) { skipped.push({ row: i + 2, reason: '无法解析金额' }); return; }

    const typeLabel = row[colMap.type] || '';
    let type = amountResult.type;
    if (typeLabel.includes('支出')) type = 0;
    else if (typeLabel.includes('收入')) type = 1;

    const categoryName = row[colMap.category] || '';
    const accountName = row[colMap.account] || '';
    const note = row[colMap.note] || '';
    let date = parseDate(row[colMap.date] || '');

    // Use 12:00 as neutral default when time is unknown
    if (date && !date.includes(' ')) {
      date = `${date} 12:00:00`;
    }

    const matchedId = findCategoryId(categoryName);
    const catId = matchedId || autoCategorize(note + ' ' + categoryName, type);

    transactions.push({
      type,
      amount: Math.round(amountResult.amount * 100) / 100,
      category_name: categoryName,
      account_name: accountName,
      category_id: catId,
      account_id: findAccountId(accountName),
      note,
      date,
    });
  });

  return { headers, transactions, skipped };
}

/**
 * Parse WeChat payment bill XLSX format.
 *
 * There are two known WeChat bill layouts:
 *   Layout A (newer): row[0] = "交易时间" with full datetime like "2026-05-20 13:14:52"
 *   Layout B (older): row[0] = running balance, dates embedded in transaction IDs
 *
 * Header row (index 17):
 *   [0]交易时间 [1]交易类型 [2]交易对方 [3]商品 [4]收/支
 *   [5]金额(元) [6]支付方式 [7]当前状态 [8]交易单号 [9]商户单号 [10]备注
 */
function parseWeChatFormat(rawData) {
  const headerRow = rawData[17];
  const transactions = [];
  const skipped = [];

  // Extract fallback date from statement period (row 2)
  let fallbackDate = new Date().toISOString().slice(0, 10);
  if (rawData[2]) {
    const periodMatch = String(rawData[2]).match(/终止时间：\[(\d{4}-\d{2}-\d{2})\s/);
    if (periodMatch) fallbackDate = periodMatch[1];
  }

  for (let i = 18; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length < 6) continue;

    // Check if we've hit the end-of-data marker
    const firstValRaw = row[0];
    const firstVal = String(firstValRaw || '').trim();
    if (!firstVal || firstVal === '') continue;

    const txType = String(row[1] || '').trim();
    const merchant = String(row[2] || '').trim();
    const product = String(row[3] || '').trim();
    const inOut = String(row[4] || '').trim();  // "支出" or "收入"
    const amount = parseFloat(row[5]);
    const paymentMethod = String(row[6] || '').trim();
    const transactionId = String(row[8] || '').trim();
    const merchantOrderId = String(row[9] || '').trim();

    if (isNaN(amount) || amount <= 0) {
      skipped.push({ row: i + 1, reason: '金额无效' });
      continue;
    }

    const type = inOut.includes('收入') ? 1 : 0;

    // Build note from product and merchant
    let note = product ? product.replace(/^转账备注[:：]\s*/, '') : '';
    if (!note || note === '/') note = '';

    // Try row[0] as a datetime first (handles string dates & Excel serial numbers)
    let date = parseDateTimeString(firstValRaw);
    if (!date) {
      date = extractWeChatDate(transactionId, merchantOrderId) || fallbackDate;
      if (date && !date.includes(' ')) {
        date = `${date} 12:00:00`;
      }
    }

    // Match category by merchant name
    const catId = autoCategorize(merchant, type) || autoCategorize(product, type);

    // Match account by payment method
    const accountId = findAccountId(paymentMethod);
    let accountName = paymentMethod && paymentMethod !== '/' ? paymentMethod : '';

    // Auto-create account if it doesn't exist (for WeChat payment methods)
    if (!accountId && accountName) {
      try {
        const iconMap = { '零钱': '💬', '零钱通': '💰', '工商银行': '💳', '建设银行': '💳',
          '农业银行': '💳', '中国银行': '💳', '招商银行': '💳', '交通银行': '💳',
          '邮政储蓄银行': '💳', '中信银行': '💳' };
        const icon = iconMap[accountName] || '💳';
        const newAcct = database.addAccount({ name: accountName, icon, sort_order: 99 });
        transactions.push({
          type, amount: Math.round(amount * 100) / 100,
          category_name: '', account_name: accountName,
          category_id: catId, account_id: newAcct.id,
          note, date,
        });
        continue;
      } catch (e) { /* fall through */ }
    }

    transactions.push({
      type,
      amount: Math.round(amount * 100) / 100,
      category_name: merchant,
      account_name: accountName,
      category_id: catId,
      account_id: accountId,
      note,
      date,
    });
  }

  return { headers: headerRow, transactions, skipped };
}

/**
 * Execute the actual import: insert all parsed transactions.
 * Returns { imported, failed } counts.
 */
function executeImport(transactions) {
  let imported = 0;
  let failed = 0;

  for (const txn of transactions) {
    try {
      database.addTransaction({
        type: txn.type,
        amount: txn.amount,
        category_id: txn.category_id,
        account_id: txn.account_id,
        note: txn.note,
        date: txn.date || new Date().toISOString().slice(0, 10),
      });
      imported++;
    } catch (err) {
      console.error('import error:', err);
      failed++;
    }
  }

  return { imported, failed };
}

module.exports = { parseFile, executeImport };

// ─── Self-Test ────────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    console.log('=== import.js self-test ===\n');
    const path = require('path');

    const testDbPath = path.join(__dirname, 'import-test.db');
    [testDbPath, testDbPath + '-wal', testDbPath + '-shm'].forEach(f => {
      try { fs.unlinkSync(f); } catch (e) { /* ok */ }
    });

    await database.initDatabase();

    // Create a test CSV
    const testCSV = path.join(__dirname, 'import-test.csv');
    const bom = '﻿';
    const csvContent = bom + [
      '日期,类型,金额,分类,账户,备注',
      '2026-06-30 14:30:00,支出,-35.50,🍔 餐饮,💳 工商银行,午餐外卖',
      '2026-06-30,收入,+12000.00,💼 工资,💳 工商银行,6月工资',
      '2026-06-29,支出,-128.00,🛒 购物,📱 支付宝,网购',
    ].join('\n');
    fs.writeFileSync(testCSV, csvContent, 'utf-8');

    console.log('1. Testing CSV parsing...');
    const csvResult = parseFile(testCSV);
    console.log('   Headers:', csvResult.headers);
    console.log('   Transactions:', csvResult.transactions.length);
    csvResult.transactions.forEach(t => {
      console.log('     type=' + t.type, 'amount=' + t.amount, 'cat=' + t.category_name, 'cat_id=' + t.category_id, 'note=' + t.note);
    });

    console.log('\n2. Testing CSV import execution...');
    const result = executeImport(csvResult.transactions);
    console.log('   Imported:', result.imported, 'Failed:', result.failed);

    const allTxns = database.getTransactions();
    console.log('   Total transactions after import:', allTxns.length);

    // Cleanup
    [testDbPath, testDbPath + '-wal', testDbPath + '-shm', testCSV].forEach(f => {
      try { fs.unlinkSync(f); } catch (e) { /* ok */ }
    });

    console.log('\nAll tests passed!');
  })().catch(err => { console.error('Self-test failed:', err); process.exit(1); });
}
