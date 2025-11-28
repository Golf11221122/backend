/**
 * app.js - Full revised app script (ESM)
 * - Uses Supabase ESM build via jsDelivr (+esm)
 * - Supports "Add new supplier" modal flow
 * - Improved error logging and defensive checks
 * - Designed to run from a local/static server with index.html & styles.css provided earlier
 *
 * Usage:
 * - Ensure index.html loads this file as: <script type="module" src="./app.js"></script>
 * - Ensure the DOM contains the expected element IDs (see index.html provided earlier).
 */

/* ===========================
   Supabase init (ESM)
   =========================== */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://yqypgcfxaavhohcjyrez.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxeXBnY2Z4YWF2aG9oY2p5cmV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MDE4OTgsImV4cCI6MjA3OTQ3Nzg5OH0.tU6BaAtjCmEAQDyntJQ89ZG3ARByXYVj2w73h35JzcM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  // optional settings can go here
});

/* ===========================
   DOM references & state
   =========================== */
const pages = document.querySelectorAll('.page');
const navBtns = document.querySelectorAll('.nav-btn');

const supplierSelect = document.getElementById('supplier-select');
const branchSelect = document.getElementById('branch-select');
const fromBranchSelect = document.getElementById('from-branch-select');
const toBranchSelect = document.getElementById('to-branch-select');

const stockInItemsContainer = document.getElementById('stock-in-items');
const transferItemsContainer = document.getElementById('transfer-items');

const stockInForm = document.getElementById('stock-in-form');
const stockTransferForm = document.getElementById('stock-transfer-form');

const stockInMessage = document.getElementById('stock-in-message');
const stockTransferMessage = document.getElementById('stock-transfer-message');

const totalSalesEl = document.getElementById('total-sales');
const stockAlertsEl = document.getElementById('stock-alerts');
const productMixEl = document.getElementById('product-mix');
const branchSalesEl = document.getElementById('branch-sales');

const reportsTable = document.getElementById('reports-table')?.querySelector('tbody');
const reportsSearch = document.getElementById('reports-search');
const reportsFrom = document.getElementById('reports-from');
const reportsTo = document.getElementById('reports-to');
const reportsRefresh = document.getElementById('reports-refresh');
const reportProductMixEl = document.getElementById('report-product-mix');

/* Modal for adding supplier */
const addSupplierModal = document.getElementById('modal-add-supplier');
const inputNewSupplierName = document.getElementById('input-new-supplier-name');
const formAddSupplier = document.getElementById('form-add-supplier');
const btnCancelAddSupplier = document.getElementById('btn-cancel-add-supplier');
const addSupplierMsg = document.getElementById('add-supplier-msg');

/* internal state caches */
let ingredients = [];
let menus = [];
let suppliers = [];
let branches = [];

const ADD_NEW_VALUE = '__ADD_NEW_SUPPLIER__';

/* ===========================
   Navigation
   =========================== */
navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    navBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const page = btn.getAttribute('data-page');
    showPage(page);
  });
});
function showPage(pageId) {
  pages.forEach(p => p.classList.add('hidden'));
  const sel = document.getElementById(pageId);
  if (sel) sel.classList.remove('hidden');
}

/* ===========================
   Dynamic item row helpers
   =========================== */
function createItemRow(container, opts = {}) {
  const id = `item-${Date.now()}-${Math.floor(Math.random()*1000)}`;
  const wrapper = document.createElement('div');
  wrapper.className = 'form-row';
  wrapper.dataset.rowId = id;

  // Ingredient select (populated from ingredients cache)
  const ingredientLabel = document.createElement('label');
  ingredientLabel.innerHTML = `Ingredient
    <select required class="ingredient-select">
      <option value="">-- select ingredient --</option>
    </select>`;
  const selectEl = ingredientLabel.querySelector('select');
  ingredients.forEach(ing => {
    const opt = document.createElement('option');
    opt.value = ing.id;
    opt.textContent = ing.name;
    selectEl.appendChild(opt);
  });

  // Quantity input
  const qtyLabel = document.createElement('label');
  qtyLabel.innerHTML = `Quantity
    <input required type="number" min="0.001" step="0.001" class="qty-input" value="${opts.quantity || 1}" />
  `;

  // Unit input
  const unitLabel = document.createElement('label');
  unitLabel.innerHTML = `Unit
    <input required type="text" class="unit-input" value="${opts.unit || 'pcs'}" />
  `;

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => wrapper.remove());

  wrapper.appendChild(ingredientLabel);
  wrapper.appendChild(qtyLabel);
  wrapper.appendChild(unitLabel);
  wrapper.appendChild(removeBtn);

  container.appendChild(wrapper);
}

/* Add initial rows and bind add buttons */
document.getElementById('add-stock-item')?.addEventListener('click', () => createItemRow(stockInItemsContainer));
document.getElementById('add-transfer-item')?.addEventListener('click', () => createItemRow(transferItemsContainer));
createItemRow(stockInItemsContainer);
createItemRow(transferItemsContainer);

/* ===========================
   Populate selects (with add-new option for supplier)
   =========================== */
function populateSelect(selectEl, data, placeholder = '-- select --', allowAdd = false) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  const p = document.createElement('option');
  p.value = '';
  p.textContent = placeholder;
  selectEl.appendChild(p);
  (data || []).forEach(r => {
    const o = document.createElement('option');
    o.value = r.id;
    o.textContent = r.name;
    selectEl.appendChild(o);
  });
  if (allowAdd) {
    const addOpt = document.createElement('option');
    addOpt.value = ADD_NEW_VALUE;
    addOpt.textContent = '➕ Add new supplier...';
    addOpt.dataset.addNew = 'true';
    selectEl.appendChild(addOpt);
  }
}

/* supplier select: open modal when Add new chosen */
supplierSelect?.addEventListener('change', (e) => {
  if (e.target.value === ADD_NEW_VALUE) {
    // open modal and reset select (so it won't stay on the special value)
    supplierSelect.value = '';
    openAddSupplierModal();
  }
});

/* ===========================
   Load reference data
   =========================== */
async function loadReferences() {
  try {
    // fetch parallel and tolerate partial failures
    const [
      ingRes,
      branchRes,
      supplierRes,
      menusRes
    ] = await Promise.all([
      supabase.from('ingredients').select('id,name,unit,low_stock_threshold').order('name', { ascending: true }),
      supabase.from('branches').select('id,name').order('name', { ascending: true }),
      supabase.from('suppliers').select('id,name').order('name', { ascending: true }),
      supabase.from('menus').select('id,name,price').order('name', { ascending: true })
    ]);

    if (ingRes.error) console.warn('ingredients load error', ingRes.error);
    if (branchRes.error) console.warn('branches load error', branchRes.error);
    if (supplierRes.error) console.warn('suppliers load error', supplierRes.error);
    if (menusRes.error) console.warn('menus load error', menusRes.error);

    ingredients = ingRes.data || [];
    branches = branchRes.data || [];
    suppliers = supplierRes.data || [];
    menus = menusRes.data || [];

    populateSelect(supplierSelect, suppliers, '-- select supplier --', true);
    populateSelect(branchSelect, branches, '-- select branch --');
    populateSelect(fromBranchSelect, branches, '-- from branch --');
    populateSelect(toBranchSelect, branches, '-- to branch --');

    // update ingredient selects already present in dynamic rows
    document.querySelectorAll('.ingredient-select').forEach(sel => {
      // remove options except the placeholder (index 0)
      while (sel.options.length > 1) sel.remove(1);
      ingredients.forEach(ing => {
        const o = document.createElement('option');
        o.value = ing.id;
        o.textContent = ing.name;
        sel.appendChild(o);
      });
    });
  } catch (err) {
    console.error('loadReferences unexpected error', err);
  }
}

/* ===========================
   Dashboard & Reports
   =========================== */
async function loadDashboardAndReports() {
  try {
    // Total sales - fetch receipts and sum client-side to avoid SQL dialect differences
    const { data: receipts, error: receiptsErr } = await supabase.from('receipts').select('id,total,branch_id,created_at');
    if (receiptsErr) {
      console.warn('receipts load error', receiptsErr);
      totalSalesEl && (totalSalesEl.textContent = formatCurrency(0));
    } else {
      const sum = (receipts || []).reduce((s, r) => s + (Number(r.total) || 0), 0);
      totalSalesEl && (totalSalesEl.textContent = formatCurrency(sum));
    }

    // Reports (aggregate)
    await loadReportData();

    // Stock alerts (try to fetch stock balance view/table)
    // NOTE: cannot select related objects if no foreign key relationships exist.
    // Fetch base stock balance, then fetch ingredient/branch names separately and join client-side.
    const { data: stockBalRaw, error: sbErr } = await supabase
      .from('ingredients_stock_balance')
      .select('*')
      .order('current_stock', { ascending: true });

    if (sbErr) {
      console.warn('stock balance fetch error', sbErr);
      if (stockAlertsEl) stockAlertsEl.innerHTML = '<li>Error loading stock</li>';
    } else {
      // ensure we have ingredient and branch name caches (load if not present)
      if (!ingredients || ingredients.length === 0) {
        const { data: ingFetch } = await supabase.from('ingredients').select('id,name');
        ingredients = ingFetch || [];
      }
      if (!branches || branches.length === 0) {
        const { data: branchFetch } = await supabase.from('branches').select('id,name');
        branches = branchFetch || [];
      }

      if (!stockBalRaw || stockBalRaw.length === 0) {
        if (stockAlertsEl) stockAlertsEl.innerHTML = '<li>No stock data</li>';
      } else {
        // manual join to attach names
        const stockData = (stockBalRaw || []).map(row => {
          const ing = ingredients.find(i => String(i.id) === String(row.ingredient_id));
          const br = branches.find(b => String(b.id) === String(row.branch_id));
          return {
            ...row,
            ingredient_name: ing ? ing.name : (row.ingredient_name || ''),
            branch_name: br ? br.name : (row.branch_name || '')
          };
        });

        if (stockAlertsEl) {
          stockAlertsEl.innerHTML = '';
          stockData.forEach(a => {
            const li = document.createElement('li');
            li.textContent = `${a.ingredient_name || 'Unknown'} @ ${a.branch_name || 'Unknown'}: ${a.current_stock}`;
            stockAlertsEl.appendChild(li);
          });
        }
      }
    }

    // Sales by branch - aggregate client-side (avoid group() usage)
    if (Array.isArray(receipts)) {
      const map = new Map();
      receipts.forEach(r => {
        const bid = r.branch_id || 'unknown';
        const curr = map.get(bid) || 0;
        map.set(bid, curr + (Number(r.total) || 0));
      });
      if (branchSalesEl) {
        branchSalesEl.innerHTML = '';
        for (const [branchId, total] of map.entries()) {
          const branch = branches.find(x => String(x.id) === String(branchId));
          const name = branch ? branch.name : branchId;
          const li = document.createElement('li');
          li.textContent = `${name}: ${formatCurrency(total || 0)}`;
          branchSalesEl.appendChild(li);
        }
      }
    }
  } catch (err) {
    console.error('loadDashboardAndReports unexpected', err);
  }
}

async function loadReportData() {
  try {
    const fromDate = reportsFrom?.value ? new Date(reportsFrom.value + 'T00:00:00') : null;
    const toDate = reportsTo?.value ? new Date(reportsTo.value + 'T23:59:59') : null;

    const { data: itemsData, error: itemsErr } = await supabase
      .from('receipt_items')
      .select('menu_id, quantity, unit_price, receipts(created_at)')
      .order('menu_id', { ascending: true });

    if (itemsErr) {
      console.warn('receipt_items load error', itemsErr);
      reportsTable && (reportsTable.innerHTML = '<tr><td colspan="3">Error loading report data</td></tr>');
      return;
    }

    const filtered = (itemsData || []).filter(row => {
      const created = row.receipts && row.receipts.created_at ? new Date(row.receipts.created_at) : null;
      if (!created) return true;
      if (fromDate && created < fromDate) return false;
      if (toDate && created > toDate) return false;
      return true;
    });

    const map = new Map();
    filtered.forEach(it => {
      const key = it.menu_id;
      if (!map.has(key)) map.set(key, { quantity: 0, revenue: 0 });
      const rec = map.get(key);
      rec.quantity = Number(rec.quantity) + Number(it.quantity || 0);
      rec.revenue = Number(rec.revenue) + (Number(it.unit_price || 0) * Number(it.quantity || 0));
    });

    const rows = [];
    for (const [menu_id, agg] of map.entries()) {
      const menu = menus.find(m => m.id === menu_id);
      rows.push({
        menu_id,
        menu_name: menu ? menu.name : String(menu_id),
        quantity: agg.quantity,
        revenue: agg.revenue
      });
    }

    rows.sort((a,b) => b.revenue - a.revenue);

    renderReportsTable(rows);
    renderProductMix(rows);
  } catch (err) {
    console.error('loadReportData unexpected', err);
  }
}

function renderReportsTable(rows) {
  if (!reportsTable) return;
  if (!rows || rows.length === 0) {
    reportsTable.innerHTML = '<tr><td colspan="3">No sales yet</td></tr>';
    reportProductMixEl && (reportProductMixEl.innerHTML = '');
    return;
  }
  const search = reportsSearch?.value.trim().toLowerCase() || '';
  let filtered = rows;
  if (search) filtered = rows.filter(r => r.menu_name.toLowerCase().includes(search));
  reportsTable.innerHTML = '';
  filtered.forEach(r => {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td'); nameTd.textContent = r.menu_name;
    const qtyTd = document.createElement('td'); qtyTd.textContent = Number(r.quantity).toFixed(3).replace(/\.000$/, '');
    const revTd = document.createElement('td'); revTd.textContent = formatCurrency(r.revenue);
    tr.appendChild(nameTd); tr.appendChild(qtyTd); tr.appendChild(revTd);
    reportsTable.appendChild(tr);
  });
}

function renderProductMix(rows) {
  const top = (rows || []).slice(0,5);
  productMixEl && (productMixEl.innerHTML = '');
  reportProductMixEl && (reportProductMixEl.innerHTML = '');
  if (top.length === 0) {
    productMixEl && (productMixEl.innerHTML = '<li>N/A</li>');
    reportProductMixEl && (reportProductMixEl.innerHTML = '<li>N/A</li>');
    return;
  }
  top.forEach(t => {
    const li = document.createElement('li'); li.textContent = `${t.menu_name} — ${t.quantity} sold (${formatCurrency(t.revenue)})`;
    productMixEl && productMixEl.appendChild(li);
    reportProductMixEl && reportProductMixEl.appendChild(li.cloneNode(true));
  });
}

function formatCurrency(x) {
  try {
    const n = Number(x || 0);
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  } catch (e) { return String(x); }
}

/* ===========================
   Stock In submit handler (robust)
   =========================== */

/**
 * Attempts to insert a single row into stock_in.
 * If the error indicates a missing column, remove that column from payload and retry.
 * payload is an object we will mutate locally (make a shallow copy before calling)
 */
async function insertStockInHeaderWithRetries(payload) {
  // make a shallow copy so caller's object is preserved
  let attemptPayload = { ...payload };
  const triedColumnsRemoved = new Set();

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await supabase.from('stock_in').insert(attemptPayload).select().limit(1).single();
      if (res.error) throw res.error;
      return res.data; // success
    } catch (err) {
      const msg = (err && (err.message || err.error_description || String(err))).toString().toLowerCase();
      console.warn('stock_in insert attempt error (attempt ' + attempt + '):', msg);

      // look for "could not find the 'xyz' column" pattern
      const m = msg.match(/could not find the '([^']+)' column/);
      if (m && m[1]) {
        const col = m[1];
        if (!triedColumnsRemoved.has(col)) {
          triedColumnsRemoved.add(col);
          // remove the problematic column from payload and retry
          if (col in attemptPayload) {
            delete attemptPayload[col];
            console.info(`Removed column "${col}" from payload and retrying insert.`);
            continue;
          } else {
            // if column not in payload, cannot fix by removal
            throw err;
          }
        } else {
          // already removed once, give up
          throw err;
        }
      }

      // look for schema cache / column not found generic messages
      if (msg.includes('schema cache') || msg.includes('column') && msg.includes('not found')) {
        // try removing common fields one-by-one that our code sends, if present
        const commonFields = ['note', 'branch_id', 'supplier_id', 'supplier', 'invoice_number', 'invoice_numb', 'date_receive'];
        let removed = false;
        for (const f of commonFields) {
          if (!triedColumnsRemoved.has(f) && (f in attemptPayload)) {
            triedColumnsRemoved.add(f);
            delete attemptPayload[f];
            console.info(`Removed suspected column "${f}" from payload and retrying.`);
            removed = true;
            break;
          }
        }
        if (removed) continue;
      }

      // If error is something else, rethrow
      throw err;
    }
  }

  throw new Error('Failed to insert stock_in header after retries');
}

stockInForm?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!stockInMessage) return;
  stockInMessage.textContent = ''; stockInMessage.className = 'message';

  const supplierId = supplierSelect?.value;
  const branchId = branchSelect?.value;
  if (!supplierId || !branchId) {
    stockInMessage.textContent = 'Please select supplier and branch.';
    stockInMessage.classList.add('error');
    return;
  }

  const rows = Array.from(stockInItemsContainer.querySelectorAll('.form-row'));
  const items = [];
  for (const row of rows) {
    const ing = row.querySelector('.ingredient-select').value;
    const qty = parseFloat(row.querySelector('.qty-input').value);
    const unit = row.querySelector('.unit-input').value.trim();
    if (!ing || !qty || qty <= 0 || !unit) {
      stockInMessage.textContent = 'Please fill all item fields with valid values.';
      stockInMessage.classList.add('error');
      return;
    }
    items.push({ ingredient_id: ing, quantity: qty, unit: unit });
  }

  // Prepare header payload (include note by default)
  const headerPayload = {
    supplier_id: supplierId,
    branch_id: branchId,
    note: 'Created from backoffice UI',
    created_at: new Date().toISOString()
  };

  try {
    // Try insert header with retries that strip unknown columns if necessary
    const headerData = await insertStockInHeaderWithRetries(headerPayload);
    if (!headerData || !headerData.id) {
      throw new Error('Header insert did not return id');
    }
    const stockInId = headerData.id;

    // Insert items associated with header
    const itemsToInsert = items.map(i => ({
      stock_in_id: stockInId,
      ingredient_id: i.ingredient_id,
      quantity: i.quantity,
      unit: i.unit
    }));

    const { error: itemsErr } = await supabase.from('stock_in_item').insert(itemsToInsert);
    if (itemsErr) {
      console.error('stock_in_item error', itemsErr);
      throw itemsErr;
    }

    stockInMessage.textContent = 'Stock In recorded successfully.';
    stockInMessage.classList.add('success');

    stockInForm.reset();
    stockInItemsContainer.innerHTML = '';
    createItemRow(stockInItemsContainer);

    // reload dashboard data
    await loadDashboardAndReports();
  } catch (err) {
    console.error('stock in error', err);
    // Friendly error messages
    const em = (err && (err.message || JSON.stringify(err))) || 'Unknown error';
    if ((err && err.code === '42501') || (em.toLowerCase().includes('permission') || em.toLowerCase().includes('forbidden'))) {
      stockInMessage.textContent = 'Permission denied. Check RLS policies for stock_in / stock_in_item.';
    } else {
      stockInMessage.textContent = 'Error saving stock in: ' + em;
    }
    stockInMessage.classList.add('error');
  }
});

/* ===========================
   Stock Transfer helpers & submit (FIXED VERSION)
   =========================== */

/**
 * Create a stock_transfer header row.
 */
async function createStockTransferHeader(payload) {
  try {
    const user = supabase.auth.getUser ? (await supabase.auth.getUser()).data.user : null;
    const userId = user?.id || null;

    // inject created_by for RLS
    const finalPayload = {
      ...payload,
      created_by: userId
    };

    const res = await supabase
      .from('stock_transfer')
      .insert(finalPayload)
      .select()
      .limit(1)
      .single();

    if (res.error) throw res.error;
    return res.data;
  } catch (err) {
    console.error('createStockTransferHeader error', err);
    throw err;
  }
}

/**
 * Insert items for a given transfer.
 * Ensures created_by exists for RLS.
 */
async function insertStockTransferItems(transferId, items) {
  const user = supabase.auth.getUser ? (await supabase.auth.getUser()).data.user : null;
  const userId = user?.id || null;

  // Standard column name (use ONLY ONE to avoid RLS rejects)
  const payload = items.map(i => ({
    stock_transfer_id: transferId,
    ingredient_id: i.ingredient_id,
    qty: i.quantity,
    unit: i.unit,
    created_by: userId
  }));

  const r = await supabase.from('stock_transfer_item').insert(payload);
  if (r.error) throw r.error;

  return r.data;
}

stockTransferForm?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!stockTransferMessage) return;
  stockTransferMessage.textContent = ''; 
  stockTransferMessage.className = 'message';

  const fromBranch = fromBranchSelect?.value;
  const toBranch = toBranchSelect?.value;

  if (!fromBranch || !toBranch || fromBranch === toBranch) {
    stockTransferMessage.textContent = 'Please select different From and To branches.';
    stockTransferMessage.classList.add('error');
    return;
  }

  const rows = Array.from(transferItemsContainer.querySelectorAll('.form-row'));
  const items = [];

  for (const row of rows) {
    const ing = row.querySelector('.ingredient-select').value;
    const qty = parseFloat(row.querySelector('.qty-input').value);
    const unit = row.querySelector('.unit-input').value.trim();

    if (!ing || !qty || qty <= 0 || !unit) {
      stockTransferMessage.textContent = 'Please fill all item fields with valid values.';
      stockTransferMessage.classList.add('error');
      return;
    }
    items.push({ ingredient_id: ing, quantity: qty, unit });
  }

  try {
    // Header payload
    const headerPayload = {
      from_branch: fromBranch,
      to_branch: toBranch,
      date: new Date().toISOString()
    };

    const headerRes = await createStockTransferHeader(headerPayload);
    if (!headerRes?.id) throw new Error('Transfer header insert failed');

    const transferId = headerRes.id;

    // Insert items
    await insertStockTransferItems(transferId, items);

    stockTransferMessage.textContent = 'Stock Transfer recorded successfully.';
    stockTransferMessage.classList.add('success');

    stockTransferForm.reset();
    transferItemsContainer.innerHTML = '';
    createItemRow(transferItemsContainer);

    await loadDashboardAndReports();

  } catch (err) {
    console.error('stock transfer error', err);

    const em = err?.message || JSON.stringify(err);

    if (
      err?.code === '42501' ||
      em.toLowerCase().includes('permission') ||
      em.toLowerCase().includes('rls') ||
      em.toLowerCase().includes('forbidden')
    ) {
      stockTransferMessage.textContent =
        'Permission denied (RLS). Your JS now sends created_by automatically. If error persists, check RLS: allow insert where created_by = auth.uid().';
    } else {
      stockTransferMessage.textContent = 'Error saving stock transfer: ' + em;
    }

    stockTransferMessage.classList.add('error');
  }
});


/* ===========================
   Add Supplier modal logic
   =========================== */
function openAddSupplierModal() {
  if (!addSupplierModal) return;
  addSupplierMsg.textContent = '';
  addSupplierMsg.className = 'message';
  inputNewSupplierName.value = '';
  addSupplierModal.classList.remove('hidden');
  addSupplierModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => inputNewSupplierName.focus(), 50);
}
function closeAddSupplierModal() {
  if (!addSupplierModal) return;
  addSupplierModal.classList.add('hidden');
  addSupplierModal.setAttribute('aria-hidden', 'true');
}
btnCancelAddSupplier?.addEventListener('click', (e) => {
  e.preventDefault();
  closeAddSupplierModal();
});
document.getElementById('modal-backdrop')?.addEventListener('click', closeAddSupplierModal);

formAddSupplier?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  addSupplierMsg.textContent = '';
  addSupplierMsg.className = 'message';
  const name = (inputNewSupplierName?.value || '').trim();
  if (!name) {
    addSupplierMsg.textContent = 'โปรดระบุชื่อ supplier';
    addSupplierMsg.classList.add('error');
    return;
  }
  try {
    const { data, error } = await supabase.from('suppliers').insert({ name }).select().single();
    if (error) throw error;
    suppliers.push(data);
    populateSelect(supplierSelect, suppliers, '-- select supplier --', true);
    supplierSelect.value = data.id;
    addSupplierMsg.textContent = 'เพิ่ม supplier สำเร็จ';
    addSupplierMsg.classList.add('success');
    setTimeout(() => closeAddSupplierModal(), 700);
  } catch (err) {
    console.error('add supplier error', err);
    if (err && err.message && err.message.toLowerCase().includes('permission')) {
      addSupplierMsg.textContent = 'Permission denied. Cannot add supplier. Check RLS/policies.';
    } else {
      addSupplierMsg.textContent = 'เกิดข้อผิดพลาด: ' + (err.message || JSON.stringify(err));
    }
    addSupplierMsg.classList.add('error');
  }
});

/* ===========================
   Realtime subscriptions
   =========================== */
function setupRealtime() {
  try {
    // receipts & receipt_items
    supabase
      .channel('public:receipts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'receipts' }, () => {
        loadDashboardAndReports();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'receipt_items' }, () => {
        loadDashboardAndReports();
      })
      .subscribe();

    // ingredients_stock_balance
    supabase
      .channel('public:ingredients_stock_balance')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingredients_stock_balance' }, () => {
        loadDashboardAndReports();
      })
      .subscribe();
  } catch (e) {
    console.warn('Realtime subscription failed or not available', e);
  }
}

/* ===========================
   Reports controls & table sorting
   =========================== */
reportsRefresh?.addEventListener('click', loadReportData);
reportsSearch?.addEventListener('input', () => loadReportData());

// simple client-side table sorting
document.querySelectorAll('#reports-table thead th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    const rows = Array.from(reportsTable.querySelectorAll('tr')).map(tr => {
      const tds = tr.querySelectorAll('td');
      return {
        row: tr,
        menu_name: tds[0]?.textContent || '',
        quantity: parseFloat(tds[1]?.textContent || '0'),
        revenue: parseCurrency(tds[2]?.textContent || '0')
      };
    });
    const asc = !th.classList.contains('asc');
    document.querySelectorAll('#reports-table thead th.sortable').forEach(x => x.classList.remove('asc','desc'));
    th.classList.add(asc ? 'asc' : 'desc');
    rows.sort((a,b) => {
      if (a[key] < b[key]) return asc ? -1 : 1;
      if (a[key] > b[key]) return asc ? 1 : -1;
      return 0;
    });
    reportsTable.innerHTML = '';
    rows.forEach(r => reportsTable.appendChild(r.row));
  });
});

function parseCurrency(s) {
  return Number((s || '').toString().replace(/[^0-9.-]+/g,"")) || 0;
}

/* ===========================
   Init
   =========================== */
(async function init() {
  // load references and dashboard
  await loadReferences();
  await loadDashboardAndReports();
  setupRealtime();
})();

