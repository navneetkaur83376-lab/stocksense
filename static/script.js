const API_BASE = '/api';
let token = localStorage.getItem('stocksense_token') || null;
let currentUser = null;

// ----- caches -----
let products = [];
let warehouses = [];
let stockRows = [];      // per product x warehouse breakdown
let deliveries = [];
let receipts = [];
let transfers = [];
let adjustmentsLog = [];
let ledgerRows = [];
let activeDeliveryId = null;

let searchTerm = '', warehouseFilterValue = 'all', stockStatusValue = 'all';

// ===================== API HELPER =====================
async function api(path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API_BASE + path, Object.assign({}, options, { headers }));
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const message = (data && data.message) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

// ===================== AUTH =====================
function setAuthMode(mode) {
  document.getElementById('tabLogin').classList.toggle('active', mode === 'login');
  document.getElementById('tabSignup').classList.toggle('active', mode === 'signup');
  document.getElementById('loginForm').style.display = mode === 'login' ? 'flex' : 'none';
  document.getElementById('signupForm').style.display = mode === 'signup' ? 'flex' : 'none';
  document.getElementById('authMessage').textContent = '';
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  try {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    token = data.token;
    localStorage.setItem('stocksense_token', token);
    currentUser = data.user;
    await enterApp();
  } catch (err) {
    showAuthMessage(err.message, true);
  }
  return false;
}

async function handleSignup(e) {
  e.preventDefault();
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  try {
    await api('/auth/signup', { method: 'POST', body: JSON.stringify({ name, email, password }) });
    showAuthMessage('Account created — logging you in…', false);
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    token = data.token;
    localStorage.setItem('stocksense_token', token);
    currentUser = data.user;
    await enterApp();
  } catch (err) {
    showAuthMessage(err.message, true);
  }
  return false;
}

function handleLogout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('stocksense_token');
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('authScreen').style.display = 'flex';
}

function showAuthMessage(msg, isError) {
  const el = document.getElementById('authMessage');
  el.textContent = msg;
  el.style.color = isError ? '#d95748' : '#2e9d6d';
}

async function checkExistingSession() {
  if (!token) return showLogin();
  try {
    const data = await api('/auth/me');
    currentUser = data.user;
    await enterApp();
  } catch (err) {
    token = null;
    localStorage.removeItem('stocksense_token');
    showLogin();
  }
}

function showLogin() {
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('appShell').style.display = 'none';
}

async function enterApp() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';
  document.getElementById('userName').textContent = currentUser.name;
  document.getElementById('userAvatar').textContent = currentUser.name
    .split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
  const eyebrow = document.getElementById('heroDate');
  eyebrow.textContent = 'OPERATIONS / ' + new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  await loadAll();
}

// ===================== DATA LOADING =====================
async function loadAll() {
  try {
    const [prod, wh, stock, del, rec, trf, adj, led, summary] = await Promise.all([
      api('/products'),
      api('/warehouses'),
      api('/products/stock/breakdown'),
      api('/deliveries'),
      api('/receipts'),
      api('/transfers'),
      api('/adjustments'),
      api('/ledger'),
      api('/dashboard/summary')
    ]);
    products = prod; warehouses = wh; stockRows = stock;
    deliveries = del; receipts = rec; transfers = trf;
    adjustmentsLog = adj; ledgerRows = led;

    populateFilterSelects();
    populateFormSelects();
    renderDashboardKPIs(summary);
    renderInventory();
    renderAlerts();
    renderWarehouseUtilization();
    renderDashboardTimeline();
    renderWarehouseCards();
    renderDeliveryQueue();
    renderReceiptQueue();
    renderTransferQueue();
    renderAdjustmentLog();
    renderLedger();
    updateDeliveryPreview();
    updateTransferPreview();
    updateAdjustment();
    updateHealthCard(summary);
  } catch (err) {
    console.error('Failed to load data:', err);
  }
}

function updateHealthCard(summary) {
  const total = summary.totalUnits || 0;
  const problems = (summary.lowCount || 0) + (summary.outCount || 0);
  const pct = total === 0 ? 100 : Math.max(0, Math.round(100 - (problems / Math.max(products.length, 1)) * 100));
  document.getElementById('healthPct').textContent = pct + '%';
  document.getElementById('healthBar').style.width = pct + '%';
  document.getElementById('healthNote').textContent = problems === 0
    ? 'All inventory services operational'
    : `${problems} item(s) need attention`;
}

// ===================== helpers over cached data =====================
function stockFor(productId, warehouseId) {
  const row = stockRows.find(r => r.product_id == productId && r.warehouse_id == warehouseId);
  return row ? row.quantity : 0;
}
function productById(id) { return products.find(p => p.id == id); }
function warehouseById(id) { return warehouses.find(w => w.id == id); }
function statusFor(stock, minStock) {
  if (stock === 0) return 'out';
  if (stock <= minStock) return 'low';
  return 'in';
}
function statusLabel(s) { return s === 'out' ? 'OUT OF STOCK' : s === 'low' ? 'LOW STOCK' : 'IN STOCK'; }
function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

// ===================== SELECTS =====================
function populateFilterSelects() {
  const options = '<option value="all">All locations</option>' +
    warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
  ['warehouseFilter', 'warehouseFilter2'].forEach(id => {
    const el = document.getElementById(id);
    const current = el.value || 'all';
    el.innerHTML = options;
    el.value = current;
  });
}

function populateFormSelects() {
  const whOptions = warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
  const prodOptions = products.map(p => `<option value="${p.id}">${p.sku} — ${p.name}</option>`).join('');

  ['receiptWarehouse', 'deliveryWarehouse', 'transferFrom', 'transferTo', 'adjustWarehouse'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = whOptions;
  });
  ['receiptProduct', 'deliveryProduct', 'transferProduct', 'adjustProduct'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = prodOptions;
  });
}

// ===================== NAVIGATION =====================
function showSection(id) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active-section'));
  document.getElementById(id).classList.add('active-section');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.section === id));
  const labels = { dashboard: 'OVERVIEW', receiving: 'RECEIVING', deliveries: 'DELIVERY ORDERS', transfers: 'TRANSFERS', adjustments: 'STOCK ADJUSTMENTS', inventory: 'INVENTORY', warehouse: 'WAREHOUSES', activity: 'STOCK LEDGER' };
  document.getElementById('pageCrumb').textContent = labels[id] || 'OVERVIEW';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => showSection(btn.dataset.section)));
});

// ===================== INVENTORY / DASHBOARD RENDERING =====================
function syncSearch(v) {
  ['globalSearch', 'inventorySearch2'].forEach(id => { const el = document.getElementById(id); if (el) el.value = v; });
  searchTerm = v; renderInventory();
}
function syncWarehouse(v) {
  ['warehouseFilter', 'warehouseFilter2'].forEach(id => { const el = document.getElementById(id); if (el) el.value = v; });
  warehouseFilterValue = v; renderInventory();
}
function syncStock(v) {
  ['stockFilter', 'stockFilter2'].forEach(id => { const el = document.getElementById(id); if (el) el.value = v; });
  stockStatusValue = v; renderInventory();
}

function filteredStockRows() {
  return stockRows.filter(r => {
    const text = (r.name + ' ' + r.sku + ' ' + (r.category || '')).toLowerCase();
    const matchesSearch = text.includes(searchTerm.toLowerCase());
    const matchesWarehouse = warehouseFilterValue === 'all' || String(r.warehouse_id) === String(warehouseFilterValue);
    const matchesStock = stockStatusValue === 'all' || statusFor(r.quantity, r.min_stock) === stockStatusValue;
    return matchesSearch && matchesWarehouse && matchesStock;
  });
}

function renderInventory() {
  const rows = filteredStockRows();
  const empty = `<tr><td colspan="7" style="padding:25px;text-align:center;color:#999">No matching inventory found.</td></tr>`;

  const body1 = document.getElementById('inventoryBody');
  body1.innerHTML = rows.map(r => rowHtml(r, false)).join('') || empty;

  const body2 = document.getElementById('inventoryBody2');
  body2.innerHTML = rows.map(r => rowHtml(r, true)).join('') || empty;
}

function rowHtml(r, withCategory) {
  const s = statusFor(r.quantity, r.min_stock);
  return `<tr>
    <td><div class="product-cell"><span class="product-icon">${r.sku.slice(0, 2)}</span><div><b>${r.name}</b><small>${r.category || ''}</small></div></div></td>
    <td><span class="sku">${r.sku}</span></td>
    ${withCategory ? `<td>${r.category || ''}</td>` : ''}
    <td><span class="location">${r.warehouse_name}</span></td>
    <td><span class="qty">${r.quantity} ${r.unit || ''}</span></td>
    <td><span class="status ${s}">${statusLabel(s)}</span></td>
  </tr>`;
}

function renderDashboardKPIs(summary) {
  document.getElementById('totalUnits').textContent = summary.totalUnits ?? 0;
  document.getElementById('lowCount').textContent = String(summary.lowCount ?? 0).padStart(2, '0');
  document.getElementById('outCount').textContent = String(summary.outCount ?? 0).padStart(2, '0');
  document.getElementById('pendingCount').textContent = String(summary.pendingDeliveries ?? 0).padStart(2, '0');
  document.getElementById('deliveryBadge').textContent = String(summary.pendingDeliveries ?? 0).padStart(2, '0');
}

function renderAlerts() {
  const problems = products.filter(p => statusFor(p.current_stock, p.min_stock) !== 'in');
  const container = document.getElementById('alerts');
  document.getElementById('exceptionCount').textContent = String(problems.length).padStart(2, '0');
  if (problems.length === 0) {
    container.innerHTML = `<p style="color:#8b908d;font-size:9px;padding:10px 0">No exceptions right now.</p>`;
    return;
  }
  container.innerHTML = problems.map(p => {
    const s = statusFor(p.current_stock, p.min_stock);
    return `<div class="alert-item">
      <div class="alert-mark">!</div>
      <div><b>${p.name}</b><small>${p.sku}</small><strong>${p.current_stock} ${p.unit || ''} on hand (min ${p.min_stock})</strong></div>
    </div>`;
  }).join('');
}

function renderWarehouseUtilization() {
  const container = document.getElementById('warehouseUtilization');
  container.innerHTML = warehouses.map((w, i) => {
    const pct = w.capacity ? Math.min(100, Math.round((w.stored_units / w.capacity) * 100)) : 0;
    const fillClass = i % 2 === 1 ? 'green-fill' : '';
    return `<div class="warehouse-row${i > 0 ? ' second' : ''}">
        <div class="warehouse-name"><span class="warehouse-icon">⌂</span><div><b>${w.name}</b><small>${w.address || 'No address set'}</small></div></div>
        <strong>${pct}%</strong>
      </div>
      <div class="capacity"><i class="${fillClass}" style="width:${pct}%"></i></div>
      <div class="warehouse-meta"><span>${w.stored_units} units stored</span><span>${100 - pct}% available</span></div>`;
  }).join('') || '<p style="color:#8b908d;font-size:9px">No warehouses yet.</p>';
}

function renderDashboardTimeline() {
  const container = document.getElementById('dashboardTimeline');
  const recent = ledgerRows.slice(0, 5);
  container.innerHTML = recent.map(l => {
    const dotClass = l.reason === 'receipt' ? 'green' : l.reason === 'delivery' ? 'orange' : '';
    const sign = l.change_qty > 0 ? '+' : '';
    return `<div><span class="tl-dot ${dotClass}"></span><div><b>${l.product_name}</b> ${l.reason} <strong>${sign}${l.change_qty}</strong><small>${l.warehouse_name} · ${timeAgo(l.created_at)}</small></div></div>`;
  }).join('') || '<p style="color:#8b908d;font-size:9px">No activity yet.</p>';
}

// ===================== WAREHOUSES =====================
function toggleNewWarehouseForm() {
  const el = document.getElementById('newWarehouseForm');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
async function createWarehouse() {
  const name = document.getElementById('newWarehouseName').value.trim();
  const address = document.getElementById('newWarehouseAddress').value.trim();
  const capacity = Number(document.getElementById('newWarehouseCapacity').value || 5000);
  if (!name) return showMessage('newWarehouseMessage', 'Name is required.', true);
  try {
    await api('/warehouses', { method: 'POST', body: JSON.stringify({ name, address, capacity }) });
    showMessage('newWarehouseMessage', `✓ Warehouse "${name}" created.`);
    document.getElementById('newWarehouseName').value = '';
    document.getElementById('newWarehouseAddress').value = '';
    await loadAll();
  } catch (err) {
    showMessage('newWarehouseMessage', err.message, true);
  }
}
function renderWarehouseCards() {
  const container = document.getElementById('warehouseCards');
  container.innerHTML = warehouses.map(w => {
    const pct = w.capacity ? Math.min(100, Math.round((w.stored_units / w.capacity) * 100)) : 0;
    return `<div class="warehouse-big">
      <span class="warehouse-icon large">⌂</span>
      <div class="warehouse-top"><div><small>${w.address || 'No address set'}</small><h2>${w.name}</h2></div><b>${pct}%</b></div>
      <div class="capacity tall"><i style="width:${pct}%"></i></div>
      <div class="warehouse-meta"><span>${w.stored_units} units</span><span>${100 - pct}% free</span></div>
    </div>`;
  }).join('') || '<p style="color:#8b908d;font-size:9px">No warehouses yet — add one above.</p>';
}

// ===================== PRODUCTS =====================
function toggleNewProductForm() {
  const el = document.getElementById('newProductForm');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
async function createProduct() {
  const name = document.getElementById('newProductName').value.trim();
  const sku = document.getElementById('newProductSku').value.trim();
  const category = document.getElementById('newProductCategory').value.trim();
  const unit = document.getElementById('newProductUnit').value.trim() || 'units';
  const min_stock = Number(document.getElementById('newProductMin').value || 10);
  if (!name || !sku) return showMessage('newProductMessage', 'Name and SKU are required.', true);
  try {
    await api('/products', { method: 'POST', body: JSON.stringify({ name, sku, category, unit, min_stock }) });
    showMessage('newProductMessage', `✓ Product "${name}" created.`);
    document.getElementById('newProductName').value = '';
    document.getElementById('newProductSku').value = '';
    document.getElementById('newProductCategory').value = '';
    await loadAll();
  } catch (err) {
    showMessage('newProductMessage', err.message, true);
  }
}

// ===================== RECEIVING =====================
async function createAndValidateReceipt() {
  const supplier_name = document.getElementById('receiptSupplier').value.trim();
  const warehouse_id = Number(document.getElementById('receiptWarehouse').value);
  const product_id = Number(document.getElementById('receiptProduct').value);
  const quantity = Number(document.getElementById('receiptQty').value);
  if (!supplier_name) return showMessage('receiptMessage', 'Supplier name is required.', true);
  if (!quantity || quantity < 1) return showMessage('receiptMessage', 'Enter a valid quantity.', true);
  try {
    const created = await api('/receipts', { method: 'POST', body: JSON.stringify({ supplier_name, warehouse_id, items: [{ product_id, quantity }] }) });
    await api(`/receipts/${created.receiptId}/validate`, { method: 'PUT' });
    const p = productById(product_id);
    showMessage('receiptMessage', `✓ Received ${quantity} ${p ? p.unit : ''} of ${p ? p.name : 'product'}. Stock updated.`);
    document.getElementById('receiptSupplier').value = '';
    await loadAll();
  } catch (err) {
    showMessage('receiptMessage', err.message, true);
  }
}
function renderReceiptQueue() {
  const container = document.getElementById('receiptQueue');
  const recent = receipts.slice(0, 8);
  container.innerHTML = recent.map(r => `<div class="queue-item">
      <span class="order-state ${r.status === 'Done' ? 'green-line' : 'yellow-line'}"></span>
      <div><b>RC-${String(r.id).padStart(4, '0')}</b><small>${r.supplier_name}</small></div>
      <strong>${r.status.toUpperCase()}</strong>
    </div>`).join('') || '<p style="color:#8b908d;font-size:9px">No receipts yet.</p>';
}

// ===================== DELIVERIES =====================
function updateDeliveryPreview() {
  const warehouseId = document.getElementById('deliveryWarehouse').value;
  const productId = document.getElementById('deliveryProduct').value;
  const qty = Math.max(0, Number(document.getElementById('deliveryQty').value || 0));
  const available = warehouseId && productId ? stockFor(productId, warehouseId) : 0;
  document.getElementById('deliveryAvailable').textContent = available;
  document.getElementById('deliveryOutbound').textContent = qty;
  document.getElementById('deliveryRemaining').textContent = Math.max(0, available - qty);
}
function setDeliveryStep(step) {
  ['deliveryStep1', 'deliveryStep2', 'deliveryStep3'].forEach((id, i) => {
    document.getElementById(id).classList.toggle('active', i < step);
  });
}
async function createDeliveryDraft() {
  const customer_name = document.getElementById('deliveryCustomer').value.trim();
  const warehouse_id = Number(document.getElementById('deliveryWarehouse').value);
  const product_id = Number(document.getElementById('deliveryProduct').value);
  const quantity = Number(document.getElementById('deliveryQty').value);
  if (!customer_name) return showMessage('deliveryMessage', 'Customer name is required.', true);
  if (!quantity || quantity < 1) return showMessage('deliveryMessage', 'Enter a valid quantity.', true);
  try {
    const created = await api('/deliveries', { method: 'POST', body: JSON.stringify({ customer_name, warehouse_id, items: [{ product_id, quantity }] }) });
    activeDeliveryId = created.deliveryId;
    setDeliveryStep(2);
    showMessage('deliveryMessage', `✓ Draft DO-${String(activeDeliveryId).padStart(4, '0')} created. Mark as packed next.`);
    await loadAll();
  } catch (err) {
    showMessage('deliveryMessage', err.message, true);
  }
}
async function packActiveDelivery() {
  if (!activeDeliveryId) return showMessage('deliveryMessage', 'Create a draft delivery first.', true);
  try {
    await api(`/deliveries/${activeDeliveryId}/pack`, { method: 'PUT' });
    setDeliveryStep(3);
    showMessage('deliveryMessage', '✓ Order marked as packed. Ready for validation.');
    await loadAll();
  } catch (err) {
    showMessage('deliveryMessage', err.message, true);
  }
}
async function validateActiveDelivery() {
  if (!activeDeliveryId) return showMessage('deliveryMessage', 'Create and pack a draft delivery first.', true);
  try {
    await api(`/deliveries/${activeDeliveryId}/validate`, { method: 'PUT' });
    showMessage('deliveryMessage', `✓ DO-${String(activeDeliveryId).padStart(4, '0')} validated. Stock reduced and ledger updated.`);
    activeDeliveryId = null;
    setDeliveryStep(1);
    document.getElementById('deliveryCustomer').value = '';
    await loadAll();
  } catch (err) {
    showMessage('deliveryMessage', err.message, true);
  }
}
function renderDeliveryQueue() {
  const container = document.getElementById('deliveryQueue');
  const recent = deliveries.slice(0, 8);
  document.getElementById('deliveryQueueCount').textContent = String(deliveries.filter(d => d.status !== 'Done').length).padStart(2, '0');
  const lineClass = { Draft: '', Packed: 'yellow-line', Done: 'green-line' };
  container.innerHTML = recent.map(d => `<div class="queue-item">
      <span class="order-state ${lineClass[d.status] || ''}"></span>
      <div><b>DO-${String(d.id).padStart(4, '0')}</b><small>${d.customer_name}</small></div>
      <strong>${d.status.toUpperCase()}</strong>
    </div>`).join('') || '<p style="color:#8b908d;font-size:9px">No deliveries yet.</p>';
}

// ===================== TRANSFERS =====================
function updateTransferPreview() {
  const fromId = document.getElementById('transferFrom').value;
  const productId = document.getElementById('transferProduct').value;
  const available = fromId && productId ? stockFor(productId, fromId) : 0;
  document.getElementById('transferAvailable').textContent = available;
}
async function createAndValidateTransfer() {
  const from_warehouse_id = Number(document.getElementById('transferFrom').value);
  const to_warehouse_id = Number(document.getElementById('transferTo').value);
  const product_id = Number(document.getElementById('transferProduct').value);
  const quantity = Number(document.getElementById('transferQty').value);
  if (from_warehouse_id === to_warehouse_id) return showMessage('transferMessage', 'Source and destination must be different.', true);
  if (!quantity || quantity < 1) return showMessage('transferMessage', 'Enter a valid quantity.', true);
  try {
    const created = await api('/transfers', { method: 'POST', body: JSON.stringify({ from_warehouse_id, to_warehouse_id, items: [{ product_id, quantity }] }) });
    await api(`/transfers/${created.transferId}/validate`, { method: 'PUT' });
    showMessage('transferMessage', `✓ Transfer TR-${String(created.transferId).padStart(4, '0')} completed.`);
    await loadAll();
  } catch (err) {
    showMessage('transferMessage', err.message, true);
  }
}
function renderTransferQueue() {
  const container = document.getElementById('transferQueue');
  const recent = transfers.slice(0, 8);
  container.innerHTML = recent.map(t => {
    const from = warehouseById(t.from_warehouse_id);
    const to = warehouseById(t.to_warehouse_id);
    return `<div class="queue-item">
      <span class="order-state ${t.status === 'done' ? 'green-line' : 'yellow-line'}"></span>
      <div><b>TR-${String(t.id).padStart(4, '0')}</b><small>${from ? from.name : '?'} → ${to ? to.name : '?'}</small></div>
      <strong>${t.status.toUpperCase()}</strong>
    </div>`;
  }).join('') || '<p style="color:#8b908d;font-size:9px">No transfers yet.</p>';
}

// ===================== ADJUSTMENTS =====================
function updateAdjustment() {
  const productId = document.getElementById('adjustProduct').value;
  const warehouseId = document.getElementById('adjustWarehouse').value;
  const recorded = productId && warehouseId ? stockFor(productId, warehouseId) : 0;
  document.getElementById('recordedStock').value = recorded;
  const physical = document.getElementById('physicalCount');
  if (document.activeElement !== physical) physical.value = recorded;
  const diff = Number(physical.value || 0) - recorded;
  document.getElementById('difference').textContent = (diff > 0 ? '+' : '') + diff;
  const state = document.getElementById('differenceState');
  state.className = diff === 0 ? 'variance-neutral' : diff > 0 ? 'variance-positive' : 'variance-negative';
  state.textContent = diff === 0 ? 'NO CHANGE' : diff > 0 ? 'SURPLUS' : 'SHORTAGE';
}
async function applyAdjustment() {
  const product_id = Number(document.getElementById('adjustProduct').value);
  const warehouse_id = Number(document.getElementById('adjustWarehouse').value);
  const physical_qty = Number(document.getElementById('physicalCount').value);
  const reason = document.getElementById('adjustReason').value.trim();
  if (!Number.isFinite(physical_qty) || physical_qty < 0) return showMessage('adjustMessage', 'Enter a valid physical count.', true);
  try {
    const result = await api('/adjustments', { method: 'POST', body: JSON.stringify({ product_id, warehouse_id, physical_qty, reason }) });
    const diff = result.diff_qty;
    showMessage('adjustMessage', `✓ Adjustment applied: ${diff >= 0 ? '+' : ''}${diff}. Stock ledger updated.`);
    await loadAll();
  } catch (err) {
    showMessage('adjustMessage', err.message, true);
  }
}
function renderAdjustmentLog() {
  const container = document.getElementById('adjustmentLog');
  const recent = adjustmentsLog.slice(0, 8);
  container.innerHTML = recent.map(a => `<div class="audit-row">
      <b>ADJ-${String(a.id).padStart(3, '0')}</b>
      <span>${a.product_name}</span>
      <strong class="${a.diff_qty >= 0 ? 'positive' : 'negative'}">${a.diff_qty >= 0 ? '+' : ''}${a.diff_qty}</strong>
      <small>${a.reason || 'No reason given'} · ${timeAgo(a.created_at)}</small>
    </div>`).join('') || '<p style="color:#8b908d;font-size:9px">No adjustments logged yet.</p>';
}

// ===================== LEDGER =====================
function renderLedger() {
  const container = document.getElementById('ledgerBody');
  const actionLabel = { receipt: 'RECEIPT', delivery: 'DELIVERY', transfer_in: 'TRANSFER IN', transfer_out: 'TRANSFER OUT', adjustment: 'ADJUSTMENT' };
  const actionClass = { receipt: 'inbound', delivery: 'outbound', transfer_in: 'transfer', transfer_out: 'transfer', adjustment: 'adjust' };
  container.innerHTML = ledgerRows.map(l => `<div class="ledger-row">
      <span>${new Date(l.created_at).toLocaleTimeString('en-IN', { hour12: false })}</span>
      <span>${(l.reference_type || '').toUpperCase()}-${String(l.reference_id || l.id).padStart(4, '0')}</span>
      <b>${l.product_name}</b>
      <span class="action ${actionClass[l.reason] || ''}">${actionLabel[l.reason] || l.reason.toUpperCase()}</span>
      <strong>${l.change_qty > 0 ? '+' : ''}${l.change_qty}</strong>
      <span>${l.warehouse_name}</span>
    </div>`).join('') || '<p style="color:#8b908d;font-size:9px;padding:15px 19px">No ledger entries yet.</p>';
}

// ===================== MISC =====================
function showMessage(id, msg, error = false) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.style.color = error ? '#d95748' : '#2e9d6d';
}

function tick() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-IN', { hour12: false });
}
setInterval(tick, 1000); tick();

checkExistingSession();
