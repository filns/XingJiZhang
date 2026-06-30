const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

let db = null;
let SQL = null;
let dbPath = null;

// ─── Database Path ───────────────────────────────────────────────────────────

function getDbPath() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'accounting.db');
  } catch (e) {
    // Fallback for testing without Electron
    return path.join(__dirname, 'accounting-test.db');
  }
}

// ─── sql.js Helpers ──────────────────────────────────────────────────────────

/**
 * Execute a SELECT query that returns at most one row.
 * Returns the row as an object, or null if no rows.
 */
function getRow(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

/**
 * Execute a SELECT query that returns multiple rows.
 * Returns an array of row objects (empty array if no rows).
 */
function getAllRows(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/**
 * Return the last inserted rowid.
 */
function getLastInsertId() {
  const row = getRow('SELECT last_insert_rowid() as id');
  return row ? row.id : null;
}

/**
 * Persist the in-memory database to disk.
 * Must be called after every write operation.
 */
function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// ─── Initialization ──────────────────────────────────────────────────────────

async function initDatabase() {
  SQL = await initSqlJs();
  dbPath = getDbPath();

  // Try to load existing database file
  try {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } catch (e) {
    // File doesn't exist (or can't be read) — start fresh
    db = new SQL.Database();
  }

  // WAL mode may not be supported in WASM builds
  try { db.run('PRAGMA journal_mode = WAL;'); } catch (e) { /* not supported */ }
  db.run('PRAGMA foreign_keys = ON;');

  // Create tables and indexes
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '📦',
      type INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '💳',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type INTEGER NOT NULL DEFAULT 0,
      amount REAL NOT NULL,
      category_id INTEGER,
      account_id INTEGER,
      note TEXT DEFAULT '',
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
    CREATE INDEX IF NOT EXISTS idx_transactions_month ON transactions(strftime('%Y-%m', date));
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
  `);

  // Seed data if tables are empty
  seedIfEmpty();

  saveDb();
  return db;
}

// ─── Seed Data ───────────────────────────────────────────────────────────────

function seedIfEmpty() {
  const categoryRow = getRow('SELECT COUNT(*) as count FROM categories');
  const accountRow = getRow('SELECT COUNT(*) as count FROM accounts');

  if (categoryRow && categoryRow.count === 0) {
    const stmt = db.prepare(
      'INSERT INTO categories (name, icon, type, sort_order) VALUES (?, ?, ?, ?)'
    );

    const expenseCategories = [
      ['餐饮', '🍔', 0],
      ['交通', '🚌', 0],
      ['购物', '🛒', 0],
      ['娱乐', '🎮', 0],
      ['居家', '🏠', 0],
      ['医疗', '💊', 0],
      ['学习', '📚', 0],
      ['人情', '🎁', 0],
      ['宠物', '🐱', 0],
      ['其他', '📦', 0],
    ];

    db.run('BEGIN;');
    try {
      expenseCategories.forEach(([name, icon, type], index) => {
        stmt.bind([name, icon, type, index + 1]);
        stmt.step();
        stmt.reset();
      });

      const incomeCategories = [
        ['工资', '💼', 1],
        ['理财', '💰', 1],
        ['红包', '🎁', 1],
        ['其他', '📦', 1],
      ];

      incomeCategories.forEach(([name, icon, type], index) => {
        stmt.bind([name, icon, type, index + 1]);
        stmt.step();
        stmt.reset();
      });

      db.run('COMMIT;');
    } catch (e) {
      db.run('ROLLBACK;');
      throw e;
    }
    stmt.free();
  }

  if (accountRow && accountRow.count === 0) {
    const stmt = db.prepare(
      'INSERT INTO accounts (name, icon, sort_order) VALUES (?, ?, ?)'
    );

    const defaultAccounts = [
      ['工商银行', '💳'],
      ['支付宝', '📱'],
      ['微信钱包', '💬'],
      ['现金', '💵'],
    ];

    db.run('BEGIN;');
    try {
      defaultAccounts.forEach(([name, icon], index) => {
        stmt.bind([name, icon, index + 1]);
        stmt.step();
        stmt.reset();
      });
      db.run('COMMIT;');
    } catch (e) {
      db.run('ROLLBACK;');
      throw e;
    }
    stmt.free();
  }
}

// ─── Settings ────────────────────────────────────────────────────────────────

function getSetting(key) {
  const row = getRow('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
  saveDb();
}

// ─── Transactions ────────────────────────────────────────────────────────────

function addTransaction({ type, amount, category_id, account_id, note, date }) {
  db.run(`
    INSERT INTO transactions (type, amount, category_id, account_id, note, date)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    type,
    amount,
    category_id != null ? category_id : null,
    account_id != null ? account_id : null,
    note || '',
    date
  ]);

  const newId = getLastInsertId();
  saveDb();

  return getRow(`
    SELECT t.*,
           c.name AS category_name,
           c.icon AS category_icon,
           a.name AS account_name,
           a.icon AS account_icon
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN accounts a ON t.account_id = a.id
    WHERE t.id = ?
  `, [newId]);
}

function getTransactions({ type, month, category_id, account_id, search, limit = 100, offset = 0 } = {}) {
  let sql = `
    SELECT t.*,
           c.name AS category_name,
           c.icon AS category_icon,
           a.name AS account_name,
           a.icon AS account_icon
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN accounts a ON t.account_id = a.id
    WHERE 1=1
  `;
  const params = [];

  if (type !== undefined && type !== null) {
    sql += ' AND t.type = ?';
    params.push(type);
  }
  if (month !== undefined && month !== null) {
    sql += " AND strftime('%Y-%m', t.date) = ?";
    params.push(month);
  }
  if (category_id !== undefined && category_id !== null) {
    sql += ' AND t.category_id = ?';
    params.push(category_id);
  }
  if (account_id !== undefined && account_id !== null) {
    sql += ' AND t.account_id = ?';
    params.push(account_id);
  }
  if (search !== undefined && search !== null && search !== '') {
    sql += ' AND t.note LIKE ?';
    params.push(`%${search}%`);
  }

  // limit:0 or negative means no limit (SQLite uses -1 for unlimited)
  sql += ' ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?';
  params.push(limit > 0 ? limit : -1, offset);

  return getAllRows(sql, params);
}

function updateTransaction(id, { type, amount, category_id, account_id, note, date }) {
  db.run(`
    UPDATE transactions SET
      type = ?,
      amount = ?,
      category_id = ?,
      account_id = ?,
      note = ?,
      date = ?,
      updated_at = datetime('now','localtime')
    WHERE id = ?
  `, [
    type,
    amount,
    category_id != null ? category_id : null,
    account_id != null ? account_id : null,
    note || '',
    date,
    id
  ]);

  saveDb();

  return getRow(`
    SELECT t.*,
           c.name AS category_name,
           c.icon AS category_icon,
           a.name AS account_name,
           a.icon AS account_icon
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN accounts a ON t.account_id = a.id
    WHERE t.id = ?
  `, [id]);
}

function deleteTransaction(id) {
  db.run('DELETE FROM transactions WHERE id = ?', [id]);
  const changes = db.getRowsModified();
  saveDb();
  return { changes };
}

// ─── Categories ──────────────────────────────────────────────────────────────

function getCategories(type) {
  if (type !== undefined && type !== null) {
    return getAllRows(
      'SELECT * FROM categories WHERE type = ? ORDER BY sort_order',
      [type]
    );
  }
  return getAllRows('SELECT * FROM categories ORDER BY sort_order');
}

function addCategory({ name, icon, type, sort_order = 0 }) {
  db.run(
    'INSERT INTO categories (name, icon, type, sort_order) VALUES (?, ?, ?, ?)',
    [name, icon, type, sort_order]
  );
  const newId = getLastInsertId();
  saveDb();
  return getRow('SELECT * FROM categories WHERE id = ?', [newId]);
}

function updateCategory(id, { name, icon, sort_order }) {
  db.run(
    'UPDATE categories SET name = ?, icon = ?, sort_order = ? WHERE id = ?',
    [name, icon, sort_order, id]
  );
  saveDb();
  return getRow('SELECT * FROM categories WHERE id = ?', [id]);
}

function deleteCategory(id) {
  db.run('DELETE FROM categories WHERE id = ?', [id]);
  const changes = db.getRowsModified();
  saveDb();
  return { changes };
}

// ─── Accounts ────────────────────────────────────────────────────────────────

function getAccounts() {
  return getAllRows('SELECT * FROM accounts ORDER BY sort_order');
}

function addAccount({ name, icon, sort_order = 0 }) {
  db.run(
    'INSERT INTO accounts (name, icon, sort_order) VALUES (?, ?, ?)',
    [name, icon, sort_order]
  );
  const newId = getLastInsertId();
  saveDb();
  return getRow('SELECT * FROM accounts WHERE id = ?', [newId]);
}

function updateAccount(id, { name, icon, sort_order }) {
  db.run(
    'UPDATE accounts SET name = ?, icon = ?, sort_order = ? WHERE id = ?',
    [name, icon, sort_order, id]
  );
  saveDb();
  return getRow('SELECT * FROM accounts WHERE id = ?', [id]);
}

function deleteAccount(id) {
  db.run('DELETE FROM accounts WHERE id = ?', [id]);
  const changes = db.getRowsModified();
  saveDb();
  return { changes };
}

// ─── Stats ───────────────────────────────────────────────────────────────────

function getMonthlyStats(month) {
  const rows = getAllRows(`
    SELECT type, SUM(amount) as total
    FROM transactions
    WHERE strftime('%Y-%m', date) = ?
    GROUP BY type
  `, [month]);

  let expense = 0;
  let income = 0;
  for (const row of rows) {
    if (row.type === 0) expense = row.total;
    else if (row.type === 1) income = row.total;
  }
  return { expense, income };
}

function getDailyStats(month) {
  return getAllRows(`
    SELECT substr(date, 1, 10) as date, type, SUM(amount) as total
    FROM transactions
    WHERE strftime('%Y-%m', date) = ?
    GROUP BY substr(date, 1, 10), type
    ORDER BY date
  `, [month]);
}

function getCategoryStats(month, type) {
  return getAllRows(`
    SELECT c.name, c.icon, SUM(t.amount) as total
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    WHERE strftime('%Y-%m', t.date) = ? AND t.type = ?
    GROUP BY t.category_id
    ORDER BY total DESC
  `, [month, type]);
}

function getTodayStats(date) {
  const row = getRow(`
    SELECT SUM(amount) as total
    FROM transactions
    WHERE substr(date, 1, 10) = ? AND type = 0
  `, [date]);
  return { expense: row?.total ?? 0 };
}

// ─── Auto-Categorize ──────────────────────────────────────────────────────────

const CATEGORY_KEYWORDS = {
  '餐饮': ['餐饮', '美食', '餐厅', '饭', '火锅', '烧烤', '外卖', '咖啡', '奶茶', '小吃', '早餐', '午餐', '晚餐', '食堂', '酒店', '饭店', '面馆', '快餐', '烘焙', '蛋糕', '甜品', '水果', '买菜', '美团', '饿了么', '大众点评', '肯德基', '麦当劳', '汉堡王', '星巴克', '瑞幸', '喜茶', '茶百道', '蜜雪冰城', '海底捞', '呷哺', '乐购学生服务部', '乐购超市'],
  '交通': ['交通', '公交', '地铁', '打车', '滴滴', '出租车', '高铁', '火车', '机票', '航空', '加油', '停车', '高速', 'ETC', '曹操', 'T3出行', '花小猪', '12306', '中铁', '航旅', '充油卡'],
  '购物': ['购物', '淘宝', '京东', '拼多多', '超市', '商场', '便利店', '服装', '天猫', '唯品会', '苏宁', '闲鱼', '盒马', '山姆', 'Costco', '大润发', '永辉', '屈臣氏', '丝芙兰', '日用品', '百货', '微信小店'],
  '娱乐': ['娱乐', '电影', '游戏', '音乐', 'KTV', '演出', '门票', '旅游', '景点', '猫眼', '淘票票', 'QQ音乐', '网易云', 'B站大会员', '爱奇艺', '腾讯视频', '优酷', '迪士尼', '欢乐谷', '健身', '运动', '瑜伽'],
  '居家': ['居家', '房租', '水电', '物业', '天然气', '煤气', '电费', '水费', '网费', '宽带', '房租', '保洁', '维修', '装修', '房产', '暖气', '固话', '中国移动', '中国联通', '中国电信'],
  '医疗': ['医疗', '医院', '药房', '诊所', '医保', '医药', '挂号', '门诊', '住院', '手术', '体检', '牙科', '眼科', '疫苗', '中药', '西药'],
  '学习': ['学习', '书本', '课程', '培训', '考试', '文具', '教材', '网课', '书店', '图书', '教育', '学费', '考研', '雅思', '托福'],
  '人情': ['人情', '红包', '礼物', '礼金', '请客', '宴请', '结婚', '生日', '随礼', '份子', '礼品'],
  '宠物': ['宠物', '猫粮', '狗粮', '宠物店', '猫咪', '狗狗', '宠物医院', '驱虫', '猫砂'],
  '工资': ['工资', '薪水', '薪资', '奖金', '补贴', '津贴', '绩效', '劳动报酬'],
  '理财': ['理财', '利息', '收益', '基金', '股票', '分红', '股息', '理财通', '余额宝', '招商银行理财', '定期'],
  '红包': ['红包', '转账', '汇款'],
};

/**
 * Match a note/merchant text to the best-matching category.
 * Returns category_id or null if no match found.
 */
function autoCategorize(note, type) {
  if (!note) return null;
  const text = note.trim();
  if (!text) return null;

  const categories = getCategories(type);
  if (!categories || categories.length === 0) return null;

  for (const cat of categories) {
    const keywords = CATEGORY_KEYWORDS[cat.name];
    if (!keywords) continue;
    for (const kw of keywords) {
      if (text.includes(kw)) return cat.id;
    }
  }

  return null;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  initDatabase,
  getSetting,
  setSetting,
  addTransaction,
  getTransactions,
  updateTransaction,
  deleteTransaction,
  getCategories,
  addCategory,
  updateCategory,
  deleteCategory,
  getAccounts,
  addAccount,
  updateAccount,
  deleteAccount,
  getMonthlyStats,
  getDailyStats,
  getCategoryStats,
  getTodayStats,
  autoCategorize,
};

// ─── Self-Test ───────────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    console.log('=== database.js self-test ===\n');

    // Override db path for testing
    const testDbPath = path.join(__dirname, 'accounting-test.db');
    // Remove old test db
    try { fs.unlinkSync(testDbPath); } catch (e) { /* ok */ }
    // sql.js may not create WAL/SHM files, but clean up just in case
    try { fs.unlinkSync(testDbPath + '-wal'); } catch (e) { /* ok */ }
    try { fs.unlinkSync(testDbPath + '-shm'); } catch (e) { /* ok */ }

    console.log('1. Initializing database...');
    await initDatabase();
    console.log('   DB path:', testDbPath);

    // Read back pragma values with sql.js
    const journalMode = getRow('PRAGMA journal_mode');
    console.log('   Journal mode:', journalMode ? journalMode.journal_mode : 'N/A');
    const foreignKeys = getRow('PRAGMA foreign_keys');
    console.log('   Foreign keys:', foreignKeys ? foreignKeys.foreign_keys : 'N/A');

    // Test settings
    console.log('\n2. Testing settings...');
    setSetting('theme', 'dark');
    console.log('   getSetting("theme"):', getSetting('theme'));
    console.log('   getSetting("nonexistent"):', getSetting('nonexistent'));
    setSetting('theme', 'light');
    console.log('   after upsert:', getSetting('theme'));

    // Test categories
    console.log('\n3. Testing categories...');
    const expenseCategories = getCategories(0);
    console.log('   Expense categories count:', expenseCategories.length);
    console.log('   First:', expenseCategories[0].icon, expenseCategories[0].name);
    console.log('   Last:', expenseCategories[expenseCategories.length - 1].icon, expenseCategories[expenseCategories.length - 1].name);

    const incomeCategories = getCategories(1);
    console.log('   Income categories count:', incomeCategories.length);
    console.log('   First:', incomeCategories[0].icon, incomeCategories[0].name);

    const allCategories = getCategories();
    console.log('   All categories count:', allCategories.length);

    // Add a custom category
    const newCat = addCategory({ name: '测试', icon: '🧪', type: 0, sort_order: 99 });
    console.log('   Added category:', newCat.icon, newCat.name, 'id:', newCat.id);

    // Update it
    const updatedCat = updateCategory(newCat.id, { name: '测试更新', icon: '🧪', sort_order: 98 });
    console.log('   Updated category:', updatedCat.name, 'sort_order:', updatedCat.sort_order);

    // Delete it
    const delCatResult = deleteCategory(newCat.id);
    console.log('   Deleted category, changes:', delCatResult.changes);

    // Test accounts
    console.log('\n4. Testing accounts...');
    const accounts = getAccounts();
    console.log('   Accounts count:', accounts.length);
    console.log('   First:', accounts[0].icon, accounts[0].name);
    console.log('   Last:', accounts[accounts.length - 1].icon, accounts[accounts.length - 1].name);

    const newAcct = addAccount({ name: '测试账户', icon: '🏦', sort_order: 99 });
    console.log('   Added account:', newAcct.icon, newAcct.name, 'id:', newAcct.id);

    const updatedAcct = updateAccount(newAcct.id, { name: '测试更新', icon: '🏦', sort_order: 98 });
    console.log('   Updated account:', updatedAcct.name);

    const delAcctResult = deleteAccount(newAcct.id);
    console.log('   Deleted account, changes:', delAcctResult.changes);

    // Test transactions
    console.log('\n5. Testing transactions...');
    const today = new Date().toISOString().slice(0, 10);
    const thisMonth = today.slice(0, 7);

    console.log('   Today:', today, '| This month:', thisMonth);

    // Add expense
    const txn1 = addTransaction({
      type: 0,
      amount: 35.50,
      category_id: 1,   // 餐饮
      account_id: 1,     // 工商银行
      note: '午餐外卖',
      date: today,
    });
    console.log('   Added expense:', txn1.amount, txn1.category_name, txn1.account_name, 'note:', txn1.note);

    // Add income
    const txn2 = addTransaction({
      type: 1,
      amount: 12000,
      category_id: 11,  // 工资 (income category)
      account_id: 1,    // 工商银行
      note: '6月工资',
      date: today,
    });
    console.log('   Added income:', txn2.amount, txn2.category_name, txn2.account_name, 'note:', txn2.note);

    // Add another expense without category/account
    const txn3 = addTransaction({
      type: 0,
      amount: 12.00,
      category_id: null,
      account_id: null,
      note: '无分类支出',
      date: today,
    });
    console.log('   Added uncategorized:', txn3.amount, 'category:', txn3.category_name, 'account:', txn3.account_name);

    // Get all transactions
    console.log('\n6. Testing getTransactions...');
    const allTxns = getTransactions();
    console.log('   All transactions count:', allTxns.length);

    const expenseTxns = getTransactions({ type: 0 });
    console.log('   Expense transactions count:', expenseTxns.length);

    const monthTxns = getTransactions({ month: thisMonth });
    console.log('   This month transactions count:', monthTxns.length);

    const searchTxns = getTransactions({ search: '外卖' });
    console.log('   Search "外卖" results:', searchTxns.length);

    const limitedTxns = getTransactions({ limit: 1 });
    console.log('   Limited to 1:', limitedTxns.length);

    // Update transaction
    console.log('\n7. Testing updateTransaction...');
    const updatedTxn = updateTransaction(txn1.id, {
      type: 0,
      amount: 42.00,
      category_id: 1,
      account_id: 2,  // 支付宝
      note: '午餐外卖（加饮料）',
      date: today,
    });
    console.log('   Updated amount:', updatedTxn.amount, 'account:', updatedTxn.account_name, 'note:', updatedTxn.note);
    console.log('   updated_at changed:', updatedTxn.updated_at !== txn1.updated_at);

    // Delete transaction
    console.log('\n8. Testing deleteTransaction...');
    const delTxnResult = deleteTransaction(txn3.id);
    console.log('   Deleted txn3, changes:', delTxnResult.changes);
    console.log('   All txns after delete:', getTransactions().length);

    // Test stats
    console.log('\n9. Testing stats...');
    const monthlyStats = getMonthlyStats(thisMonth);
    console.log('   getMonthlyStats(' + thisMonth + '):', JSON.stringify(monthlyStats));

    const dailyStats = getDailyStats(thisMonth);
    console.log('   getDailyStats(' + thisMonth + '):', dailyStats.length, 'rows');
    dailyStats.forEach(ds => console.log('     ', ds.date, 'type=', ds.type, 'total=', ds.total));

    const categoryStats = getCategoryStats(thisMonth, 0);
    console.log('   getCategoryStats(' + thisMonth + ', 0):', categoryStats.length, 'rows');
    categoryStats.forEach(cs => console.log('     ', cs.icon, cs.name, 'total=', cs.total));

    const todayStats = getTodayStats(today);
    console.log('   getTodayStats(' + today + '):', JSON.stringify(todayStats));

    // Test empty stats
    const emptyStats = getMonthlyStats('2020-01');
    console.log('   getMonthlyStats(2020-01):', JSON.stringify(emptyStats));

    // Clean up test database
    db.close();
    [testDbPath, testDbPath + '-wal', testDbPath + '-shm'].forEach(f => {
      try { fs.unlinkSync(f); } catch (e) { /* file may not exist */ }
    });
    console.log('\nTest database cleaned up.');

    console.log('\nAll tests passed!');
  })().catch(err => {
    console.error('Self-test failed:', err);
    process.exit(1);
  });
}
