/**
 * OCR Module — Baidu AI OCR integration for receipt scanning.
 *
 * Uses Node.js built-in https module directly (not baidu-aip-sdk) because
 * the SDK depends on the deprecated `request` library which hangs silently
 * in Electron's main process.
 *
 * Auth: OAuth 2.0 client_credentials → access_token (方式一).
 * API: POST image as x-www-form-urlencoded; returns JSON.
 */

const { getSetting, autoCategorize } = require('./database');

const TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const GENERAL_BASIC_URL = 'https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic';
const ACCURATE_BASIC_URL = 'https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic';

// Token cache (module-level, lives for the process lifetime)
let cachedToken = null;
let tokenExpireTime = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripDataUrlPrefix(imageBase64) {
  if (imageBase64 && imageBase64.includes(';base64,')) {
    return imageBase64.split(';base64,')[1];
  }
  return imageBase64;
}

function getCredentials() {
  const appId = getSetting('app_id');
  const apiKey = getSetting('api_key');
  const secretKey = getSetting('secret_key');

  const missing = [];
  if (!appId) missing.push('app_id');
  if (!apiKey) missing.push('api_key');
  if (!secretKey) missing.push('secret_key');

  if (missing.length > 0) {
    throw new Error(
      `Missing Baidu OCR credentials: ${missing.join(', ')}. ` +
      'Please configure them in Settings.'
    );
  }

  return { apiKey, secretKey };
}

/**
 * HTTPS POST with x-www-form-urlencoded body.
 * Uses Node.js built-in https — no deprecated `request` dependency.
 */
function httpsPostForm(url, formData) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = new URLSearchParams(formData).toString();
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    };

    let settled = false;

    function onResponse(res) {
      if (settled) return;
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
      res.on('error', (err) => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;
        reject(new Error('网络请求失败: ' + err.message));
      });
    }

    const req = require('https').request({
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers
    }, onResponse);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { req.destroy(); } catch (e) { /* ignore */ }
      reject(new Error('请求超时，请检查网络连接'));
    }, 30000);

    req.on('error', (err) => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      reject(new Error('网络请求失败: ' + err.message));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Get an OAuth access_token, caching until 1 minute before expiry.
 */
async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpireTime - 60000) {
    return cachedToken;
  }

  const { apiKey, secretKey } = getCredentials();

  const result = await httpsPostForm(TOKEN_URL, {
    grant_type: 'client_credentials',
    client_id: apiKey,
    client_secret: secretKey
  });

  if (result.error) {
    throw new Error(
      '获取Token失败: ' + (result.error_description || result.error)
    );
  }

  cachedToken = result.access_token;
  // Default 30 days if not specified
  tokenExpireTime = now + ((result.expires_in || 2592000) * 1000);

  return cachedToken;
}

/**
 * Call an OCR endpoint and normalise the response.
 */
async function callOcr(imageBase64, apiUrl) {
  const cleanImage = stripDataUrlPrefix(imageBase64);
  console.log('[OCR] callOcr: cleanImage length:', cleanImage ? (cleanImage.length / 1024 / 1024).toFixed(2) + 'MB' : 'null');
  const token = await getAccessToken();
  console.log('[OCR] callOcr: got access token, calling API...');

  const result = await httpsPostForm(apiUrl + '?access_token=' + token, {
    image: cleanImage
  });

  console.log('[OCR] callOcr: API response received, error_code:', result ? result.error_code : 'null', 'words_result_num:', result ? result.words_result_num : 'null');

  if (result && result.error_code) {
    const code = result.error_code;
    const msg = result.error_msg || 'unknown error';
    let hint = '';
    if (code === 216100) hint = ' — 图片格式无效或损坏，请尝试截图后重试';
    if (code === 216101) hint = ' — 图片中未检测到文字';
    if (code === 216201) hint = ' — 图片格式不支持，请转换为 JPG/PNG';
    if (code === 216202) hint = ' — 图片尺寸过大，请裁剪后重试';
    if (code === 17 || code === 19) hint = ' — API调用配额已用完，请稍后重试';
    if (code === 110) hint = ' — Access Token无效，请在设置中重新配置API密钥';
    throw new Error(
      `Baidu OCR error [${code}]: ${msg}${hint}`
    );
  }

  const wordsResult = (result && result.words_result) || [];
  if (wordsResult.length === 0) {
    throw new Error('OCR未识别到文字。请确认图片包含清晰、可读的文字内容');
  }
  const rawText = wordsResult.map(item => item.words).join('\n');

  return { rawText, wordsResult: result };
}

// ─── PaddleOCR (Local HTTP) ─────────────────────────────────────────────────

const PADDLE_URL = 'http://127.0.0.1:8868/ocr';
const PADDLE_HEALTH_URL = 'http://127.0.0.1:8868/health';

async function isPaddleAvailable() {
  try {
    const resp = await httpGet(PADDLE_HEALTH_URL);
    return resp && resp.status === 'ok';
  } catch {
    return false;
  }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    // Use Node.js http module for localhost (not https/net)
    const httpMod = require('http');
    httpMod.get(url, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(body)); }
        catch { resolve(body); }
      });
    }).on('error', reject);
  });
}

async function recognizePaddle(imageBase64) {
  const cleanImage = stripDataUrlPrefix(imageBase64);

  const result = await httpPostJson(PADDLE_URL, { image: cleanImage });

  if (result && result.error) {
    throw new Error(`PaddleOCR error: ${result.error}`);
  }

  const wordsResult = (result && result.words_result) || [];
  const rawText = (result && result.rawText) || wordsResult.map(item => item.words).join('\n');

  return { rawText, wordsResult: result };
}

function httpPostJson(url, data) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const postData = JSON.stringify(data);
    const urlObj = new URL(url);

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { req.destroy(); } catch {}
      reject(new Error('PaddleOCR请求超时(15s)，请确认本地服务已启动'));
    }, 15000);

    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;
        try { resolve(JSON.parse(body)); }
        catch { resolve(body); }
      });
    });

    req.on('error', (err) => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      reject(new Error('无法连接PaddleOCR服务: ' + err.message));
    });

    req.write(postData);
    req.end();
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function recognizeReceipt(imageBase64) {
  return callOcr(imageBase64, GENERAL_BASIC_URL);
}

async function recognizeHighPrecision(imageBase64) {
  return callOcr(imageBase64, ACCURATE_BASIC_URL);
}

// ─── Transaction Info Extraction ──────────────────────────────────────────────

/** Maximum reasonable amount for a single personal transaction (inclusive) */
const MAX_OCR_AMOUNT = 500000;

/** Return true if the amount looks plausible for a single transaction */
function isPlausibleAmount(v) {
  return v > 0 && v <= MAX_OCR_AMOUNT;
}

/**
 * Parse a date line like "6月22日 16:07" → "2026-06-22".
 * Uses current year when the year is not present in the text.
 */
function parseDateLine(line) {
  // Full date patterns (with year)
  const fullPatterns = [
    /\d{4}[-/]\d{1,2}[-/]\d{1,2}/,
    /\d{4}\.\d{1,2}\.\d{1,2}/,
    /\d{4}年\d{1,2}月\d{1,2}日/,
    /\d{1,2}[-/]\d{1,2}[-/]\d{4}/,  // MM/DD/YYYY
  ];
  for (const pattern of fullPatterns) {
    const match = line.match(pattern);
    if (match) {
      const raw = match[0];
      const normalised = raw
        .replace(/[年月]/g, '-')
        .replace(/[日]/g, '')
        .replace(/[\/\.]/g, '-');
      const parts = normalised.split('-');
      let datePart;
      if (parts.length === 3) {
        let [a, b, c] = parts;
        if (parseInt(a) > 31) {
          datePart = `${a}-${b.padStart(2, '0')}-${c.padStart(2, '0')}`;
        } else if (parseInt(c) > 31) {
          datePart = `${c}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
        } else {
          datePart = `${a}-${b.padStart(2, '0')}-${c.padStart(2, '0')}`;
        }
      } else {
        datePart = normalised;
      }
      const timeMatch2 = line.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (timeMatch2) {
        const h = String(timeMatch2[1]).padStart(2, '0');
        return `${datePart} ${h}:${timeMatch2[2]}:${timeMatch2[3] || '00'}`;
      }
      return datePart;
    }
  }

  // Short date patterns (month-day only, no year)
  // e.g. "6月22日", "6月22日 16:07", "06-22"
  const shortPatterns = [
    /(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /(\d{1,2})[-/](\d{1,2})(?![\d])/,
  ];
  const now = new Date();
  const thisYear = now.getFullYear();
  for (const pattern of shortPatterns) {
    const match = line.match(pattern);
    if (match) {
      const month = parseInt(match[1]);
      const day = parseInt(match[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        // If the date is in the future, use previous year
        let year = thisYear;
        const candidate = new Date(year, month - 1, day);
        if (candidate > now) year--;
        const datePart = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        // Check for time after the date
        const timeMatch = line.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (timeMatch) {
          const h = String(timeMatch[1]).padStart(2, '0');
          const m = timeMatch[2];
          const s = timeMatch[3] || '00';
          return `${datePart} ${h}:${m}:${s}`;
        }
        return datePart;
      }
    }
  }

  return null;
}

/**
 * Try to match a line as an amount. Returns { amount, type } or null.
 * Handles these Chinese payment OCR formats:
 *   -12.50 / +100.00            (signed amount)
 *   -¥12.50 / +¥100.00          (signed with currency)
 *   ¥12.50                      (currency prefix → expense)
 *   支出 ¥12.50 / 消费 12.50     (expense keyword)
 *   收入 ¥100.00 / 收款 100.00   (income keyword)
 */
function matchAmountLine(line) {
  // Signed amount: optional ¥/￥, captures sign and number
  let m = line.match(/^([+-])\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)$/);
  if (m) {
    const amount = parseFloat(m[2]);
    if (isPlausibleAmount(amount)) {
      return { amount, type: m[1] === '+' ? 1 : 0 };
    }
  }

  // Currency prefix (no sign): ¥12.50 → expense
  m = line.match(/^[¥￥]\s*(\d+(?:\.\d{1,2})?)$/);
  if (m) {
    const amount = parseFloat(m[1]);
    if (isPlausibleAmount(amount)) {
      return { amount, type: 0 };
    }
  }

  // Expense keywords
  m = line.match(/(?:支出|消费|付款|扣款|扣费|支取)\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/);
  if (m) {
    const amount = parseFloat(m[1]);
    if (isPlausibleAmount(amount)) {
      return { amount, type: 0 };
    }
  }

  // Income keywords
  m = line.match(/(?:收入|收款|退款|入账|存入)\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/);
  if (m) {
    const amount = parseFloat(m[1]);
    if (isPlausibleAmount(amount)) {
      return { amount, type: 1 };
    }
  }

  return null;
}

/**
 * Check if a line is a bare time (HH:MM or HH:MM:SS), not part of a date.
 */
function isTimeOnlyLine(line) {
  return /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.test(line);
}

/**
 * Extract ALL transactions from OCR raw text.
 *
 * Handles both single receipts and multi-transaction bank/wechat statement
 * screenshots. The OCR output for statements follows this pattern per entry:
 *
 *   <Merchant Name>
 *   <Amount with prefix>
 *   [Optional Extra Text]
 *   <Date> [Time]
 */
function extractTransactions(rawText) {
  const lines = (rawText || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const transactions = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const amountInfo = matchAmountLine(line);
    if (!amountInfo) continue;

    const { amount, type } = amountInfo;
    if (isNaN(amount) || amount === 0) continue;

    // Merchant: the line immediately before the amount
    let merchant = null;
    if (i > 0) {
      const prevLine = lines[i - 1];
      if (!matchAmountLine(prevLine) && !parseDateLine(prevLine) && !isTimeOnlyLine(prevLine)) {
        merchant = prevLine;
      }
    }

    // Date: look up to 2 lines after the amount (skip 1 optional line)
    let date = null;
    let dateLineIdx = -1;
    for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
      date = parseDateLine(lines[j]);
      if (date) { dateLineIdx = j; break; }
    }

    // If date has no time, check if the very next line is a bare time
    if (date && !date.includes(' ') && dateLineIdx >= 0 && dateLineIdx + 1 < lines.length) {
      const timeOnlyMatch = lines[dateLineIdx + 1].match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (timeOnlyMatch) {
        const h = String(timeOnlyMatch[1]).padStart(2, '0');
        date = `${date} ${h}:${timeOnlyMatch[2]}:${timeOnlyMatch[3] || '00'}`;
      }
    }

    // If no date (or date without time), look above the amount.
    if (!date || !date.includes(' ')) {
      // Check immediate above: date(+time) at i-1
      if (i > 0) {
        const oneBackDate = parseDateLine(lines[i - 1]);
        if (oneBackDate && (!date || !date.includes(' '))) {
          date = oneBackDate;
          if (merchant === lines[i - 1]) merchant = null;
        }
      }
      // Check i-2 for date when i-1 is a time-only line
      if ((!date || !date.includes(' ')) && i >= 2) {
        const twoBack = lines[i - 2];
        const prevLine = lines[i - 1];
        const twoBackDate = parseDateLine(twoBack);
        if (twoBackDate && isTimeOnlyLine(prevLine)) {
          const tm = prevLine.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
          date = `${twoBackDate} ${String(tm[1]).padStart(2, '0')}:${tm[2]}:${tm[3] || '00'}`;
        }
      }
      // Check i-2 for date when i-1 is merchant (date, merchant, amount pattern)
      if ((!date || !date.includes(' ')) && i >= 2) {
        const twoBackDate = parseDateLine(lines[i - 2]);
        if (twoBackDate && merchant && merchant === lines[i - 1]) {
          date = twoBackDate;
        }
      }
      // Check i-3 for date when i-2,i-1 are time,merchant (date, time, merchant, amount)
      if ((!date || !date.includes(' ')) && i >= 3) {
        const threeBackDate = parseDateLine(lines[i - 3]);
        if (threeBackDate && isTimeOnlyLine(lines[i - 2])) {
          const tm = lines[i - 2].match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
          date = `${threeBackDate} ${String(tm[1]).padStart(2, '0')}:${tm[2]}:${tm[3] || '00'}`;
        }
      }
    }

    // Extra text between amount and date (e.g. "校园", "完美")
    let extra = '';
    if (!date && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      if (!matchAmountLine(nextLine)) {
        if (i + 2 < lines.length) {
          const dateMatch = parseDateLine(lines[i + 2]);
          if (dateMatch) {
            extra = nextLine;
            date = dateMatch;
          }
        }
      }
    }

    // Ensure date has time component
    let finalDate = date || new Date().toISOString().slice(0, 10);
    if (finalDate && !finalDate.includes(' ')) {
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      finalDate = `${finalDate} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }

    const merchantText = merchant || '未知商户';
    transactions.push({
      amount: Math.abs(amount),
      type: type,
      merchant: merchantText,
      date: finalDate,
      extra: extra,
      category_id: autoCategorize(merchantText + ' ' + extra, type),
    });
  }

  return transactions;
}

/**
 * Extract a single transaction from OCR text.
 * Kept for backward compatibility with the original API.
 */
function extractTransactionInfo(rawText) {
  const transactions = extractTransactions(rawText);
  if (transactions.length > 0) {
    const t = transactions[0];
    return {
      amount: t.type === 0 ? -t.amount : t.amount,
      merchant: t.merchant,
      date: t.date,
      rawText,
      transactions: transactions,  // include all for multi-import
    };
  }

  // Fallback: old single-transaction logic for receipts
  const lines = (rawText || '').split('\n').map(s => s.trim()).filter(Boolean);
  let amount = null;
  const amountLinePatterns = [
    /(?:付款金额|支付金额|实付|实收|合计|总计|消费|订单金额|交易金额|扣费)\s*[：:＝=]?\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/,
    /[¥￥]\s*(\d+(?:\.\d{1,2})?)/,
    /(\d+(?:\.\d{1,2})?)\s*元/,
    /(?:amount|total)\s*[：:＝=]?\s*[¥￥$]?\s*(\d+(?:\.\d{1,2})?)/i,
  ];
  for (const line of lines) {
    for (const pattern of amountLinePatterns) {
      const match = line.match(pattern);
      if (match) { amount = parseFloat(match[1]); break; }
    }
    if (amount !== null) break;
  }
  if (amount === null) {
    let bestAmount = null;
    for (const line of lines) {
      const numbers = line.match(/\d+(?:\.\d{1,2})?/g);
      if (!numbers) continue;
      for (const n of numbers) {
        const v = parseFloat(n);
        if (v >= 1 && v <= 100000 && (bestAmount === null || v > bestAmount)) bestAmount = v;
      }
    }
    amount = bestAmount;
  }

  let merchant = null;
  const merchantPatterns = [
    /(?:收款方|商户名称|商户|商家|店铺|收款账户|商品说明|付款给)\s*[：:＝=]?\s*(.+)/,
  ];
  for (const line of lines) {
    for (const pattern of merchantPatterns) {
      const match = line.match(pattern);
      if (match && match[1].trim().length <= 40) { merchant = match[1].trim(); break; }
    }
    if (merchant) break;
  }
  if (!merchant) {
    const candidates = lines.filter(l =>
      !/^\d/.test(l) && !/\d$/.test(l) && l.length <= 25 &&
      !/微信|支付|付款|收款|合计|总计|谢谢|欢迎|小票|凭据|订单号|交易单号|商户单号|支付时间|交易时间/.test(l)
    );
    if (candidates.length > 0) {
      merchant = candidates.reduce((a, b) => (a.length <= b.length ? a : b));
    }
  }

  let date = null;
  let dateIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    date = parseDateLine(lines[i]);
    if (date) { dateIdx = i; break; }
  }
  // If date has no time, check the next line for a bare time
  if (date && !date.includes(' ') && dateIdx >= 0 && dateIdx + 1 < lines.length) {
    const timeOnlyMatch = lines[dateIdx + 1].match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (timeOnlyMatch) {
      const h = String(timeOnlyMatch[1]).padStart(2, '0');
      date = `${date} ${h}:${timeOnlyMatch[2]}:${timeOnlyMatch[3] || '00'}`;
    }
  }
  if (!date) date = new Date().toISOString().slice(0, 10);
  // Ensure date has time
  if (date && !date.includes(' ')) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    date = `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  const category_id = amount ? autoCategorize(merchant || '', amount < 0 ? 0 : 1) : null;

  return { amount, merchant, date, rawText, transactions: [], category_id };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  recognizeReceipt,
  recognizeHighPrecision,
  recognizePaddle,
  isPaddleAvailable,
  extractTransactionInfo,
};

// ─── Self-Test ────────────────────────────────────────────────────────────────

if (require.main === module) {
  const path = require('path');
  const fs = require('fs');
  const testDbPath = path.join(__dirname, 'accounting-test.db');

  // Clean up previous test DB so we start fresh
  try { fs.unlinkSync(testDbPath); } catch (e) { /* ok */ }
  try { fs.unlinkSync(testDbPath + '-wal'); } catch (e) { /* ok */ }
  try { fs.unlinkSync(testDbPath + '-shm'); } catch (e) { /* ok */ }

  console.log('=== ocr.js self-test ===\n');

  (async () => {
    const { initDatabase, setSetting } = require('./database');
    await initDatabase();

    // Test 1: Module exports
    console.log('1. Module exports check...');
    console.log('   recognizeReceipt:', typeof recognizeReceipt);
    console.log('   recognizeHighPrecision:', typeof recognizeHighPrecision);
    console.log('   extractTransactionInfo:', typeof extractTransactionInfo);

    // Test 2: Credentials error (no credentials set in fresh DB)
    console.log('\n2. Missing credentials error...');
    try {
      await recognizeReceipt('fakebase64');
      console.log('   ERROR: should have thrown!');
    } catch (e) {
      console.log('   Correctly threw:', e.message);
    }

    // Test 3: stripDataUrlPrefix
    console.log('\n3. Data URL prefix stripping...');
    const testInput = 'data:image/png;base64,iVBORw0KGgo=';
    const stripped = stripDataUrlPrefix(testInput);
    console.log('   Input :', testInput.substring(0, 40) + '...');
    console.log('   Output:', stripped);
    console.log('   Pass  :', stripped === 'iVBORw0KGgo=');

    // Test 4: extractTransactionInfo
    console.log('\n4. extractTransactionInfo tests...');

    const sample1 = [
      '星巴克咖啡（中国）有限公司',
      '上海市南京西路1515号',
      '2024-06-15',
      '拿铁咖啡',
      '￥38.00',
      '合计：38.00',
      '实收：38.00',
      '谢谢惠顾',
    ].join('\n');

    const info1 = extractTransactionInfo(sample1);
    console.log('   Sample 1 (Starbucks receipt):');
    console.log('     amount:', info1.amount, '(expected 38)');
    console.log('     merchant:', info1.merchant);
    console.log('     date:', info1.date, '(expected 2024-06-15)');

    const sample2 = [
      '超市购物小票',
      '农夫山泉  2.00',
      '方便面    5.50',
      '合计：7.50元',
    ].join('\n');

    const info2 = extractTransactionInfo(sample2);
    console.log('\n   Sample 2 (total ending in 元):');
    console.log('     amount:', info2.amount, '(expected 7.5)');
    console.log('     merchant:', info2.merchant);
    console.log('     date:', info2.date, '(expected today)');

    const sample3 = '午餐\n¥25.00';
    const info3 = extractTransactionInfo(sample3);
    console.log('\n   Sample 3 (no date):');
    console.log('     amount:', info3.amount, '(expected 25)');
    console.log('     date:', info3.date, '(expected today)');

    const sample4 = '2024/12/01\n书店\n￥45.00';
    const info4 = extractTransactionInfo(sample4);
    console.log('\n   Sample 4 (YYYY/MM/DD date):');
    console.log('     date:', info4.date, '(expected 2024-12-01)');
    console.log('     amount:', info4.amount, '(expected 45)');

    const sample5 = '2024年3月15日\n餐厅\n￥88.00';
    const info5 = extractTransactionInfo(sample5);
    console.log('\n   Sample 5 (Chinese date):');
    console.log('     date:', info5.date, '(expected 2024-03-15)');
    console.log('     amount:', info5.amount, '(expected 88)');

    // Test 5: Get token + OCR with real credentials (from secrets.json if available)
    console.log('\n5. Token fetch + OCR test...');
    let secrets = {};
    try {
      const secretsPath = path.join(__dirname, 'secrets.json');
      if (fs.existsSync(secretsPath)) {
        secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
      }
    } catch (e) { /* ignore */ }
    const ocrCfg = (secrets && secrets.baidu_ocr) ? secrets.baidu_ocr : {};
    setSetting('app_id', ocrCfg.app_id || '');
    setSetting('api_key', ocrCfg.api_key || '');
    setSetting('secret_key', ocrCfg.secret_key || '');

    try {
      if (!ocrCfg.app_id) throw new Error('未配置 secrets.json，跳过 OCR 测试');
      const token = await getAccessToken();
      console.log('   Token obtained:', token.substring(0, 20) + '...');

      // Minimal 1x1 PNG as test image (valid base64)
      const testPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const result = await recognizeReceipt(testPngBase64);
      console.log('   OCR call succeeded!');
      console.log('   rawText length:', result.rawText.length);
      console.log('   words_result count:', result.wordsResult.words_result ? result.wordsResult.words_result.length : 0);
    } catch (err) {
      console.log('   OCR call error:', err.message);
    }

    // Clean up test database
    [testDbPath, testDbPath + '-wal', testDbPath + '-shm'].forEach(f => {
      try { fs.unlinkSync(f); } catch (e) { /* ok */ }
    });
    console.log('\nTest database cleaned up.');
    console.log('\n=== All tests passed! ===');
  })();
}
