// ═══════════════════════════════════════════════════════════════════════
// Accounting App — Renderer JavaScript
// ═══════════════════════════════════════════════════════════════════════

// ─── Utility Functions ──────────────────────────────────────────────────

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function formatMoney(amount) {
  return '¥' + (Number(amount) || 0).toFixed(2);
}

function getToday() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function getTodayDateOnly() {
  return getToday().slice(0, 10);
}

function getCurrentMonth() {
  return getToday().slice(0, 7);
}

/** Convert "YYYY-MM-DD HH:MM:SS" to "YYYY-MM-DDTHH:MM:SS" for datetime-local input */
function toDatetimeLocal(dateStr) {
  if (!dateStr) return '';
  return dateStr.replace(' ', 'T');
}

function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return y + '年' + Number(m) + '月';
}

/** Format "YYYY-MM-DD HH:MM:SS" to "MM-DD HH:MM" for list display */
function formatListDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split(' ');
  const datePart = parts[0];
  const timePart = parts[1] || '';
  const d = datePart.split('-');
  if (d.length !== 3) return dateStr;
  const shortDate = d[1] + '-' + d[2];
  if (!timePart) return shortDate;
  const timeShort = timePart.slice(0, 5);
  return shortDate + ' ' + timeShort;
}

// ─── DOM Shortcuts ──────────────────────────────────────────────────────

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

// ─── Global State ───────────────────────────────────────────────────────

const state = {
  selectedType: 0,
  selectedCategoryId: null,
  transactions: [],
  currentTab: 'tab-add',
  listFilters: { type: '', time: 'all', search: '', category_id: '', account_id: '' },
  chartRange: 'this',
  chartInstances: {},
  ocrImageBase64: null,
  ocrResult: null,
  ocrLoading: false,
  ocrAbortController: null,
  _bgType: null,
  _bgValue: null,
  batchMode: false,
};

const CHART_COLORS = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#c77dff', '#6c757d', '#ff9f43', '#54a0ff', '#5f27cd'];

// ═══════════════════════════════════════════════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════════════════════════════════════════════

async function switchTab(tabName) {
  state.currentTab = tabName;

  $$('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  $$('.tab-content').forEach(el => {
    el.classList.toggle('active', el.id === tabName);
  });

  closeModals();
  if (state.batchMode && tabName !== 'tab-list') {
    state.batchMode = false;
  }

  if (tabName === 'tab-add') {
    await loadCategories();
    await loadAccounts();
    await refreshSummary();
    $('#input-amount').focus();
  } else if (tabName === 'tab-list') {
    await loadFilterSelects();
    await loadTransactions();
  } else if (tabName === 'tab-charts') {
    await refreshCharts();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 记账 TAB (Add Transaction)
// ═══════════════════════════════════════════════════════════════════════

async function loadCategories() {
  const container = $('#category-chips');
  try {
    const cats = await window.api.getCategories(state.selectedType);
    container.innerHTML = '';

    if (!cats || cats.length === 0) {
      container.innerHTML =
        '<span style="color:var(--text-muted);font-size:13px;">暂无分类，请在设置中添加</span>';
      state.selectedCategoryId = null;
      return;
    }

    let foundSelected = false;
    cats.forEach(cat => {
      const chip = document.createElement('button');
      chip.className = 'cat-chip';
      chip.textContent = cat.icon + ' ' + cat.name;
      chip.dataset.catId = cat.id;
      if (state.selectedCategoryId === cat.id) {
        chip.classList.add('selected');
        foundSelected = true;
      }
      chip.addEventListener('click', () => {
        $$('#category-chips .cat-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        state.selectedCategoryId = cat.id;
      });
      container.appendChild(chip);
    });

    if (!foundSelected) {
      const firstChip = container.querySelector('.cat-chip');
      if (firstChip) {
        firstChip.classList.add('selected');
        state.selectedCategoryId = Number(firstChip.dataset.catId);
      } else {
        state.selectedCategoryId = null;
      }
    }
  } catch (err) {
    console.error('loadCategories error:', err);
  }
}

async function loadAccounts() {
  const select = $('#select-account');
  try {
    const accounts = await window.api.getAccounts();
    select.innerHTML = '<option value="">选择账户</option>';
    if (accounts) {
      accounts.forEach(acc => {
        const opt = document.createElement('option');
        opt.value = acc.id;
        opt.textContent = acc.icon + ' ' + acc.name;
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('loadAccounts error:', err);
  }
}

async function refreshSummary() {
  try {
    const today = getTodayDateOnly();
    const month = getCurrentMonth();

    const [todayStats, monthStats, monthTxns] = await Promise.all([
      window.api.getTodayStats(today),
      window.api.getMonthlyStats(month),
      window.api.getTransactions({ month, limit: 0 }),
    ]);

    const todayExpenseCount = monthTxns.filter(t => t.type === 0 && t.date === today).length;

    $('#summary-today').textContent = formatMoney(todayStats.expense);
    $('#summary-today-count').textContent = todayExpenseCount + ' 笔';
    $('#summary-month-expense').textContent = formatMoney(monthStats.expense);
    $('#summary-month-income').textContent = formatMoney(monthStats.income);
    $('#summary-month-balance').textContent = formatMoney(monthStats.income - monthStats.expense);
  } catch (err) {
    console.error('refreshSummary error:', err);
  }
}

async function saveTransaction() {
  const amountStr = $('#input-amount').value;
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    $('#input-amount').focus();
    return;
  }

  const accountId = $('#select-account').value;
  const note = $('#input-note').value.trim();
  const date = $('#input-date').value.replace('T', ' ') || getToday();

  try {
    await window.api.addTransaction({
      type: state.selectedType,
      amount: Math.round(amount * 100) / 100,
      category_id: state.selectedCategoryId,
      account_id: accountId ? Number(accountId) : null,
      note: note,
      date: date,
    });

    $('#input-amount').value = '';
    $('#input-note').value = '';
    $('#input-date').value = getToday();
    $('#input-amount').focus();

    await refreshSummary();
    if (state.currentTab === 'tab-list') {
      await loadTransactions();
    }
  } catch (err) {
    console.error('saveTransaction error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 流水 TAB (Transaction List)
// ═══════════════════════════════════════════════════════════════════════

function getListMonth() {
  return state.listFilters.time === 'month' ? getCurrentMonth() : null;
}

async function loadTransactions() {
  const listBody = $('#transaction-list');
  try {
    const filters = {
      type: state.listFilters.type !== '' ? Number(state.listFilters.type) : null,
      month: getListMonth(),
      category_id: state.listFilters.category_id || null,
      account_id: state.listFilters.account_id || null,
      search: state.listFilters.search || null,
      limit: 0,
      offset: 0,
    };

    const txns = await window.api.getTransactions(filters);
    state.transactions = txns || [];

    if (!state.transactions.length) {
      listBody.innerHTML = '<div class="list-empty">暂无记录</div>';
      $('#list-summary-count').textContent = '0';
      $('#list-summary-expense').textContent = formatMoney(0);
      $('#list-summary-income').textContent = formatMoney(0);
      return;
    }

    let totalExpense = 0;
    let totalIncome = 0;
    let html = '';

    state.transactions.forEach(txn => {
      const amt = Number(txn.amount);
      const isExpense = txn.type === 0;
      if (isExpense) totalExpense += amt;
      else totalIncome += amt;

      const prefix = isExpense ? '-' : '+';
      const amtClass = isExpense ? 'expense' : 'income';
      const catName = txn.category_name || '未分类';
      const catIcon = txn.category_icon || '📦';
      const acctName = txn.account_name || '未指定';

      html +=
        '<div class="list-row" data-id="' + txn.id + '">' +
          (state.batchMode ? '<div class="col-check"><input type="checkbox" class="batch-check" data-id="' + txn.id + '"></div>' : '') +
          '<div class="col-date">' + escapeHtml(formatListDate(txn.date)) + '</div>' +
          '<div class="col-cat">' + escapeHtml(catIcon) + ' ' + escapeHtml(catName) + '</div>' +
          '<div class="col-note">' + escapeHtml(txn.note || '—') + '</div>' +
          '<div class="col-account">' + escapeHtml(acctName) + '</div>' +
          '<div class="col-amount ' + amtClass + '">' + prefix + formatMoney(amt).replace('¥', '') + '</div>' +
          '<div class="col-actions">' +
            (state.batchMode ? '' : '<button class="btn-icon edit" data-action="edit" data-id="' + txn.id + '" title="编辑">✏️</button>' +
            '<button class="btn-icon delete" data-action="delete" data-id="' + txn.id + '" title="删除">🗑️</button>') +
          '</div>' +
        '</div>';
    });

    listBody.innerHTML = html;

    // Update batch UI visibility
    updateBatchUI();

    if (state.batchMode) {
      // Wire up row clicks to toggle checkboxes
      listBody.querySelectorAll('.list-row').forEach(row => {
        row.addEventListener('click', () => {
          const cb = row.querySelector('.batch-check');
          if (cb) { cb.checked = !cb.checked; updateBatchCount(); }
        });
      });
      listBody.querySelectorAll('.batch-check').forEach(cb => {
        cb.addEventListener('click', e => { e.stopPropagation(); updateBatchCount(); });
      });
    } else {
      // Wire up row clicks
      listBody.querySelectorAll('.list-row').forEach(row => {
        row.addEventListener('click', () => openEditModal(Number(row.dataset.id)));
      });

      // Wire up action buttons
      listBody.querySelectorAll('.btn-icon.edit').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          openEditModal(Number(btn.dataset.id));
        });
      });
      listBody.querySelectorAll('.btn-icon.delete').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          deleteTransactionById(Number(btn.dataset.id));
        });
      });
    }

    $('#list-summary-count').textContent = state.transactions.length;
    $('#list-summary-expense').textContent = formatMoney(totalExpense);
    $('#list-summary-income').textContent = formatMoney(totalIncome);
  } catch (err) {
    console.error('loadTransactions error:', err);
  }
}

async function deleteTransactionById(id) {
  const txn = state.transactions.find(t => t.id === id);
  if (!txn) return;

  const amt = Number(txn.amount);
  const prefix = txn.type === 0 ? '-' : '+';
  const typeLabel = txn.type === 0 ? '支出' : '收入';
  const msg = '确定要删除这条记录吗？\n\n' + typeLabel + ' ' + prefix + formatMoney(amt) +
    ' — ' + (txn.category_name || '未分类');

  if (!confirm(msg)) return;

  try {
    await window.api.deleteTransaction(id);
    await loadTransactions();
    await refreshSummary();
    closeEditModal();
  } catch (err) {
    console.error('deleteTransaction error:', err);
  }
}

// ─── Batch Delete ─────────────────────────────────────────────────────────

function updateBatchCount() {
  const checked = document.querySelectorAll('.batch-check:checked').length;
  $('#batch-count').textContent = '已选 ' + checked + ' 项';
}

function updateBatchUI() {
  const show = state.batchMode;
  $('#batch-bar').style.display = show ? '' : 'none';
  $('#col-check-header').style.display = show ? '' : 'none';
  $('#col-actions-header').textContent = show ? '' : '操作';
  $('#btn-batch-delete-toggle').textContent = show ? '✕ 取消批量' : '☐ 批量删除';
  if (show) {
    updateBatchCount();
    $('#batch-check-all').checked = false;
  }
}

function toggleBatchMode() {
  state.batchMode = !state.batchMode;
  // Re-render list to show/hide checkboxes
  loadTransactions();
}

async function batchDeleteSelected() {
  const checked = document.querySelectorAll('.batch-check:checked');
  if (checked.length === 0) {
    alert('请至少选择一项');
    return;
  }

  const totalExp = [...checked].reduce((sum, cb) => {
    const txn = state.transactions.find(t => t.id === Number(cb.dataset.id));
    return sum + (txn && txn.type === 0 ? Number(txn.amount) : 0);
  }, 0);
  const totalInc = [...checked].reduce((sum, cb) => {
    const txn = state.transactions.find(t => t.id === Number(cb.dataset.id));
    return sum + (txn && txn.type === 1 ? Number(txn.amount) : 0);
  }, 0);

  const msg = '确定要删除以下 ' + checked.length + ' 条记录吗？\n\n' +
    '支出合计：' + formatMoney(totalExp) + '\n' +
    '收入合计：' + formatMoney(totalInc) + '\n\n' +
    '此操作不可撤销！';

  if (!confirm(msg)) return;

  let deleted = 0;
  let failed = 0;
  for (const cb of checked) {
    try {
      await window.api.deleteTransaction(Number(cb.dataset.id));
      deleted++;
    } catch (err) {
      console.error('batch delete error:', err);
      failed++;
    }
  }

  // Exit batch mode and refresh
  state.batchMode = false;
  await loadTransactions();
  await refreshSummary();
  alert('成功删除 ' + deleted + ' 条' + (failed > 0 ? '，' + failed + ' 条失败' : ''));
}

async function loadFilterSelects() {
  try {
    const [categories, accounts] = await Promise.all([
      window.api.getCategories(),
      window.api.getAccounts(),
    ]);

    const catSelect = $('#filter-category');
    catSelect.innerHTML = '<option value="">全部分类</option>';
    if (categories) {
      categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = (cat.type === 0 ? '[支出]' : '[收入]') + ' ' + cat.icon + ' ' + cat.name;
        catSelect.appendChild(opt);
      });
    }

    const acctSelect = $('#filter-account');
    acctSelect.innerHTML = '<option value="">全部账户</option>';
    if (accounts) {
      accounts.forEach(acc => {
        const opt = document.createElement('option');
        opt.value = acc.id;
        opt.textContent = acc.icon + ' ' + acc.name;
        acctSelect.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('loadFilterSelects error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// EDIT MODAL
// ═══════════════════════════════════════════════════════════════════════

function openEditModal(id) {
  const txn = state.transactions.find(t => t.id === id);
  if (!txn) return;

  const body = $('#edit-body');
  const isExp = txn.type === 0;

  body.innerHTML =
    '<div class="form-row" style="margin-bottom:12px;">' +
      '<span style="color:var(--text-secondary);font-size:13px;min-width:40px;">类型</span>' +
      '<div class="type-toggle" id="edit-type-toggle" style="width:200px;">' +
        '<button class="type-btn expense' + (isExp ? ' active' : '') + '" data-type="0">支出</button>' +
        '<button class="type-btn income' + (!isExp ? ' active' : '') + '" data-type="1">收入</button>' +
      '</div>' +
    '</div>' +
    '<div class="form-row" style="margin-bottom:12px;">' +
      '<label class="form-label">金额</label>' +
      '<input type="number" class="form-input" id="edit-amount" value="' + txn.amount + '" step="0.01" min="0">' +
    '</div>' +
    '<div class="form-row" style="margin-bottom:12px;">' +
      '<label class="form-label">备注</label>' +
      '<input type="text" class="form-input" id="edit-note" value="' + escapeHtml(txn.note || '') + '">' +
    '</div>' +
    '<div class="form-row" style="margin-bottom:16px;">' +
      '<label class="form-label">日期</label>' +
      '<input type="datetime-local" class="form-input" id="edit-date" value="' + toDatetimeLocal(txn.date) + '" step="1">' +
    '</div>' +
    '<div class="form-row" style="gap:8px;">' +
      '<button class="btn-small" id="edit-save">保存修改</button>' +
      '<button class="btn-small danger" id="edit-delete">删除</button>' +
    '</div>';

  // Type toggle in edit modal
  body.querySelectorAll('#edit-type-toggle .type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('#edit-type-toggle .type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Save
  $('#edit-save').onclick = async () => {
    const typeBtn = body.querySelector('#edit-type-toggle .type-btn.active');
    const newType = Number(typeBtn.dataset.type);
    const newAmount = parseFloat($('#edit-amount').value);
    const newNote = $('#edit-note').value.trim();
    const newDate = $('#edit-date').value.replace('T', ' ');

    if (isNaN(newAmount) || newAmount <= 0) {
      $('#edit-amount').focus();
      return;
    }

    try {
      await window.api.updateTransaction(id, {
        type: newType,
        amount: Math.round(newAmount * 100) / 100,
        note: newNote,
        date: newDate,
      });
      closeEditModal();
      await loadTransactions();
      await refreshSummary();
    } catch (err) {
      console.error('updateTransaction error:', err);
    }
  };

  // Delete
  $('#edit-delete').onclick = () => {
    closeEditModal();
    deleteTransactionById(id);
  };

  $('#edit-overlay').style.display = 'flex';
}

function closeEditModal() {
  $('#edit-overlay').style.display = 'none';
  $('#edit-body').innerHTML = '';
}

// ═══════════════════════════════════════════════════════════════════════
// 图表 TAB (Charts)
// ═══════════════════════════════════════════════════════════════════════

function getChartMonths() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  const fmt = (year, month) => year + '-' + String(month).padStart(2, '0');

  switch (state.chartRange) {
    case 'last':
      if (m === 1) return [fmt(y - 1, 12)];
      return [fmt(y, m - 1)];
    case '3mon': {
      const months = [];
      for (let i = 2; i >= 0; i--) {
        let mm = m - i;
        let yy = y;
        if (mm <= 0) { mm += 12; yy--; }
        months.push(fmt(yy, mm));
      }
      return months;
    }
    default: // 'this'
      return [fmt(y, m)];
  }
}

function getChartLabel() {
  const months = getChartMonths();
  if (months.length === 1) return monthLabel(months[0]);
  return monthLabel(months[0]) + ' — ' + monthLabel(months[months.length - 1]);
}

function destroyCharts() {
  ['pie', 'trend', 'compare'].forEach(key => {
    if (state.chartInstances[key]) {
      state.chartInstances[key].destroy();
      state.chartInstances[key] = null;
    }
  });
}

async function refreshCharts() {
  destroyCharts();

  const months = getChartMonths();
  $('#chart-month-label').textContent = getChartLabel();

  try {
    // Fetch stats for all selected months in parallel
    const allCatStats = await Promise.all(months.map(m => window.api.getCategoryStats(m, 0)));
    const allDailyStats = await Promise.all(months.map(m => window.api.getDailyStats(m)));
    const allMonthlyStats = await Promise.all(months.map(m => window.api.getMonthlyStats(m)));

    // Merge category stats across months
    const catMap = new Map();
    allCatStats.forEach(stats => {
      stats.forEach(c => {
        const existing = catMap.get(c.name);
        if (existing) {
          existing.total += c.total;
        } else {
          catMap.set(c.name, { name: c.name, icon: c.icon, total: c.total });
        }
      });
    });
    const mergedCatStats = [...catMap.values()].sort((a, b) => b.total - a.total);

    // Merge daily stats
    const dailyMap = new Map();
    allDailyStats.forEach(stats => {
      stats.forEach(ds => {
        const existing = dailyMap.get(ds.date);
        if (existing) {
          if (ds.type === 0) existing.expense += ds.total;
          else existing.income += ds.total;
        } else {
          dailyMap.set(ds.date, {
            expense: ds.type === 0 ? ds.total : 0,
            income: ds.type === 1 ? ds.total : 0,
          });
        }
      });
    });
    const sortedDates = [...dailyMap.keys()].sort();

    // Merge monthly stats
    let totalExpense = 0, totalIncome = 0;
    allMonthlyStats.forEach(s => { totalExpense += s.expense; totalIncome += s.income; });

    // ── Pie chart (doughnut) ──────────────────────────────────────

    const catLabels = mergedCatStats.map(c => c.icon + ' ' + c.name);
    const catData = mergedCatStats.map(c => c.total);
    const catColors = mergedCatStats.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

    if (catData.length === 0) {
      catLabels.push('暂无数据');
      catData.push(1);
      catColors.push('#e8e8e8');
    }

    const pieCtx = $('#chart-pie').getContext('2d');
    state.chartInstances.pie = new Chart(pieCtx, {
      type: 'doughnut',
      data: {
        labels: catLabels,
        datasets: [{
          data: catData,
          backgroundColor: catColors,
          borderColor: '#f0f0f5',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#555', font: { size: 11 }, padding: 8, usePointStyle: true },
          },
        },
      },
    });

    // ── Trend chart (bar) ─────────────────────────────────────────

    const trendLabels = sortedDates.length > 0 ? sortedDates.map(d => d.slice(8)) : ['无'];
    const expenseData = sortedDates.length > 0 ? sortedDates.map(d => dailyMap.get(d).expense) : [0];
    const incomeData = sortedDates.length > 0 ? sortedDates.map(d => dailyMap.get(d).income) : [0];

    const trendCtx = $('#chart-trend').getContext('2d');
    state.chartInstances.trend = new Chart(trendCtx, {
      type: 'bar',
      data: {
        labels: trendLabels,
        datasets: [
          { label: '支出', data: expenseData, backgroundColor: '#ff6b6b', borderRadius: 4 },
          { label: '收入', data: incomeData, backgroundColor: '#4ecdc4', borderRadius: 4 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#555', font: { size: 11 }, usePointStyle: true } },
        },
        scales: {
          x: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: '#e8e8ec' } },
          y: { ticks: { color: '#888', font: { size: 10 }, callback: v => '¥' + v }, grid: { color: '#e8e8ec' } },
        },
      },
    });

    // ── Ranking (CSS bars) ────────────────────────────────────────

    renderRanking(mergedCatStats);

    // ── Compare chart (income vs expense bar) ─────────────────────

    const compareCtx = $('#chart-compare').getContext('2d');
    state.chartInstances.compare = new Chart(compareCtx, {
      type: 'bar',
      data: {
        labels: ['收入', '支出'],
        datasets: [{
          data: [totalIncome, totalExpense],
          backgroundColor: ['#4ecdc4', '#ff6b6b'],
          borderRadius: 6,
          barThickness: 40,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#555', font: { size: 13 } }, grid: { color: '#e8e8ec' } },
          y: { ticks: { color: '#888', callback: v => '¥' + v }, grid: { color: '#e8e8ec' } },
        },
      },
    });

  } catch (err) {
    console.error('refreshCharts error:', err);
  }
}

function renderRanking(catStats) {
  const container = $('#chart-ranking');

  if (!catStats || catStats.length === 0) {
    container.innerHTML =
      '<div style="color:var(--text-muted);text-align:center;padding:20px;">暂无数据</div>';
    return;
  }

  const maxTotal = Math.max(...catStats.map(c => c.total), 1);

  container.innerHTML = catStats.map((cat, i) => {
    const pct = Math.round((cat.total / maxTotal) * 100);
    const color = CHART_COLORS[i % CHART_COLORS.length];
    return (
      '<div class="chart-rank-item">' +
        '<span class="chart-rank-icon">' + escapeHtml(cat.icon) + '</span>' +
        '<span class="chart-rank-name">' + escapeHtml(cat.name) + '</span>' +
        '<div class="chart-rank-bar-wrap">' +
          '<div class="chart-rank-bar" style="width:' + pct + '%;background:' + color + ';"></div>' +
        '</div>' +
        '<span class="chart-rank-amount">' + formatMoney(cat.total) + '</span>' +
      '</div>'
    );
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════
// OCR 导入 TAB
// ═══════════════════════════════════════════════════════════════════════

/**
 * Prepare an image (base64 data URL) for Baidu OCR.
 * - Baidu OCR limits: base64 ≤ 4MB, longest edge ≤ 4096px.
 * - For images under 3MB base64, send as-is (no compression needed).
 * - For larger images, attempt Canvas re-encode to JPEG with a 5s timeout;
 *   if it fails, send the raw base64 and let Baidu reject if too large.
 * @param {string} dataUrl - The image data URL
 * @param {AbortSignal} [signal] - Optional AbortSignal for cancellation
 */
function compressImageForOCR(dataUrl, signal) {
  return new Promise((resolve, reject) => {
    console.log('[OCR] compressImageForOCR called, dataUrl length:', dataUrl ? (dataUrl.length / 1024 / 1024).toFixed(2) + 'MB' : 'null');
    const parts = dataUrl.split(';base64,');
    if (parts.length < 2) {
      console.error('[OCR] compressImageForOCR: invalid data URL format');
      reject(new Error('图片数据格式无效'));
      return;
    }

    if (signal) {
      signal.addEventListener('abort', () => {
        console.log('[OCR] compressImageForOCR aborted');
        reject(new Error('操作已取消'));
      });
      if (signal.aborted) {
        reject(new Error('操作已取消'));
        return;
      }
    }

    const rawBase64 = parts[1];
    console.log('[OCR] compressImageForOCR resolve, rawBase64 length:', (rawBase64.length / 1024 / 1024).toFixed(2) + 'MB');
    resolve(rawBase64);
  });
}

function setupOCR() {
  const dropzone = $('#ocr-dropzone');

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); });
  });

  ['dragenter', 'dragover'].forEach(evt => {
    dropzone.addEventListener(evt, () => dropzone.classList.add('dragover'));
  });

  ['dragleave', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, () => dropzone.classList.remove('dragover'));
  });

  dropzone.addEventListener('drop', e => {
    const files = e.dataTransfer.files;
    if (files && files.length > 0) processOCRFile(files[0]);
  });

  dropzone.addEventListener('click', async () => {
    try {
      const base64 = await window.api.openImageDialog();
      if (base64) {
        state.ocrImageBase64 = base64;
        await showOCRPreview(base64);
        runOCR();
      }
    } catch (err) {
      console.error('openImageDialog error:', err);
    }
  });

  $('#btn-ocr-run').addEventListener('click', runOCR);
  $('#btn-ocr-clear').addEventListener('click', clearOCR);
  $('#btn-ocr-apply').addEventListener('click', applyOCRResult);

  // Engine switcher
  const engineRadios = document.querySelectorAll('input[name="ocr-engine"]');
  engineRadios.forEach(r => r.addEventListener('change', onEngineChange));
  onEngineChange(); // initial check
}

function onEngineChange() {
  const engine = document.querySelector('input[name="ocr-engine"]:checked').value;
  const highPrecisionLabel = $('#ocr-high-precision-label');
  const paddleStatus = $('#ocr-paddle-status');

  if (engine === 'paddle') {
    highPrecisionLabel.style.display = 'none';
    paddleStatus.textContent = '检测中...';
    paddleStatus.className = 'ocr-paddle-status';
    window.api.paddleStatus().then(ok => {
      paddleStatus.textContent = ok ? '✓ 已连接' : '✗ 未运行';
      paddleStatus.className = 'ocr-paddle-status ' + (ok ? 'ok' : 'err');
    });
  } else {
    highPrecisionLabel.style.display = '';
    paddleStatus.textContent = '';
    paddleStatus.className = 'ocr-paddle-status';
  }
}

function processOCRFile(file) {
  if (!file.type.match(/^image\/(jpeg|png|bmp|webp|gif)$/)) {
    alert('请选择 JPG、PNG、BMP、WebP 或 GIF 格式的图片');
    return;
  }
  const reader = new FileReader();
  reader.onload = async e => {
    state.ocrImageBase64 = e.target.result;
    await showOCRPreview(e.target.result);
    runOCR();
  };
  reader.readAsDataURL(file);
}

function showOCRPreview(base64) {
  return new Promise(resolve => {
    console.log('[OCR] showOCRPreview called');
    const img = $('#ocr-preview-img');
    img.src = base64;
    $('#ocr-preview').style.display = '';
    $('#btn-ocr-run').style.display = '';
    $('#btn-ocr-clear').style.display = '';
    $('#ocr-result').style.display = 'none';
    $('#btn-ocr-apply').style.display = 'none';

    if (img.complete && img.naturalWidth > 0) {
      console.log('[OCR] showOCRPreview: img already loaded, resolving');
      resolve();
    } else {
      console.log('[OCR] showOCRPreview: waiting for img load...');
      img.onload = () => { console.log('[OCR] showOCRPreview: img.onload fired'); resolve(); };
      img.onerror = () => { console.log('[OCR] showOCRPreview: img.onerror fired'); resolve(); };
      setTimeout(() => { console.log('[OCR] showOCRPreview: 3s timeout fired'); resolve(); }, 3000);
    }
  });
}

function clearOCR() {
  if (state.ocrAbortController) {
    state.ocrAbortController.abort();
    state.ocrAbortController = null;
  }
  state.ocrLoading = false;
  state.ocrImageBase64 = null;
  state.ocrResult = null;
  $('#ocr-preview').style.display = 'none';
  $('#ocr-preview-img').src = '';
  $('#btn-ocr-run').style.display = 'none';
  $('#btn-ocr-clear').style.display = 'none';
  $('#ocr-result').style.display = 'none';
  $('#btn-ocr-apply').style.display = 'none';
}

async function runOCR() {
  if (state.ocrLoading) {
    return;
  }

  if (!state.ocrImageBase64) {
    alert('请先选择图片');
    return;
  }

  state.ocrLoading = true;
  const abortController = new AbortController();
  state.ocrAbortController = abortController;
  const signal = abortController.signal;

  const engine = document.querySelector('input[name="ocr-engine"]:checked').value;
  const highPrecision = $('#ocr-high-precision').checked;
  const mode = engine === 'paddle' ? 'paddle' : (highPrecision ? 'high' : 'normal');
  const isLocal = mode === 'paddle';

  const resultBox = $('#ocr-result');
  // Hide btn-ocr-apply BEFORE innerHTML replacement — it lives inside resultBox
  const btnApply = $('#btn-ocr-apply');
  if (btnApply) btnApply.style.display = 'none';
  resultBox.style.display = '';
  resultBox.innerHTML =
    '<div class="ocr-result-header">识别结果</div>' +
    '<div style="text-align:center;padding:20px;">' +
      '<div class="spinner spinner-large"></div>' +
      '<div style="color:var(--text-muted);margin-top:10px;" id="ocr-status-text">' +
        (isLocal ? '正在识别中 (EasyOCR 本地)...' : '正在准备图片...') +
      '</div>' +
      '<button class="btn-small danger" id="btn-ocr-cancel" style="margin-top:12px;">取消</button>' +
    '</div>';

  document.getElementById('btn-ocr-cancel').addEventListener('click', cancelOCR);

  const OCR_TIMEOUT = 70000;

  try {
    console.log('[OCR] runOCR start, mode:', mode, 'imageSize:', state.ocrImageBase64 ? (state.ocrImageBase64.length / 1024 / 1024).toFixed(2) + 'MB' : 'null');

    // Local OCR: skip compression entirely (no API limit)
    // Baidu OCR: prepare image (compress only if > 3MB base64)
    let base64Data;
    if (isLocal) {
      const parts = state.ocrImageBase64.split(';base64,');
      base64Data = parts.length >= 2 ? parts[1] : state.ocrImageBase64;
    } else {
      console.log('[OCR] calling compressImageForOCR...');
      base64Data = await compressImageForOCR(state.ocrImageBase64, signal);
      console.log('[OCR] compressImageForOCR done, base64 length:', base64Data ? base64Data.length : 'null');
    }

    if (signal.aborted) return;
    if (!isLocal) {
      document.getElementById('ocr-status-text').textContent =
        `正在识别中 (${mode === 'high' ? '百度 OCR 高精度' : '百度 OCR'})...`;
    }

    console.log('[OCR] calling recognizeOCR...');
    const recognizePromise = window.api.recognizeOCR(base64Data, mode);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('OCR识别超时(70s)，请检查网络连接或稍后重试')), OCR_TIMEOUT)
    );

    const result = await Promise.race([
      recognizePromise,
      timeoutPromise,
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('操作已取消')));
      })
    ]);

    if (signal.aborted) return;
    console.log('[OCR] recognizeOCR success, rawText length:', result.rawText ? result.rawText.length : 'null');
    state.ocrResult = result;
    renderOCRResult(result);
  } catch (err) {
    console.error('[OCR] runOCR error:', err);
    if (err && err.message === '操作已取消') {
      resultBox.innerHTML =
        '<div class="ocr-result-header">识别结果</div>' +
        '<div style="color:var(--text-muted);text-align:center;padding:10px;">识别已取消</div>';
      return;
    }
    console.error('OCR error:', err);
    resultBox.innerHTML =
      '<div class="ocr-result-header">识别结果</div>' +
      '<div style="color:var(--danger);text-align:center;padding:10px;">' +
        '识别失败：' + escapeHtml(err.message || '未知错误') +
      '</div>' +
      '<div class="ocr-result-raw" style="margin-top:8px;">' + escapeHtml(String(err)) + '</div>';
  } finally {
    state.ocrLoading = false;
    state.ocrAbortController = null;
  }
}

function cancelOCR() {
  if (state.ocrAbortController) {
    state.ocrAbortController.abort();
    state.ocrAbortController = null;
  }
}

function renderOCRResult(result) {
  const resultBox = $('#ocr-result');
  const transactions = result.transactions || [];
  const rawText = result.rawText || '';

  // Multi-transaction view (bank statement with 2+ entries)
  if (transactions.length > 1) {
    let rowsHtml = transactions.map((t, i) => {
      const isExpense = t.type === 0;
      const prefix = isExpense ? '-' : '+';
      const amtClass = isExpense ? 'expense' : 'income';
      return (
        '<label class="ocr-txn-row">' +
          '<input type="checkbox" class="ocr-txn-check" data-idx="' + i + '" checked>' +
          '<span class="ocr-txn-date">' + escapeHtml(formatListDate(t.date)) + '</span>' +
          '<span class="ocr-txn-type" style="color:' + (isExpense ? 'var(--expense)' : 'var(--income)') + '">' + (isExpense ? '支出' : '收入') + '</span>' +
          '<span class="ocr-txn-merchant">' + escapeHtml(t.merchant) + '</span>' +
          '<span class="ocr-txn-amount ' + amtClass + '">' + prefix + formatMoney(t.amount).replace('¥', '') + '</span>' +
        '</label>'
      );
    }).join('');

    resultBox.innerHTML =
      '<div class="ocr-result-header">识别到 <strong>' + transactions.length + '</strong> 笔交易</div>' +
      '<div style="padding:0 12px 8px;">' +
        '<label class="ocr-txn-row" style="border-bottom:1px solid var(--glass-border);padding-bottom:6px;margin-bottom:4px;font-size:11px;color:var(--text-muted);cursor:default;">' +
          '<input type="checkbox" id="ocr-select-all" checked>' +
          '<span>全选</span>' +
        '</label>' +
        '<div class="ocr-txn-list">' + rowsHtml + '</div>' +
      '</div>' +
      (rawText ? '<div class="ocr-result-raw">' + escapeHtml(rawText) + '</div>' : '') +
      '<button class="btn-primary" id="btn-ocr-apply">导入选中交易</button>';
    resultBox.style.display = '';

    // Select-all toggle
    document.getElementById('ocr-select-all').addEventListener('change', function () {
      const checked = this.checked;
      resultBox.querySelectorAll('.ocr-txn-check').forEach(cb => { cb.checked = checked; });
    });

    // Individual checkbox → update select-all state
    resultBox.querySelectorAll('.ocr-txn-check').forEach(cb => {
      cb.addEventListener('change', function () {
        const all = resultBox.querySelectorAll('.ocr-txn-check');
        const allChecked = [...all].every(c => c.checked);
        const selectAll = document.getElementById('ocr-select-all');
        if (selectAll) selectAll.checked = allChecked;
      });
    });

    document.getElementById('btn-ocr-apply').addEventListener('click', applyOCRResult);
    return;
  }

  // Single-transaction view (receipt)
  const amount = result.amount ? formatMoney(result.amount) : '—';
  const merchant = result.merchant || '—';
  const date = result.date || '—';

  resultBox.innerHTML =
    '<div class="ocr-result-header">识别结果</div>' +
    '<div class="ocr-result-fields">' +
      '<div class="ocr-field"><span class="ocr-field-label">金额</span>' +
        '<span class="ocr-field-value" style="color:' + (result.amount ? 'var(--expense)' : 'var(--text-muted)') + '">' + escapeHtml(amount) + '</span></div>' +
      '<div class="ocr-field"><span class="ocr-field-label">商户</span>' +
        '<span class="ocr-field-value">' + escapeHtml(merchant) + '</span></div>' +
      '<div class="ocr-field"><span class="ocr-field-label">日期</span>' +
        '<span class="ocr-field-value">' + escapeHtml(date) + '</span></div>' +
    '</div>' +
    (rawText ? '<div class="ocr-result-raw">' + escapeHtml(rawText) + '</div>' : '') +
    '<button class="btn-primary" id="btn-ocr-apply">应用到记账表单</button>';
  resultBox.style.display = '';

  document.getElementById('btn-ocr-apply').addEventListener('click', applyOCRResult);
}

async function applyOCRResult() {
  if (!state.ocrResult) return;
  const transactions = state.ocrResult.transactions || [];

  // Multi-transaction: import all checked
  if (transactions.length > 1) {
    const checks = document.querySelectorAll('.ocr-txn-check');
    const selected = [];
    checks.forEach(cb => {
      if (cb.checked) {
        const idx = parseInt(cb.dataset.idx);
        if (idx >= 0 && idx < transactions.length) selected.push(transactions[idx]);
      }
    });

    if (selected.length === 0) {
      alert('请至少选择一笔交易');
      return;
    }

    let imported = 0;
    let failed = 0;
    for (const t of selected) {
      try {
        await window.api.addTransaction({
          type: t.type,
          amount: t.amount,
          category_id: t.category_id || null,
          account_id: null,
          note: t.merchant,
          date: t.date,
        });
        imported++;
      } catch (err) {
        console.error('import transaction error:', err);
        failed++;
      }
    }

    clearOCR();
    await refreshSummary();
    switchTab('tab-list');
    alert('成功导入 ' + imported + ' 笔交易' + (failed > 0 ? '，' + failed + ' 笔失败' : ''));
    return;
  }

  // Single transaction
  if (state.ocrResult.amount) {
    $('#input-amount').value = state.ocrResult.amount;
  }
  if (state.ocrResult.merchant) {
    $('#input-note').value = state.ocrResult.merchant;
  }
  if (state.ocrResult.date) {
    $('#input-date').value = toDatetimeLocal(state.ocrResult.date);
  }

  // Auto-select category and type based on OCR result
  if (state.ocrResult.category_id) {
    state.selectedCategoryId = state.ocrResult.category_id;
    try {
      const allCats = await window.api.getCategories();
      const cat = (allCats || []).find(c => c.id === state.ocrResult.category_id);
      if (cat) {
        state.selectedType = cat.type;
        // Update type toggle UI
        $$('#type-toggle .type-btn').forEach(b => b.classList.remove('active', 'expense', 'income'));
        const activeBtn = document.querySelector(`.type-btn[data-type="${cat.type}"]`);
        if (activeBtn) {
          activeBtn.classList.add('active');
          activeBtn.classList.add(cat.type === 0 ? 'expense' : 'income');
        }
      }
    } catch (e) { /* ignore */ }
    await loadCategories();
  }
  switchTab('tab-add');
}

// ═══════════════════════════════════════════════════════════════════════
// SETTINGS MODAL
// ═══════════════════════════════════════════════════════════════════════

function openSettings() {
  $('#modal-overlay').style.display = 'flex';
  loadSettingsAccounts();
  loadSettingsCategories();
  loadAPISettings();
  loadBackgroundSettings();
}

function closeSettings() {
  $('#modal-overlay').style.display = 'none';
}

// Account/category cache for settings lookup
let _settingsAccounts = [];
let _settingsCategories = [];

async function loadSettingsAccounts() {
  const list = $('#settings-account-list');
  try {
    _settingsAccounts = await window.api.getAccounts();
    if (!_settingsAccounts || _settingsAccounts.length === 0) {
      list.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:4px 0;">暂无账户</div>';
      return;
    }
    list.innerHTML = _settingsAccounts.map(acc =>
      '<div class="settings-item">' +
        '<span class="settings-item-icon">' + escapeHtml(acc.icon) + '</span>' +
        '<input type="text" class="form-input" value="' + escapeHtml(acc.name) + '" data-id="' + acc.id + '" style="background:transparent;border:none;flex:1;font-size:13px;color:var(--text-primary);min-width:0;">' +
        '<div class="settings-item-actions">' +
          '<button class="btn-small" data-action="save-account" data-id="' + acc.id + '">保存</button>' +
          '<button class="btn-small danger" data-action="delete-account" data-id="' + acc.id + '">删除</button>' +
        '</div>' +
      '</div>'
    ).join('');

    list.querySelectorAll('[data-action="save-account"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        const input = list.querySelector('input[data-id="' + id + '"]');
        const acc = _settingsAccounts.find(a => a.id === id);
        const newName = input.value.trim();
        if (!newName || !acc) return;
        try {
          await window.api.updateAccount(id, { name: newName, icon: acc.icon, sort_order: acc.sort_order || 0 });
          await loadSettingsAccounts();
          await loadAccounts();
          await loadFilterSelects();
        } catch (err) { console.error(err); }
      });
    });

    list.querySelectorAll('[data-action="delete-account"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        if (!confirm('确定删除此账户？')) return;
        try {
          await window.api.deleteAccount(id);
          await loadSettingsAccounts();
          await loadAccounts();
          await loadFilterSelects();
        } catch (err) { console.error(err); }
      });
    });
  } catch (err) {
    console.error('loadSettingsAccounts error:', err);
  }
}

async function loadSettingsCategories() {
  const list = $('#settings-category-list');
  try {
    _settingsCategories = await window.api.getCategories();
    if (!_settingsCategories || _settingsCategories.length === 0) {
      list.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:4px 0;">暂无分类</div>';
      return;
    }
    list.innerHTML = _settingsCategories.map(cat =>
      '<div class="settings-item">' +
        '<span class="settings-item-icon">' + escapeHtml(cat.icon) + '</span>' +
        '<span style="font-size:11px;color:' + (cat.type === 0 ? 'var(--expense)' : 'var(--income)') + ';margin-right:4px;flex-shrink:0;">' + (cat.type === 0 ? '支出' : '收入') + '</span>' +
        '<input type="text" class="form-input" value="' + escapeHtml(cat.name) + '" data-id="' + cat.id + '" style="background:transparent;border:none;flex:1;font-size:13px;color:var(--text-primary);min-width:0;">' +
        '<div class="settings-item-actions">' +
          '<button class="btn-small" data-action="save-category" data-id="' + cat.id + '">保存</button>' +
          '<button class="btn-small danger" data-action="delete-category" data-id="' + cat.id + '">删除</button>' +
        '</div>' +
      '</div>'
    ).join('');

    list.querySelectorAll('[data-action="save-category"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        const input = list.querySelector('input[data-id="' + id + '"]');
        const cat = _settingsCategories.find(c => c.id === id);
        const newName = input.value.trim();
        if (!newName || !cat) return;
        try {
          await window.api.updateCategory(id, { name: newName, icon: cat.icon, sort_order: cat.sort_order || 0 });
          await loadSettingsCategories();
          await loadCategories();
          await loadFilterSelects();
        } catch (err) { console.error(err); }
      });
    });

    list.querySelectorAll('[data-action="delete-category"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        if (!confirm('确定删除此分类？')) return;
        try {
          await window.api.deleteCategory(id);
          await loadSettingsCategories();
          await loadCategories();
          await loadFilterSelects();
        } catch (err) { console.error(err); }
      });
    });
  } catch (err) {
    console.error('loadSettingsCategories error:', err);
  }
}

async function loadAPISettings() {
  try {
    const all = await window.api.getAllSettings();
    if (all.app_id) $('#setting-app-id').value = all.app_id;
    if (all.api_key) $('#setting-api-key').value = all.api_key;
    if (all.secret_key) $('#setting-secret-key').value = all.secret_key;
  } catch (err) {
    console.error('loadAPISettings error:', err);
  }
}

async function loadBackgroundSettings() {
  try {
    const bgType = await window.api.getSetting('background_type');
    const bgValue = await window.api.getSetting('background_value');

    if (bgType) $('#setting-bg-type').value = bgType;
    if (bgType === 'color' && bgValue) {
      $('#setting-bg-color').value = bgValue;
    }
    if (bgType === 'image' && bgValue) {
      state._bgValueForSettings = bgValue;
      $('#setting-bg-image-name').textContent = '已设置';
    }
    toggleBgRows();
  } catch (err) {
    console.error('loadBackgroundSettings error:', err);
  }
}

function toggleBgRows() {
  const type = $('#setting-bg-type').value;
  $('#setting-bg-color-row').style.display = type === 'color' ? '' : 'none';
  $('#setting-bg-image-row').style.display = type === 'image' ? '' : 'none';
}

function applyBackgroundToBody() {
  document.body.classList.remove('bg-color', 'bg-image');
  document.body.style.backgroundImage = '';
  document.body.style.backgroundColor = '';

  if (state._bgType === 'color' && state._bgValue) {
    document.body.style.backgroundColor = state._bgValue;
    document.body.classList.add('bg-color');
  } else if (state._bgType === 'image' && state._bgValue) {
    document.body.style.backgroundImage = 'url(' + state._bgValue + ')';
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundRepeat = 'no-repeat';
    document.body.classList.add('bg-image');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════════════════

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    // Escape: close modals
    if (e.key === 'Escape') {
      closeModals();
      return;
    }

    // Enter key
    if (e.key === 'Enter') {
      if ($('#modal-overlay').style.display === 'flex' || $('#edit-overlay').style.display === 'flex') {
        return;
      }
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
      if (state.currentTab === 'tab-add') {
        e.preventDefault();
        saveTransaction();
      } else if (state.currentTab === 'tab-list') {
        e.preventDefault();
        loadTransactions();
      }
      return;
    }

    // Ctrl+1~4: Switch tabs
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      const tabMap = { '1': 'tab-add', '2': 'tab-list', '3': 'tab-charts', '4': 'tab-ocr' };
      if (tabMap[e.key]) {
        e.preventDefault();
        switchTab(tabMap[e.key]);
      }
    }
  });
}

function closeModals() {
  if ($('#modal-overlay').style.display === 'flex') closeSettings();
  closeEditModal();
}

// ═══════════════════════════════════════════════════════════════════════
// EVENT LISTENER SETUPS
// ═══════════════════════════════════════════════════════════════════════

function setupTabListeners() {
  $$('.tab[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  $('#btn-settings').addEventListener('click', openSettings);
}

function setupTypeToggle() {
  $('#type-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.type-btn');
    if (!btn) return;
    const newType = Number(btn.dataset.type);
    if (state.selectedType === newType) return;

    state.selectedType = newType;
    state.selectedCategoryId = null;

    $$('#type-toggle .type-btn').forEach(b => b.classList.remove('active', 'expense', 'income'));
    btn.classList.add('active');
    btn.classList.add(newType === 0 ? 'expense' : 'income');

    const saveBtn = $('#btn-save');
    saveBtn.classList.remove('expense-btn', 'income-btn');
    saveBtn.classList.add(newType === 0 ? 'expense-btn' : 'income-btn');

    loadCategories();
  });
}

function setupSaveButton() {
  $('#btn-save').addEventListener('click', saveTransaction);
  $('#input-amount').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveTransaction(); }
  });
}

function setupListFilters() {
  $('#filter-type-chips').addEventListener('click', e => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    $$('#filter-type-chips .filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.listFilters.type = chip.dataset.value;
    loadTransactions();
  });

  $('#filter-time-chips').addEventListener('click', e => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    $$('#filter-time-chips .filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.listFilters.time = chip.dataset.value;
    loadTransactions();
  });

  $('#search-note').addEventListener('input', debounce(e => {
    state.listFilters.search = e.target.value.trim();
    loadTransactions();
  }, 300));

  $('#filter-category').addEventListener('change', e => {
    state.listFilters.category_id = e.target.value;
    loadTransactions();
  });

  $('#filter-account').addEventListener('change', e => {
    state.listFilters.account_id = e.target.value;
    loadTransactions();
  });
}

function setupBatchDelete() {
  $('#btn-batch-delete-toggle').addEventListener('click', toggleBatchMode);
  $('#btn-batch-cancel').addEventListener('click', toggleBatchMode);
  $('#btn-batch-delete-confirm').addEventListener('click', batchDeleteSelected);
  $('#batch-check-all').addEventListener('change', function () {
    const checked = this.checked;
    document.querySelectorAll('.batch-check').forEach(cb => { cb.checked = checked; });
    updateBatchCount();
  });
}

function setupChartRangeChips() {
  $('#chart-range-chips').addEventListener('click', e => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    $$('#chart-range-chips .filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.chartRange = chip.dataset.range;
    refreshCharts();
  });
}

function setupSettingsListeners() {
  $('#modal-close').addEventListener('click', closeSettings);
  $('#modal-overlay').addEventListener('click', e => {
    if (e.target === $('#modal-overlay')) closeSettings();
  });

  $('#btn-add-account').addEventListener('click', async () => {
    const name = prompt('请输入账户名称：');
    if (!name || !name.trim()) return;
    const icon = prompt('请输入账户图标 (emoji)：', '💳') || '💳';
    try {
      await window.api.addAccount({ name: name.trim(), icon: icon, sort_order: 0 });
      await loadSettingsAccounts();
      await loadAccounts();
      await loadFilterSelects();
    } catch (err) { console.error(err); }
  });

  $('#btn-add-category').addEventListener('click', async () => {
    const name = prompt('请输入分类名称：');
    if (!name || !name.trim()) return;
    const icon = prompt('请输入分类图标 (emoji)：', '📦') || '📦';
    const typeStr = prompt('请输入分类类型 (0=支出, 1=收入)：', '0');
    const type = parseInt(typeStr) === 1 ? 1 : 0;
    try {
      await window.api.addCategory({ name: name.trim(), icon: icon, type: type, sort_order: 0 });
      await loadSettingsCategories();
      await loadCategories();
      await loadFilterSelects();
    } catch (err) { console.error(err); }
  });

  $('#btn-save-api-config').addEventListener('click', async () => {
    try {
      await window.api.setSetting('app_id', $('#setting-app-id').value.trim());
      await window.api.setSetting('api_key', $('#setting-api-key').value.trim());
      await window.api.setSetting('secret_key', $('#setting-secret-key').value.trim());
      alert('API 配置已保存');
    } catch (err) { console.error(err); }
  });

  $('#setting-bg-type').addEventListener('change', toggleBgRows);

  $('#btn-select-bg-image').addEventListener('click', async () => {
    try {
      const base64 = await window.api.openImageDialog();
      if (base64) {
        state._bgValueForSettings = base64;
        $('#setting-bg-image-name').textContent = '已选择';
      }
    } catch (err) { console.error(err); }
  });

  $('#btn-save-background').addEventListener('click', async () => {
    const bgType = $('#setting-bg-type').value;
    let bgValue = '';
    if (bgType === 'color') {
      bgValue = $('#setting-bg-color').value;
    } else if (bgType === 'image') {
      bgValue = state._bgValueForSettings || '';
    }
    try {
      await window.api.setSetting('background_type', bgType);
      await window.api.setSetting('background_value', bgValue);
      state._bgType = bgType;
      state._bgValue = bgValue;
      applyBackgroundToBody();
      alert('背景设置已保存');
    } catch (err) { console.error(err); }
  });

  $('#btn-export-csv').addEventListener('click', async () => {
    try { await window.api.exportCSV({}); alert('CSV 导出完成'); }
    catch (err) { console.error(err); }
  });

  $('#btn-export-excel').addEventListener('click', async () => {
    try { await window.api.exportExcel({}); alert('Excel 导出完成'); }
    catch (err) { console.error(err); }
  });

  $('#btn-import-csv').addEventListener('click', () => startImport('csv'));
  $('#btn-import-xlsx').addEventListener('click', () => startImport('xlsx'));
}

// ═══════════════════════════════════════════════════════════════════════
// IMPORT
// ═══════════════════════════════════════════════════════════════════════

async function startImport(fileType) {
  try {
    const filePath = await window.api.openImportFile(fileType);
    if (!filePath) return;

    const result = await window.api.parseImportFile(filePath);
    if (!result.transactions || result.transactions.length === 0) {
      alert('文件中没有解析到有效的交易记录');
      return;
    }

    showImportPreview(result);
  } catch (err) {
    console.error('startImport error:', err);
    alert('导入失败：' + (err.message || '未知错误'));
  }
}

function showImportPreview(result) {
  const body = $('#import-body');
  const txns = result.transactions;
  const skipped = result.skipped || [];

  let totalExpense = 0;
  let totalIncome = 0;

  let rowsHtml = txns.map((t, i) => {
    const isExpense = t.type === 0;
    const prefix = isExpense ? '-' : '+';
    const amtClass = isExpense ? 'expense' : 'income';
    if (isExpense) totalExpense += t.amount;
    else totalIncome += t.amount;

    const catDisplay = t.category_name || '未分类';
    const acctDisplay = t.account_name || '未指定';
    const catMatch = t.category_id ? ' ✓' : '';
    const acctMatch = t.account_id ? ' ✓' : '';

    return (
      '<div class="import-row">' +
        '<div class="col-date">' + escapeHtml(formatListDate(t.date)) + '</div>' +
        '<div class="col-cat">' + escapeHtml(catDisplay) + '<span style="color:' + (t.category_id ? 'var(--income)' : 'var(--text-muted)') + ';font-size:10px;">' + catMatch + '</span></div>' +
        '<div class="col-note">' + escapeHtml(t.note || '—') + '</div>' +
        '<div class="col-account">' + escapeHtml(acctDisplay) + '<span style="color:' + (t.account_id ? 'var(--income)' : 'var(--text-muted)') + ';font-size:10px;">' + acctMatch + '</span></div>' +
        '<div class="col-amount ' + amtClass + '">' + prefix + formatMoney(t.amount).replace('¥', '') + '</div>' +
      '</div>'
    );
  }).join('');

  let skippedHtml = '';
  if (skipped.length > 0) {
    skippedHtml = '<div style="color:var(--text-muted);font-size:12px;margin-top:8px;">跳过 ' + skipped.length + ' 行（无法解析金额）</div>';
  }

  body.innerHTML =
    '<div style="margin-bottom:12px;color:var(--text-secondary);">' +
      '共解析到 <strong>' + txns.length + '</strong> 条记录，' +
      '支出合计 <strong class="expense-color">' + formatMoney(totalExpense) + '</strong>，' +
      '收入合计 <strong class="income-color">' + formatMoney(totalIncome) + '</strong>' +
      '<br><span style="font-size:11px;color:var(--text-muted);">✓ 表示已匹配到现有分类/账户</span>' +
    '</div>' +
    '<div class="list-header">' +
      '<div class="col-date">日期</div>' +
      '<div class="col-cat">分类</div>' +
      '<div class="col-note">备注</div>' +
      '<div class="col-account">账户</div>' +
      '<div class="col-amount">金额</div>' +
    '</div>' +
    '<div class="import-list-body">' + rowsHtml + '</div>' +
    skippedHtml +
    '<div style="margin-top:16px;display:flex;gap:8px;">' +
      '<button class="btn-primary" id="import-confirm">确认导入 ' + txns.length + ' 条</button>' +
      '<button class="btn-small" id="import-cancel">取消</button>' +
    '</div>';

  $('#import-overlay').style.display = 'flex';

  $('#import-confirm').addEventListener('click', () => executeImportAndClose(txns));
  $('#import-cancel').addEventListener('click', closeImportModal);
}

async function executeImportAndClose(transactions) {
  const btn = $('#import-confirm');
  btn.textContent = '导入中...';
  btn.disabled = true;

  try {
    const result = await window.api.executeImport(transactions);
    closeImportModal();
    await refreshSummary();
    if (state.currentTab === 'tab-list') {
      await loadTransactions();
      await loadFilterSelects();
    }
    alert('成功导入 ' + result.imported + ' 条记录' + (result.failed > 0 ? '，' + result.failed + ' 条失败' : ''));
  } catch (err) {
    console.error('executeImportAndClose error:', err);
    alert('导入失败：' + (err.message || '未知错误'));
  } finally {
    btn.textContent = '确认导入';
    btn.disabled = false;
  }
}

function closeImportModal() {
  $('#import-overlay').style.display = 'none';
  $('#import-body').innerHTML = '';
}

function setupImportModalListeners() {
  $('#import-close').addEventListener('click', closeImportModal);
  $('#import-overlay').addEventListener('click', e => {
    if (e.target === $('#import-overlay')) closeImportModal();
  });
}

function setupEditModalListeners() {
  $('#edit-close').addEventListener('click', closeEditModal);
  $('#edit-overlay').addEventListener('click', e => {
    if (e.target === $('#edit-overlay')) closeEditModal();
  });
}

// ═══════════════════════════════════════════════════════════════════════
// BACKGROUND
// ═══════════════════════════════════════════════════════════════════════

async function loadAndApplyBackground() {
  try {
    state._bgType = await window.api.getSetting('background_type');
    state._bgValue = await window.api.getSetting('background_value');
    applyBackgroundToBody();
  } catch (err) {
    console.error('loadAndApplyBackground error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  console.log('app initializing...');

  // Set today's date
  $('#input-date').value = toDatetimeLocal(getToday());

  // Load initial data for the default tab (记账)
  await loadCategories();
  await loadAccounts();
  await refreshSummary();

  // Apply custom background
  await loadAndApplyBackground();

  // Setup all event listeners
  setupTabListeners();
  setupTypeToggle();
  setupSaveButton();
  setupListFilters();
  setupBatchDelete();
  setupChartRangeChips();
  setupOCR();
  setupSettingsListeners();
  setupEditModalListeners();
  setupImportModalListeners();
  setupKeyboardShortcuts();

  console.log('app initialized');
});
