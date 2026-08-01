// stock_report1.js - Updated Version
// Changes:
//  1. No caching - every load/filter hits Supabase fresh
//  2. Live Inventory: removed GSTIN col, removed Product Name col,
//     added Value = stock * case_rate column (case_rate fetched from products table)
//  3. Inventory loads ONLY when filter is applied
//  4. PDF download added alongside Excel export
//  5. "Product Name" column removed entirely (table, Excel, PDF)
//  6. Total sum row (Stock & Value) at bottom of inventory table
//  7. PDF filter line shows Distributor Name only (no ID)
//  8. ₹ symbol removed from PDF and Excel exports

const SUPABASE_URL = 'https://jaasosewjbrwdklscxrn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphYXNvc2V3amJyd2RrbHNjeHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMjAxMDEsImV4cCI6MjA4NTY5NjEwMX0.OE-dD6EN5DR3fvnaAd9jW3cJ7_5sYXNkY5vOQFQ00w0';

// ── No-cache fetch wrapper ─────────────────────────────────────────────────
// Supabase JS uses the native fetch API. By default browsers may cache
// GET responses (especially with a service worker or aggressive CDN headers).
// Wrapping fetch so every Supabase request carries Cache-Control: no-store
// ensures the browser always hits the network and never returns a stale response.
const _noCacheFetch = (input, init = {}) => {
    const headers = new Headers(init.headers || {});
    headers.set('Cache-Control', 'no-store');
    headers.set('Pragma', 'no-cache');
    return fetch(input, { ...init, headers, cache: 'no-store' });
};

window.__supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { fetch: _noCacheFetch }
});
const client = window.__supabase;

console.log('✅ Base loaded');

// ============================================
// GLOBAL STATE — no caching, always fresh
// ============================================
let currentUser      = null;
let inventoryData    = [];   // holds last fetched inventory (from applyFilters)
let filteredInventory = [];  // same reference after filter, used by export/PDF
let distributors     = [];
let products         = [];
let supplyInventoryData = [];
let currentAccess    = null;
let allowedDistributorIds = [];
let restrictDistributors = false;

// Pagination
let currentPage = 1;
let pageSize    = 50;
let totalPages  = 1;
let transactionData = [];
let transactionPage = 1;
let transactionPageSize = 25;


// ============================================
// AUTH
// ============================================
async function checkAuth() {
    try {
        console.log('✅ checkAuth started');
        const { data: { user }, error } = await client.auth.getUser();
        if (error || !user) {
            window.location.href = '../index.html';
            return false;
        }
        currentUser = user;
        const { data: access, error: accessError } = await client
            .from('access_manager')
            .select('full_name, avatar_url, role_name, distributor_ids, tile_permissions')
            .ilike('user_email', user.email)
            .maybeSingle();
        if (accessError) throw accessError;
        const stockPermission = access?.tile_permissions?.stock_report?.access;
        if (!access || !stockPermission || stockPermission === 'none') {
            await Swal.fire('Access denied', 'You do not have access to Stock Report.', 'error');
            window.location.href = '../index.html';
            return false;
        }
        currentAccess = access;
        allowedDistributorIds = Array.isArray(access.distributor_ids) ? access.distributor_ids : [];
        const role = String(access.role_name || '').toLowerCase();
        restrictDistributors = role !== 'admin' && role !== 'nsm';
        if (restrictDistributors && allowedDistributorIds.length === 0) {
            await Swal.fire('No distributors', 'No distributors are assigned to your account.', 'warning');
            window.location.href = '../index.html';
            return false;
        }
        renderProfileAvatar(user);
        return true;
        console.log('✅ checkAuth completed');
    } catch (error) {
        console.error('❌ Auth error:', error);
    }
}

function logout() {
    window.__supabase.auth.signOut().then(() => {
        window.location.href = '../index.html';
    });
}


// ============================================
// INIT — no inventory load on startup
// ============================================
document.addEventListener('DOMContentLoaded', async function () {
    console.log('✅ DOM loaded');
    const collapseButton = document.getElementById('sidebarCollapseBtn');
    if (localStorage.getItem('k95InventorySidebar') === 'collapsed') document.body.classList.add('sidebar-collapsed');
    collapseButton?.addEventListener('click', () => {
        document.body.classList.toggle('sidebar-collapsed');
        const collapsed = document.body.classList.contains('sidebar-collapsed');
        localStorage.setItem('k95InventorySidebar', collapsed ? 'collapsed' : 'expanded');
        collapseButton.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
        collapseButton.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    });
    const authorised = await checkAuth();
    if (!authorised) return;
    await loadDistributors();   // needed for dropdowns
    await loadProducts();       // needed for Stock In / ERP dropdowns & type filter
    populateMultiFilter('filterStockStatus', [
        { value: 'low', label: 'Low Stock' },
        { value: 'critical', label: 'Critical' },
        { value: 'ok', label: 'OK' }
    ]);
    await loadTransactionFilters();
    setupEventListeners();
    await applyFilters({ collapse: false });
});


// ============================================
// LOAD DISTRIBUTORS  (fresh every time)
// ============================================
async function loadDistributors() {
    try {
        console.log('✅ Loading distributors...');
        // Force fresh fetch — no caching. The timestamp param busts any
        // browser/CDN layer that might cache PostgREST responses.
        let distributorQuery = client
            .from('distributors')
            .select('distributor_id, distributor_name, GSTIN, status')
            .eq('status', 'Active')
            .order('distributor_name');
        if (restrictDistributors) distributorQuery = distributorQuery.in('distributor_id', allowedDistributorIds);
        const { data, error } = await distributorQuery.throwOnError();

        distributors = data || [];
        console.log(`✅ Loaded ${distributors.length} active distributors (fresh from DB)`);

        const selects = [
            'stockInDistributor', 'stockOutDistributor',
            'reconcileDistributor', 'txnDistributor'
        ];

        selects.forEach(selectId => {
            const select = document.getElementById(selectId);
            if (!select) return;
            // keep "All / Select" option
            const firstOpt = select.options[0]?.text || 'All Distributors';
            select.innerHTML = `<option value="">${firstOpt}</option>`;
            distributors.forEach(d => {
                select.innerHTML += `<option value="${d.distributor_id}">${d.distributor_name} (${d.distributor_id})</option>`;
            });
        });

        populateMultiFilter('filterDistributor', distributors.map(d => ({ value: d.distributor_id, label: d.distributor_name })));

        const totalDistributorsEl = document.getElementById('totalDistributors');
        if (totalDistributorsEl) totalDistributorsEl.textContent = distributors.length;

    } catch (error) {
        console.error('❌ Error loading distributors:', error);
    }
}


// ============================================
// LOAD PRODUCTS  (fresh every time)
// includes case_rate now
// ============================================
async function loadProducts() {
    try {
        console.log('✅ Loading products...');
        const { data, error } = await client
            .from('products')
            .select('product_id, product_name, product_type, status, erp_item_id, hsn_code, pack_size, case_rate')
            .eq('status', 'Active')
            .order('product_name');

        if (error) throw error;

        products = data || [];
        console.log(`✅ Loaded ${products.length} products`);

        // Populate product dropdowns for Stock In / Out / Reconcile
        const selects = ['stockInProduct', 'stockOutProduct', 'reconcileProduct'];
        selects.forEach(selectId => {
            const select = document.getElementById(selectId);
            if (!select) return;
            select.innerHTML = '<option value="">Select Product</option>';
            products.forEach(p => {
                select.innerHTML += `<option value="${p.product_id}">${p.product_name}</option>`;
            });
        });

        // Populate product type filter
        const types = [...new Set(products.map(p => p.product_type).filter(Boolean))].sort();
        populateMultiFilter('filterType', types.map(type => ({ value: type, label: type })));

        const totalProductsEl = document.getElementById('totalProducts');
        if (totalProductsEl) totalProductsEl.textContent = products.length;

    } catch (error) {
        console.error('❌ Error loading products:', error);
    }
}


// ============================================
// HELPER: pieces per box from pack_size string
// ============================================
function getPiecesPerBox(packSize) {
    if (!packSize) return 1;
    const match = packSize.match(/^(\d+)/);
    return match ? parseInt(match[1]) : 1;
}

function renderProfileAvatar(user) {
    const display = document.getElementById('userDisplay');
    if (!display) return;
    const name = currentAccess?.full_name || user?.email || 'User';
    const initials = String(name).trim().split(/[\s@._-]+/).filter(Boolean).map(part => part[0]).join('').toUpperCase().slice(0, 2) || 'K9';
    const avatarUrl = currentAccess?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
    display.title = name;
    display.textContent = initials;
    if (!avatarUrl) return;
    try {
        const parsed = new URL(avatarUrl);
        if (parsed.protocol !== 'https:') return;
        const image = document.createElement('img');
        image.src = parsed.toString();
        image.alt = `${name} profile photo`;
        image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => { display.textContent = initials; }, { once: true });
        display.replaceChildren(image);
    } catch (error) {
        console.warn('Invalid profile photo URL ignored');
    }
}

function populateMultiFilter(id, options) {
    const root = document.getElementById(id);
    const menu = root?.querySelector('.multi-filter-menu');
    if (!menu) return;
    menu.innerHTML = options.map(option => `<label class="multi-filter-option"><input class="form-check-input" type="checkbox" value="${String(option.value).replace(/"/g, '&quot;')}"><span>${option.label}</span></label>`).join('');
    menu.querySelectorAll('input').forEach(input => input.addEventListener('change', () => updateMultiFilterLabel(root)));
    updateMultiFilterLabel(root);
}

function getMultiFilterValues(id) {
    return [...(document.getElementById(id)?.querySelectorAll('.multi-filter-menu input:checked') || [])].map(input => input.value);
}

function updateMultiFilterLabel(root) {
    const selected = [...root.querySelectorAll('.multi-filter-menu input:checked')];
    const button = root.querySelector('.dropdown-toggle');
    if (!button) return;
    const label = root.dataset.label || 'Options';
    button.textContent = selected.length ? (selected.length === 1 ? selected[0].nextElementSibling.textContent : `${selected.length} ${label}`) : `All ${label}`;
}

function calculateQuantity(expression) {
    const source = String(expression ?? '').trim();
    if (!source) return 0;
    if (!/^[0-9+\-*/().\s]+$/.test(source)) return NaN;
    let index = 0;
    const skip = () => { while (/\s/.test(source[index] || '')) index++; };
    const factor = () => { skip(); if (source[index] === '(') { index++; const value = expressionValue(); skip(); if (source[index++] !== ')') throw new Error(); return value; } const match = source.slice(index).match(/^\d+(?:\.\d+)?/); if (!match) throw new Error(); index += match[0].length; return Number(match[0]); };
    const term = () => { let value = factor(); for (;;) { skip(); const op = source[index]; if (op !== '*' && op !== '/') return value; index++; const right = factor(); value = op === '*' ? value * right : value / right; } };
    const expressionValue = () => { let value = term(); for (;;) { skip(); const op = source[index]; if (op !== '+' && op !== '-') return value; index++; const right = term(); value = op === '+' ? value + right : value - right; } };
    try { const value = expressionValue(); skip(); return index === source.length && Number.isFinite(value) && value >= 0 && Number.isInteger(value) ? value : NaN; } catch { return NaN; }
}

function readQuantityInput(input) {
    const value = calculateQuantity(input?.value);
    if (!Number.isFinite(value)) { input?.classList.add('is-invalid'); return NaN; }
    input?.classList.remove('is-invalid');
    if (input && input.value.trim()) input.value = String(value);
    return value;
}

function showStockProcessing(message) {
    Swal.fire({ title: 'Processing', text: message, allowOutsideClick: false, allowEscapeKey: false, didOpen: () => Swal.showLoading() });
}

function showStockDone(message) {
    return Swal.fire({ icon: 'success', title: 'Done', text: message, timer: 1600, showConfirmButton: false });
}


// ============================================
// APPLY FILTERS — fetches fresh data from DB
// This replaces the old loadInventory() that
// ran on page load. No caching.
// ============================================
async function applyFilters(options = {}) {
    const selectedDistributors = getMultiFilterValues('filterDistributor');
    const productSearch = (document.getElementById('filterProduct')?.value || '').toLowerCase().trim();
    const productTypes = getMultiFilterValues('filterType');
    const stockStatuses = getMultiFilterValues('filterStockStatus');

    // Collapse the filter panel after applying
    const filterCollapse = document.getElementById('filterCollapse');
    if (filterCollapse && options.collapse !== false) {
        const bsCollapse = bootstrap.Collapse.getOrCreateInstance(filterCollapse);
        bsCollapse.hide();
    }

    const tbody = document.getElementById('inventoryTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center"><span class="spinner-border spinner-border-sm me-2"></span>Loading…</td></tr>';
    }

    try {
        // Build query — always fresh, no cache
        let query = client
            .from('distributor_inventory')
            .select(`
                distributor_id,
                product_id,
                quantity_on_hand,
                reorder_level,
                updated_at,
                distributors!inner(distributor_name, GSTIN, status),
                products!inner(product_name, product_type, erp_item_id, case_rate, pack_size)
            `)
            .eq('distributors.status', 'Active');

        // Server-side filter for distributor
        if (selectedDistributors.length) {
            query = query.in('distributor_id', selectedDistributors);
        } else if (restrictDistributors) {
            query = query.in('distributor_id', allowedDistributorIds);
        }

        const { data, error } = await query;
        if (error) throw error;

        // Derive opening stock from the first recorded balance for every item.
        // The current schema has no opening_stock column, so transaction history is the source of truth.
        const openingByItem = new Map();
        let openingQuery = client
            .from('inventory_transactions')
            .select('distributor_id, product_id, previous_balance, created_at')
            .order('created_at', { ascending: true })
            .limit(10000);
        if (selectedDistributors.length) openingQuery = openingQuery.in('distributor_id', selectedDistributors);
        else if (restrictDistributors) openingQuery = openingQuery.in('distributor_id', allowedDistributorIds);
        const { data: openingRows, error: openingError } = await openingQuery;
        if (openingError) console.warn('Opening-stock history unavailable:', openingError.message);
        (openingRows || []).forEach(row => {
            const key = `${row.distributor_id}::${row.product_id}`;
            if (!openingByItem.has(key)) openingByItem.set(key, Number(row.previous_balance) || 0);
        });

        // Reserved stock = ordered boxes that are not delivered yet (Draft + Pending).
        // Orders retain an items JSON snapshot, so the KPI also works before order_items are joined.
        const reservedByItem = new Map();
        let reserveQuery = client
            .from('orders')
            .select('id, distributor_id, fulfilled_by_distributor_id, order_status, items')
            .in('order_status', ['Draft', 'Pending'])
            .limit(10000);
        if (selectedDistributors.length) reserveQuery = reserveQuery.in('distributor_id', selectedDistributors);
        else if (restrictDistributors) reserveQuery = reserveQuery.in('distributor_id', allowedDistributorIds);
        const { data: openOrders, error: reserveError } = await reserveQuery;
        if (reserveError) console.warn('Reserved-stock orders unavailable:', reserveError.message);
        const orderItemsByOrder = new Map();
        const openOrderIds = (openOrders || []).map(order => order.id).filter(Boolean);
        if (openOrderIds.length) {
            const { data: openOrderItems, error: orderItemsError } = await client
                .from('order_items')
                .select('order_id, product_id, qty')
                .in('order_id', openOrderIds)
                .limit(10000);
            if (orderItemsError) console.warn('Reserved-stock line items unavailable:', orderItemsError.message);
            (openOrderItems || []).forEach(item => {
                if (!orderItemsByOrder.has(item.order_id)) orderItemsByOrder.set(item.order_id, []);
                orderItemsByOrder.get(item.order_id).push(item);
            });
        }
        (openOrders || []).forEach(order => {
            const effectiveDistributor = order.fulfilled_by_distributor_id || order.distributor_id;
            if (selectedDistributors.length && !selectedDistributors.includes(effectiveDistributor)) return;
            const items = orderItemsByOrder.get(order.id) || (Array.isArray(order.items) ? order.items : []);
            items.forEach(item => {
                if (!item?.product_id) return;
                const key = `${effectiveDistributor}::${item.product_id}`;
                reservedByItem.set(key, (reservedByItem.get(key) || 0) + (Number(item.qty) || 0));
            });
        });

        // Client-side filters for text search, type, stock status
        let result = (data || []).map(item => ({
            ...item,
            opening_stock: openingByItem.get(`${item.distributor_id}::${item.product_id}`) ?? (Number(item.quantity_on_hand) || 0),
            reserved_stock: reservedByItem.get(`${item.distributor_id}::${item.product_id}`) || 0
        }));
        supplyInventoryData = [...result];

        if (productSearch) {
            result = result.filter(item => {
                const name = (item.products?.product_name || '').toLowerCase();
                const id   = (item.product_id || '').toLowerCase();
                return name.includes(productSearch) || id.includes(productSearch);
            });
        }

        if (productTypes.length) {
            result = result.filter(item => productTypes.includes(item.products?.product_type));
        }

        if (stockStatuses.length) {
            result = result.filter(item => {
                const status = getStockStatus(item.quantity_on_hand || 0, item.reorder_level || 5);
                return stockStatuses.some(stockStatus =>
                    (stockStatus === 'low' && status === 'LOW') ||
                    (stockStatus === 'critical' && status === 'CRITICAL') ||
                    (stockStatus === 'ok' && status === 'OK')
                );
            });
        }

        // Flavour-first natural sort, then distributor. This same order is used on screen and in exports.
        result.sort((a, b) => {
            const productCompare = (a.products?.product_name || '').localeCompare(
                b.products?.product_name || '', undefined, { numeric: true, sensitivity: 'base' }
            );
            return productCompare || (a.distributors?.distributor_name || '').localeCompare(b.distributors?.distributor_name || '');
        });

        inventoryData    = result;
        filteredInventory = result;
        currentPage      = 1;

        updateInventoryTable();
        updateStockCounts();

    } catch (error) {
        console.error('❌ Error loading inventory:', error);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center text-danger">Error loading inventory: ${error.message}</td></tr>`;
        }
    }
}


// ============================================
// RENDER INVENTORY TABLE
// Columns: Distributor | Product Code | Type | Stock | Reorder | Value | Status | Actions
// (Product Name removed)
// ============================================
function updateInventoryTableLegacy() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;

    totalPages = Math.ceil(filteredInventory.length / pageSize) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const start    = (currentPage - 1) * (pageSize === 'all' ? filteredInventory.length : pageSize);
    const end      = pageSize === 'all' ? filteredInventory.length : start + pageSize;
    const pageData = filteredInventory.slice(start, end);

    // Build table rows
    let html = '';
    let totalStock = 0;
    let totalValue = 0;

    if (pageData.length === 0) {
        html = '<tr><td colspan="8" class="text-center">No inventory data found</td></tr>';
    } else {
        pageData.forEach(item => {
            const stock        = item.quantity_on_hand || 0;
            const reorderLevel = item.reorder_level || 5;
            const caseRate     = item.products?.case_rate || 0;
            const value        = stock * caseRate;
            const status       = getStockStatus(stock, reorderLevel);
            const statusClass  = getStockStatusClass(status);
            const lastUpdated  = item.updated_at ? new Date(item.updated_at).toLocaleString() : 'N/A';
            const distributorName = (item.distributors?.distributor_name || '').replace(/'/g, "\\'");
            // productName is intentionally not displayed anymore

            totalStock += stock;
            totalValue += value;

            const statusBadge = status === 'LOW'
                ? '<span class="badge bg-warning text-dark">⚠️ Reorder</span>'
                : status === 'CRITICAL'
                ? '<span class="badge bg-danger">🔴 Critical</span>'
                : '<span class="badge bg-success">✅ OK</span>';

            html += `<tr class="${statusClass}">
                <td>${item.distributors?.distributor_name || item.distributor_id}</td>
                <td><code>${item.product_id}</code></td>
                <td>${item.products?.product_type || '-'}</td>
                <td class="text-end fw-bold">${stock}</td>
                <td class="text-end"><span class="badge bg-secondary">${reorderLevel}</span></td>
                <td class="text-end fw-bold">${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary action-btn" title="Set Reorder Level"
                        onclick="showReorderModal('${item.distributor_id}', '${item.product_id}', '${distributorName}', '${(item.products?.product_name || '').replace(/'/g, "\\'")}', ${stock}, ${reorderLevel})">⚙️</button>
                    <button class="btn btn-sm btn-outline-success action-btn" title="Quick Stock In"
                        onclick="quickStockIn('${item.distributor_id}', '${item.product_id}')">⬇️</button>
                </td>
            </tr>`;
        });
    }

    // Append total row as a <tfoot>
    html += `<tfoot class="table-dark">
        <tr style="font-weight: bold;">
            <td colspan="3" class="text-end">Totals:</td>
            <td class="text-end">${totalStock}</td>
            <td></td>
            <td class="text-end">${totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td></td>
            <td></td>
        </tr>
    </tfoot>`;

    tbody.innerHTML = html;

    // Pagination UI
    const pageInfo = document.getElementById('pageInfo');
    const prevBtn  = document.getElementById('prevPageBtn');
    const nextBtn  = document.getElementById('nextPageBtn');
    if (pageInfo) pageInfo.innerText = `Page ${currentPage} of ${totalPages} (${filteredInventory.length} records)`;
    if (prevBtn)  prevBtn.disabled = (currentPage <= 1);
    if (nextBtn)  nextBtn.disabled = (currentPage >= totalPages);
}


// ============================================
// STOCK STATUS HELPERS
// ============================================
function getStockStatus(stock, reorderLevel) {
    if (stock === 0) return 'CRITICAL';
    if (stock <= reorderLevel) return 'LOW';
    return 'OK';
}

function getStockStatusClass(status) {
    switch (status) {
        case 'CRITICAL': return 'table-danger';
        case 'LOW':      return 'table-warning';
        default:         return '';
    }
}

function updateStockCountsLegacy() {
    let lowStock = 0;
    let criticalStock = 0;

    inventoryData.forEach(item => {
        const stock        = item.quantity_on_hand || 0;
        const reorderLevel = item.reorder_level || 5;
        if (stock === 0) criticalStock++;
        else if (stock <= reorderLevel) lowStock++;
    });

    const lowStockEl      = document.getElementById('lowStockCount');
    const criticalStockEl = document.getElementById('criticalStockCount');
    if (lowStockEl)      lowStockEl.textContent = lowStock;
    if (criticalStockEl) criticalStockEl.textContent = criticalStock;
}


// ============================================
// EXPORT — EXCEL (Product Name removed, ₹ removed)
// ============================================
function exportToExcelLegacy() {
    if (filteredInventory.length === 0) {
        Swal.fire('Info', 'No data to export. Please apply filters first.', 'info');
        return;
    }
    try {
        const data = filteredInventory.map(item => {
            const stock    = item.quantity_on_hand || 0;
            const caseRate = item.products?.case_rate || 0;
            return {
                'Distributor':   item.distributors?.distributor_name || item.distributor_id,
                'Product Code':  item.product_id,
                'Type':          item.products?.product_type || '-',
                'Stock':         stock,
                'Reorder Level': item.reorder_level || 5,
                'Value':         (stock * caseRate).toFixed(2),          // no ₹, plain number
                'Status':        getStockStatus(stock, item.reorder_level || 5),
                'Last Updated':  item.updated_at ? new Date(item.updated_at).toLocaleString() : 'N/A'
            };
        });

        // Add totals row
        const totalStock = filteredInventory.reduce((sum, i) => sum + (i.quantity_on_hand || 0), 0);
        const totalValue = filteredInventory.reduce((sum, i) => sum + ((i.quantity_on_hand || 0) * (i.products?.case_rate || 0)), 0);
        data.push({
            'Distributor': 'TOTALS',
            'Product Code': '',
            'Type': '',
            'Stock': totalStock,
            'Reorder Level': '',
            'Value': totalValue.toFixed(2),
            'Status': '',
            'Last Updated': ''
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Inventory');

        // Filename: {DistributorID}-Stock-{DD-MM-YYYY_HH-MM}.xlsx
        const distSelectEl = document.getElementById('filterDistributor');
        const distIdXlsx   = (distSelectEl && distSelectEl.value) ? distSelectEl.value : 'ALL';
        const nowXlsx      = new Date();
        const datePartXlsx = nowXlsx.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
        const timePartXlsx = nowXlsx.toTimeString().slice(0, 5).replace(':', '-');
        const xlsxFilename = `${distIdXlsx}-Stock-${datePartXlsx}_${timePartXlsx}.xlsx`;

        XLSX.writeFile(wb, xlsxFilename);
        Swal.fire('Success', `Exported as ${xlsxFilename}`, 'success');
    } catch (error) {
        console.error('Export error:', error);
        Swal.fire('Error', 'Failed to export: ' + error.message, 'error');
    }
}


// ============================================
// EXPORT — PDF  (portrait, compact, fits on fewer pages)
// Filename: {DistributorID}-Stock-{DateTime}.pdf
// ============================================
function exportToPDFLegacy() {
    if (filteredInventory.length === 0) {
        if (typeof Swal !== 'undefined') {
            Swal.fire('Info', 'No data to export. Please apply filters first.', 'info');
        } else {
            alert('No data to export. Please apply filters first.');
        }
        return;
    }

    try {
        // jsPDF UMD bundle exposes window.jspdf (lowercase) in some versions
        // and window.jsPDF in others — handle both.
        const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF)
            || (window.jsPDF)
            || (window.jsPDF && window.jsPDF.jsPDF);
        if (!jsPDFCtor) {
            throw new Error('jsPDF library not loaded. Check the CDN script tag in the HTML.');
        }

        // ── Portrait A4, mm units (easier math for A4 = 210×297 mm) ──
        const doc = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();   // 210 mm
        const marginL = 8, marginR = 8;
        const tableW = pageW - marginL - marginR;          // 194 mm usable

        // ── Header ──
        const now = new Date();
        const nowStr = now.toLocaleString('en-IN');
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.text('K95 Foods — Inventory Report', marginL, 12);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.text(`Generated: ${nowStr}`, marginL, 18);

        // ── Filter summary line ──
        let distText = 'All';
        let distId   = 'ALL';
        const distSelect = document.getElementById('filterDistributor');
        if (distSelect && distSelect.value) {
            distId   = distSelect.value;
            const selectedText = distSelect.selectedOptions[0]?.text || '';
            distText = selectedText.replace(/\s*\([^)]+\)$/, '').trim() || 'All';
        }
        const prodSearch = document.getElementById('filterProduct')?.value || '';
        const typeName   = document.getElementById('filterType')?.selectedOptions[0]?.text || 'All';
        const statusName = document.getElementById('filterStockStatus')?.selectedOptions[0]?.text || 'All';
        doc.text(
            `Distributor: ${distText}  |  Product: ${prodSearch || 'All'}  |  Type: ${typeName}  |  Status: ${statusName}`,
            marginL, 24
        );

        // ── Totals summary ──
        const totalValue = filteredInventory.reduce((sum, item) =>
            sum + ((item.quantity_on_hand || 0) * (item.products?.case_rate || 0)), 0);
        const totalStock = filteredInventory.reduce((sum, item) => sum + (item.quantity_on_hand || 0), 0);
        doc.setFont('helvetica', 'bold');
        doc.text(
            `Records: ${filteredInventory.length}   |   Total Stock: ${totalStock}   |   Total Value: ${totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
            marginL, 30
        );

        // ── Column widths (must sum to tableW = 194 mm) ──
        // Distributor 42 | Prod Code 28 | Type 28 | Stock 18 | Reorder 18 | Value 30 | Status 30 = 194
        const colWidths = [42, 28, 28, 18, 18, 30, 30];

        const head = [['Distributor', 'Prod Code', 'Type', 'Stock', 'Reorder', 'Value', 'Status']];
        const body = filteredInventory.map(item => {
            const stock    = item.quantity_on_hand || 0;
            const caseRate = item.products?.case_rate || 0;
            const value    = (stock * caseRate).toFixed(2);
            const status   = getStockStatus(stock, item.reorder_level || 5);
            return [
                item.distributors?.distributor_name || item.distributor_id,
                item.product_id,
                item.products?.product_type || '-',
                stock,
                item.reorder_level || 5,
                value,
                status
            ];
        });

        body.push([
            { content: 'TOTALS', colSpan: 3, styles: { fontStyle: 'bold', halign: 'right' } },
            '', '',
            { content: String(totalStock), styles: { fontStyle: 'bold', halign: 'right' } },
            '',
            { content: totalValue.toFixed(2), styles: { fontStyle: 'bold', halign: 'right' } },
            ''
        ]);

        doc.autoTable({
            head,
            body,
            startY: 34,
            margin: { left: marginL, right: marginR },
            tableWidth: tableW,
            styles: {
                fontSize: 6.5,
                cellPadding: 1.8,
                overflow: 'linebreak',
                valign: 'middle'
            },
            headStyles: {
                fillColor: [33, 37, 41],
                textColor: 255,
                fontStyle: 'bold',
                fontSize: 6.5,
                cellPadding: 2
            },
            alternateRowStyles: { fillColor: [248, 249, 250] },
            columnStyles: {
                0: { cellWidth: colWidths[0] },
                1: { cellWidth: colWidths[1] },
                2: { cellWidth: colWidths[2] },
                3: { cellWidth: colWidths[3], halign: 'right' },
                4: { cellWidth: colWidths[4], halign: 'right' },
                5: { cellWidth: colWidths[5], halign: 'right' },
                6: { cellWidth: colWidths[6], halign: 'center' }
            },
            didParseCell(data) {
                if (data.section === 'body' && data.column.index === 6) {
                    const val = String(data.cell.raw || '');
                    if (val === 'CRITICAL') {
                        data.cell.styles.textColor = [220, 53, 69];
                        data.cell.styles.fontStyle = 'bold';
                    } else if (val === 'LOW') {
                        data.cell.styles.textColor = [133, 100, 4];
                        data.cell.styles.fontStyle = 'bold';
                    } else if (val === 'OK') {
                        data.cell.styles.textColor = [25, 135, 84];
                    }
                }
            },
            footStyles: { fillColor: [33, 37, 41], textColor: 255, fontStyle: 'bold', fontSize: 6.5 }
        });

        // ── Page numbers ──
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(6.5);
            doc.setFont('helvetica', 'normal');
            doc.text(
                `Page ${i} of ${pageCount}`,
                pageW - marginR,
                doc.internal.pageSize.getHeight() - 5,
                { align: 'right' }
            );
        }

        // ── Filename: {DistributorID}-Stock-{DD-MM-YYYY_HH-MM}.pdf ──
        const datePart = now.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
        const timePart = now.toTimeString().slice(0, 5).replace(':', '-');
        const filename = `${distId}-Stock-${datePart}_${timePart}.pdf`;

        doc.save(filename);
        if (typeof Swal !== 'undefined') {
            Swal.fire('Success', `Exported as ${filename}`, 'success');
        }

    } catch (error) {
        console.error('PDF export error:', error);
        if (typeof Swal !== 'undefined') {
            Swal.fire('Error', 'Failed to generate PDF: ' + error.message, 'error');
        } else {
            alert('Failed to generate PDF: ' + error.message);
        }
    }
}


// ============================================
// TRANSACTION LOG
// ============================================
async function loadTransactionFilters() {
    try {
        // txnDistributor is already populated by loadDistributors()
        // Just set default date range
        const today       = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(today.getDate() - 30);

        const txnTo   = document.getElementById('txnTo');
        const txnFrom = document.getElementById('txnFrom');
        if (txnTo)   txnTo.value   = today.toISOString().split('T')[0];
        if (txnFrom) txnFrom.value = thirtyDaysAgo.toISOString().split('T')[0];

    } catch (error) {
        console.error('Error loading transaction filters:', error);
    }
}

async function loadTransactions() {
    const distributorId = document.getElementById('txnDistributor')?.value;
    const type          = document.getElementById('txnType')?.value;
    const fromDate      = document.getElementById('txnFrom')?.value;
    const toDate        = document.getElementById('txnTo')?.value;

    try {
        // Fresh query — no caching
        let query = client
            .from('inventory_transactions')
            .select(`
                *,
                distributors(distributor_name),
                products(product_name)
            `)
            .order('created_at', { ascending: false })
            .limit(500);

        if (distributorId) query = query.eq('distributor_id', distributorId);
        else if (restrictDistributors) query = query.in('distributor_id', allowedDistributorIds);
        if (type)          query = query.eq('transaction_type', type);
        if (fromDate)      query = query.gte('created_at', fromDate + 'T00:00:00');
        if (toDate)        query = query.lte('created_at', toDate + 'T23:59:59');

        const { data, error } = await query;
        if (error) throw error;

        const tbody = document.getElementById('transactionsTableBody');
        if (!tbody) return;

        if (!data || data.length === 0) {
            transactionData = [];
            tbody.innerHTML = '<tr><td colspan="10" class="text-center">No transactions found</td></tr>';
            updateTransactionPagination();
            return;
        }

        transactionData = data;
        transactionPage = 1;
        renderTransactionsPage();
        return;

        let html = '';
        data.forEach(txn => {
            const date      = new Date(txn.created_at).toLocaleString();
            const typeClass = txn.transaction_type === 'IN'  ? 'text-success'
                            : txn.transaction_type === 'OUT' ? 'text-danger'
                            : 'text-warning';
            const typeIcon  = txn.transaction_type === 'IN'  ? '⬆️'
                            : txn.transaction_type === 'OUT' ? '⬇️'
                            : '🔄';

            html += `<tr>
                <td>${date}</td>
                <td>${txn.distributors?.distributor_name || txn.distributor_id}</td>
                <td>${txn.products?.product_name || txn.product_id}</td>
                <td class="${typeClass} fw-bold">${typeIcon} ${txn.transaction_type}</td>
                <td class="text-end">${Math.abs(txn.quantity)}</td>
                <td class="text-end">${txn.previous_balance}</td>
                <td class="text-end">${txn.new_balance}</td>
                <td>${txn.reference_type || '-'} ${txn.reference_id || ''}</td>
                <td>${txn.created_by_email || '-'}</td>
                <td>${txn.notes || '-'}</td>
            </tr>`;
        });

        tbody.innerHTML = html;

    } catch (error) {
        console.error('Error loading transactions:', error);
        const tbody = document.getElementById('transactionsTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="10" class="text-center text-danger">Error loading transactions</td></tr>';
        }
    }
}

function exportTransactionsToExcel() {
    const table = document.getElementById('transactionsTableBody');
    if (!table) return;

    const rows = table.querySelectorAll('tr');
    if (rows.length === 0 || (rows.length === 1 && rows[0].innerText.includes('No transactions'))) {
        Swal.fire('Info', 'No transactions to export', 'info');
        return;
    }

    const data    = [];
    const headers = ['Date', 'Distributor', 'Product', 'Type', 'Qty', 'Before', 'After', 'Reference', 'User', 'Notes'];
    data.push(headers);

    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length === 0) return;
        if (cells.length === 1 && cells[0].colSpan > 1) return;
        const rowData = [];
        cells.forEach(cell => {
            let text = cell.innerText.trim().replace(/[⬆️⬇️🔄]/g, '').trim();
            rowData.push(text);
        });
        data.push(rowData);
    });

    const wb     = XLSX.utils.book_new();
    const ws     = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
    XLSX.writeFile(wb, `K95_Transactions_${new Date().toISOString().split('T')[0]}.xlsx`);
    Swal.fire('Success', 'Transactions exported to Excel', 'success');
}


// ============================================
// STOCK IN
// ============================================
async function loadStockInProducts(distributorId) {
    if (!distributorId) {
        document.getElementById('stockInProductsContainer').style.display = 'none';
        return;
    }
    try {
        // Fresh fetch — no caching
        const { data: allProducts, error: prodError } = await client
            .from('products')
            .select('product_id, product_name, product_type')
            .eq('status', 'Active');
        if (prodError) throw prodError;

        const { data: inventory, error: invError } = await client
            .from('distributor_inventory')
            .select('product_id, quantity_on_hand')
            .eq('distributor_id', distributorId);
        if (invError) throw invError;

        const invMap = Object.fromEntries(inventory.map(i => [i.product_id, i.quantity_on_hand]));

        const tbody = document.getElementById('stockInProductsTable');
        tbody.innerHTML = '';
        allProducts.sort((a, b) => (a.product_type || '').localeCompare(b.product_type || '') || a.product_name.localeCompare(b.product_name, undefined, { numeric: true, sensitivity: 'base' }));
        document.getElementById('stockInProductsTable')?.closest('table')?.classList.add('smart-product-table');
        allProducts.forEach(product => {
            const currentStock = invMap[product.product_id] || 0;
            const row          = document.createElement('tr');
            row.setAttribute('data-product-id', product.product_id);
            row.innerHTML = `
                <td><span class="category-tag">${product.product_type || 'Other'}</span>${product.product_name}</td>
                <td><input type="number" class="form-control form-control-sm current-stock" value="${currentStock}" readonly disabled></td>
                <td><input type="text" inputmode="decimal" class="form-control form-control-sm qty-add calculative-qty" value="" placeholder="e.g. 12/2"></td>
            `;
            tbody.appendChild(row);
        });
        document.getElementById('stockInProductsContainer').style.display = 'block';
        enhanceProductTable('stockInProductsContainer', 'Search flavour or product…');
    } catch (error) {
        console.error('Error loading stock in products:', error);
        Swal.fire('Error', 'Failed to load products', 'error');
    }
}

function removeStockInRow(button) {
    button.closest('tr').remove();
}

async function processStockIn() {
    const distributorId = document.getElementById('stockInDistributor').value;
    if (!distributorId) {
        Swal.fire('Error', 'Please select a distributor', 'error');
        return;
    }
    const rows = document.querySelectorAll('#stockInProductsTable tr[data-product-id]');
    if (rows.length === 0) {
        Swal.fire('Error', 'No products to process', 'error');
        return;
    }

    const updates = [];
    for (const row of rows) {
        const productId      = row.dataset.productId;
        const qtyInput       = row.querySelector('.qty-add');
        const qty            = readQuantityInput(qtyInput);
        if (!Number.isFinite(qty)) return Swal.fire('Invalid quantity', 'Use a whole-number calculation such as 12/2 or 2*6.', 'error');
        if (qty <= 0) continue;
        const currentStockInput = row.querySelector('.current-stock');
        const currentStock   = parseInt(currentStockInput?.value) || 0;
        updates.push({ productId, qty, currentStock });
    }

    if (updates.length === 0) {
        Swal.fire('Info', 'No quantities entered', 'info');
        return;
    }

    showStockProcessing('Adding stock and recording transactions...');
    let success = 0;
    const errors = [];
    for (const u of updates) {
        try {
            const newStock = u.currentStock + u.qty;
            const { error } = await client
                .from('distributor_inventory')
                .upsert({
                    distributor_id:   distributorId,
                    product_id:       u.productId,
                    quantity_on_hand: newStock,
                    updated_at:       new Date().toISOString()
                }, { onConflict: 'distributor_id, product_id' });
            if (error) throw error;

            await logTransaction({
                distributor_id:   distributorId,
                product_id:       u.productId,
                transaction_type: 'IN',
                quantity:         u.qty,
                previous_balance: u.currentStock,
                new_balance:      newStock,
                reference_type:   'MANUAL',
                reference_id:     document.getElementById('stockInReference')?.value,
                notes:            document.getElementById('stockInNotes')?.value
            });
            success++;
        } catch (err) {
            errors.push(`${u.productId}: ${err.message}`);
        }
    }

    if (errors.length === 0) {
        showStockDone(`Added stock for ${success} products.`);
        resetStockIn();
    } else {
        Swal.fire('Partial Success', `Updated ${success} products. Errors: ${errors.join(', ')}`, 'warning');
    }
}

function resetStockIn() {
    document.getElementById('stockInForm').reset();
    document.getElementById('stockInProductsContainer').style.display = 'none';
    document.getElementById('stockInProductsTable').innerHTML = '';
}


// ============================================
// STOCK OUT
// ============================================
async function loadStockOutProducts(distributorId) {
    if (!distributorId) {
        document.getElementById('stockOutProductsContainer').style.display = 'none';
        return;
    }
    try {
        // Fresh fetch — no caching
        const { data: inventory, error: invError } = await client
            .from('distributor_inventory')
            .select('product_id, quantity_on_hand, products(product_name, product_type)')
            .eq('distributor_id', distributorId)
            .gt('quantity_on_hand', 0);
        if (invError) throw invError;

        const tbody = document.getElementById('stockOutProductsTable');
        tbody.innerHTML = '';
        inventory.sort((a, b) => (a.products?.product_type || '').localeCompare(b.products?.product_type || '') || (a.products?.product_name || '').localeCompare(b.products?.product_name || '', undefined, { numeric: true, sensitivity: 'base' }));
        document.getElementById('stockOutProductsTable')?.closest('table')?.classList.add('smart-product-table');
        inventory.forEach(item => {
            const productName = item.products?.product_name || 'Unknown';
            const row         = document.createElement('tr');
            row.setAttribute('data-product-id', item.product_id);
            row.innerHTML = `
                <td><span class="category-tag">${item.products?.product_type || 'Other'}</span>${productName}</td>
                <td><input type="number" class="form-control form-control-sm current-stock" value="${item.quantity_on_hand}" readonly disabled></td>
                <td><input type="text" inputmode="decimal" class="form-control form-control-sm qty-remove calculative-qty" value="" placeholder="e.g. 2*6"></td>
            `;
            tbody.appendChild(row);
        });
        document.getElementById('stockOutProductsContainer').style.display = 'block';
        enhanceProductTable('stockOutProductsContainer', 'Search flavour or available stock…');
    } catch (error) {
        console.error('Error loading stock out products:', error);
        Swal.fire('Error', 'Failed to load products', 'error');
    }
}

function removeStockOutRow(button) {
    button.closest('tr').remove();
}

async function processStockOut() {
    const distributorId = document.getElementById('stockOutDistributor').value;
    const reason        = document.getElementById('stockOutReason').value;
    if (!distributorId || !reason) {
        Swal.fire('Error', 'Please select distributor and reason', 'error');
        return;
    }

    const rows = document.querySelectorAll('#stockOutProductsTable tr[data-product-id]');
    if (rows.length === 0) {
        Swal.fire('Error', 'No products to process', 'error');
        return;
    }

    const updates = [];
    for (const row of rows) {
        const productId      = row.dataset.productId;
        const qtyInput       = row.querySelector('.qty-remove');
        const qty            = readQuantityInput(qtyInput);
        if (!Number.isFinite(qty)) return Swal.fire('Invalid quantity', 'Use a whole-number calculation such as 12/2 or 2*6.', 'error');
        if (qty <= 0) continue;
        const currentStockInput = row.querySelector('.current-stock');
        const currentStock   = parseInt(currentStockInput?.value) || 0;
        if (qty > currentStock) {
            Swal.fire('Error', `Qty ${qty} exceeds stock ${currentStock} for ${productId}`, 'error');
            return;
        }
        updates.push({ productId, qty, currentStock });
    }

    if (updates.length === 0) {
        Swal.fire('Info', 'No quantities entered', 'info');
        return;
    }

    showStockProcessing('Removing stock and recording transactions...');
    let success = 0;
    const errors = [];
    for (const u of updates) {
        try {
            const newStock = u.currentStock - u.qty;
            const { error } = await client
                .from('distributor_inventory')
                .update({ quantity_on_hand: newStock, updated_at: new Date().toISOString() })
                .eq('distributor_id', distributorId)
                .eq('product_id', u.productId);
            if (error) throw error;

            await logTransaction({
                distributor_id:   distributorId,
                product_id:       u.productId,
                transaction_type: 'OUT',
                quantity:         -u.qty,
                previous_balance: u.currentStock,
                new_balance:      newStock,
                reference_type:   reason,
                reference_id:     '',
                notes:            document.getElementById('stockOutNotes')?.value
            });
            success++;
        } catch (err) {
            errors.push(`${u.productId}: ${err.message}`);
        }
    }

    if (errors.length === 0) {
        showStockDone(`Removed stock from ${success} products.`);
        resetStockOut();
    } else {
        Swal.fire('Partial Success', `Updated ${success} products. Errors: ${errors.join(', ')}`, 'warning');
    }
}

function resetStockOut() {
    document.getElementById('stockOutForm').reset();
    document.getElementById('stockOutProductsContainer').style.display = 'none';
    document.getElementById('stockOutProductsTable').innerHTML = '';
}


// ============================================
// RECONCILE
// ============================================
async function loadReconcileProducts(distributorId) {
    if (!distributorId) {
        document.getElementById('reconcileProductsContainer').style.display = 'none';
        return;
    }
    try {
        // Fresh fetch — no caching
        const { data: inventory, error: invError } = await client
            .from('distributor_inventory')
            .select('product_id, quantity_on_hand, products(product_name, product_type)')
            .eq('distributor_id', distributorId);
        if (invError) throw invError;

        const tbody = document.getElementById('reconcileProductsTable');
        tbody.innerHTML = '';
        inventory.sort((a, b) => (a.products?.product_type || '').localeCompare(b.products?.product_type || '') || (a.products?.product_name || '').localeCompare(b.products?.product_name || '', undefined, { numeric: true, sensitivity: 'base' }));
        document.getElementById('reconcileProductsTable')?.closest('table')?.classList.add('smart-product-table');
        inventory.forEach(item => {
            const productName = item.products?.product_name || 'Unknown';
            const row         = document.createElement('tr');
            row.setAttribute('data-product-id', item.product_id);
            row.innerHTML = `
                <td><span class="category-tag">${item.products?.product_type || 'Other'}</span>${productName}</td>
                <td><input type="number" class="form-control form-control-sm system-stock" value="${item.quantity_on_hand}" readonly disabled></td>
                <td><input type="text" inputmode="decimal" class="form-control form-control-sm physical-count calculative-qty" value="" placeholder="Enter count or 12/2"></td>
            `;
            tbody.appendChild(row);
        });
        document.getElementById('reconcileProductsContainer').style.display = 'block';
        enhanceProductTable('reconcileProductsContainer', 'Search flavour to count…');
    } catch (error) {
        console.error('Error loading reconcile products:', error);
        Swal.fire('Error', 'Failed to load products', 'error');
    }
}

function removeReconcileRow(button) {
    button.closest('tr').remove();
}

async function processReconciliation() {
    const distributorId = document.getElementById('reconcileDistributor').value;
    const reason        = document.getElementById('reconcileReason').value;
    const notes         = document.getElementById('reconcileNotes').value;
    if (!distributorId) {
        Swal.fire('Error', 'Please select a distributor', 'error');
        return;
    }

    const rows = document.querySelectorAll('#reconcileProductsTable tr[data-product-id]');
    if (rows.length === 0) {
        Swal.fire('Error', 'No products to process', 'error');
        return;
    }

    const updates = [];
    for (const row of rows) {
        const productId   = row.dataset.productId;
        const systemInput = row.querySelector('.system-stock');
        const physicalInput = row.querySelector('.physical-count');
        const systemStock = parseInt(systemInput?.value) || 0;
        if (!physicalInput?.value.trim()) continue;
        const physical    = readQuantityInput(physicalInput);
        if (!Number.isFinite(physical)) return Swal.fire('Invalid count', 'Use a whole-number calculation such as 12/2 or 2*6.', 'error');
        if (physical === systemStock) continue;
        updates.push({ productId, systemStock, physical });
    }

    if (updates.length === 0) {
        Swal.fire('Info', 'No discrepancies to reconcile', 'info');
        return;
    }

    showStockProcessing('Reconciling physical counts...');
    let success = 0;
    const errors = [];
    for (const u of updates) {
        try {
            const { error } = await client
                .from('distributor_inventory')
                .update({ quantity_on_hand: u.physical, updated_at: new Date().toISOString() })
                .eq('distributor_id', distributorId)
                .eq('product_id', u.productId);
            if (error) throw error;

            await logTransaction({
                distributor_id:   distributorId,
                product_id:       u.productId,
                transaction_type: 'RECONCILE',
                quantity:         u.physical - u.systemStock,
                previous_balance: u.systemStock,
                new_balance:      u.physical,
                reference_type:   reason,
                reference_id:     '',
                notes:            notes || `Reconciled from ${u.systemStock} to ${u.physical}`
            });
            success++;
        } catch (err) {
            errors.push(`${u.productId}: ${err.message}`);
        }
    }

    if (errors.length === 0) {
        showStockDone(`Reconciled ${success} products.`);
        resetReconcile();
    } else {
        Swal.fire('Partial Success', `Reconciled ${success} products. Errors: ${errors.join(', ')}`, 'warning');
    }
}

function resetReconcile() {
    document.getElementById('reconcileDistributor').value = '';
    document.getElementById('reconcileReason').value     = 'PHYSICAL_COUNT';
    document.getElementById('reconcileNotes').value      = '';
    document.getElementById('reconcileProductsContainer').style.display = 'none';
    document.getElementById('reconcileProductsTable').innerHTML = '';
}


// ============================================
// TRANSACTION LOGGER
// ============================================
async function logTransaction(transaction) {
    try {
        const { error } = await client
            .from('inventory_transactions')
            .insert({
                distributor_id:   transaction.distributor_id,
                product_id:       transaction.product_id,
                transaction_type: transaction.transaction_type,
                quantity:         transaction.quantity,
                previous_balance: transaction.previous_balance,
                new_balance:      transaction.new_balance,
                reference_type:   transaction.reference_type,
                reference_id:     transaction.reference_id,
                notes:            transaction.notes,
                created_by_email: currentUser.email,
                created_at:       new Date().toISOString()
            });
        if (error) throw error;
    } catch (error) {
        console.error('Error logging transaction:', error);
    }
}


// ============================================
// REORDER MODAL
// ============================================
function showReorderModal(distributorId, productId, distributorName, productName, currentStock, currentLevel) {
    const modal = document.getElementById('reorderModal');
    if (!modal) { console.error('Reorder modal not found'); return; }

    document.getElementById('reorderDistributorId').value   = distributorId;
    document.getElementById('reorderProductId').value       = productId;
    document.getElementById('reorderDistributorName').value = distributorName;
    document.getElementById('reorderProductName').value     = productName;
    document.getElementById('reorderCurrentStock').value    = currentStock;
    document.getElementById('reorderLevel').value           = currentLevel;

    new bootstrap.Modal(modal).show();
}

async function saveReorderLevel() {
    const distributorId = document.getElementById('reorderDistributorId')?.value;
    const productId     = document.getElementById('reorderProductId')?.value;
    const newLevel      = parseInt(document.getElementById('reorderLevel')?.value);

    if (!distributorId || !productId || isNaN(newLevel) || newLevel < 0) {
        Swal.fire('Error', 'Please enter a valid reorder level', 'error');
        return;
    }

    try {
        const { error } = await client
            .from('distributor_inventory')
            .update({ reorder_level: newLevel })
            .eq('distributor_id', distributorId)
            .eq('product_id', productId);
        if (error) throw error;

        Swal.fire('Success', 'Reorder level updated', 'success');
        const modalEl = document.getElementById('reorderModal');
        const modal   = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();

        // Refresh inventory if there's data shown
        if (filteredInventory.length > 0) await applyFilters();

    } catch (error) {
        console.error('Error updating reorder level:', error);
        Swal.fire('Error', 'Failed to update reorder level', 'error');
    }
}


// ============================================
// QUICK STOCK IN (from Live Inventory row)
// ============================================
function quickStockIn(distributorId, productId) {
    const stockInTab = document.getElementById('stock-in-tab');
    if (stockInTab) new bootstrap.Tab(stockInTab).show();
    document.getElementById('stockInDistributor').value = distributorId;
    loadStockInProducts(distributorId);
}


// ============================================
// ERP NEXT SYNC
// ============================================
async function parseInvoice() {
    const jsonText = document.getElementById('invoiceJson')?.value;
    if (!jsonText) {
        Swal.fire('Error', 'Please paste invoice JSON', 'error');
        return;
    }

    try {
        const invoice = JSON.parse(jsonText);
        const gstin   = invoice?.billing_address_gstin || invoice?.customer_gstin;
        if (!gstin) {
            Swal.fire('Error', 'No GSTIN found in invoice', 'error');
            return;
        }

        // Fresh distributor check
        const distributor = distributors.find(d => d.GSTIN === gstin);
        if (!distributor) {
            Swal.fire('Warning', `No distributor found with GSTIN: ${gstin}`, 'warning');
        }

        document.getElementById('matchedDistributor').textContent = distributor
            ? `${distributor.distributor_name} (${distributor.distributor_id})` : 'Not Found';
        document.getElementById('invoiceDate').textContent   = invoice.posting_date || 'N/A';
        document.getElementById('invoiceNumber').textContent = invoice.name || 'N/A';

        const items   = invoice.items || [];
        let itemsHtml = '';

        itemsHtml += `<thead><tr>
            <th>Product</th><th>ERP Item Code</th>
            <th>Qty (pieces)</th><th>Boxes</th>
            <th>Match Status</th><th>Action</th>
        </tr></thead><tbody>`;

        items.forEach(item => {
            const itemCode   = item.item_code;
            const itemName   = item.item_name;
            const qtyPieces  = item.qty || 0;
            const product    = products.find(p => p.erp_item_id && p.erp_item_id.trim() === itemCode.trim());
            const matched    = !!product;
            const piecesPerBox  = matched ? getPiecesPerBox(product.pack_size) : null;
            const initialBoxes  = matched && piecesPerBox ? (qtyPieces / piecesPerBox).toFixed(2) : '-';

            itemsHtml += `
                <tr class="${matched ? 'table-success' : 'table-warning'}" data-itemcode="${itemCode}" ${matched ? `data-pieces-per-box="${piecesPerBox}"` : ''}>
                    <td>${itemName}</td>
                    <td>${itemCode}</td>
                    <td>
                        <input type="number" class="form-control form-control-sm erp-qty"
                               value="${qtyPieces}" min="0" step="1" style="width:100px;"
                               ${matched ? '' : 'disabled'}
                               oninput="syncPiecesToBoxes(this, true)">
                    </td>
                    <td>${matched
                        ? `<input type="number" class="form-control form-control-sm erp-boxes"
                                  value="${initialBoxes}" min="0" step="any" style="width:100px;"
                                  oninput="syncPiecesToBoxes(this, false)">`
                        : '<span class="text-muted">-</span>'}
                    </td>
                    <td>${matched
                        ? `<span class="badge bg-success">Matched → ${product.product_name}</span>`
                        : '<span class="badge bg-danger">No Match</span>'}
                    </td>
                    <td>
                        ${!matched ? `<button class="btn btn-sm btn-warning" onclick="manualMapProduct('${itemCode}', '${itemName.replace(/'/g, "\\'")}')">Map</button>` : ''}
                        <button class="btn btn-sm btn-danger" onclick="removeERPItem(this)"><i class="fas fa-times"></i></button>
                    </td>
                </tr>`;
        });

        itemsHtml += '</tbody>';
        document.getElementById('erpItemsTable').innerHTML = itemsHtml;
        document.getElementById('erpResults').style.display = 'block';

        window.lastParsedInvoice = { invoice, distributor, items, gstin };

    } catch (error) {
        console.error('Parse error:', error);
        Swal.fire('Error', 'Invalid JSON: ' + error.message, 'error');
    }
}

function syncPiecesToBoxes(input, isPieces) {
    const row          = input.closest('tr');
    if (!row) return;
    const piecesPerBox = parseFloat(row.dataset.piecesPerBox);
    if (!piecesPerBox || isNaN(piecesPerBox)) return;

    const piecesInput  = row.querySelector('.erp-qty');
    const boxesInput   = row.querySelector('.erp-boxes');
    if (!piecesInput || !boxesInput) return;

    if (isPieces) {
        const pieces  = parseFloat(piecesInput.value) || 0;
        boxesInput.value = (pieces / piecesPerBox).toFixed(2);
    } else {
        const boxes   = parseFloat(boxesInput.value) || 0;
        piecesInput.value = Math.round(boxes * piecesPerBox);
    }
}

function removeERPItem(button) {
    const row = button.closest('tr');
    if (row) row.remove();
}

async function updateInventoryFromERP() {
    if (!window.lastParsedInvoice) {
        Swal.fire('Error', 'No invoice parsed', 'error');
        return;
    }
    const distributor = window.lastParsedInvoice.distributor;
    if (!distributor) {
        Swal.fire('Error', 'No distributor matched', 'error');
        return;
    }

    Swal.fire({
        title: 'Updating inventory…',
        html: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        let updated = 0, skipped = 0;
        const rows = document.querySelectorAll('#erpItemsTable tr');
        for (const row of rows) {
            const itemCode  = row.dataset.itemcode;
            const qtyInput  = row.querySelector('.erp-qty');
            if (!qtyInput) continue;
            const qtyPieces = parseInt(qtyInput.value) || 0;
            if (qtyPieces <= 0) continue;

            const product = products.find(p => p.erp_item_id && p.erp_item_id.trim() === itemCode.trim());
            if (!product) { skipped++; continue; }

            const piecesPerBox = getPiecesPerBox(product.pack_size);
            if (qtyPieces % piecesPerBox !== 0) {
                console.warn(`Qty ${qtyPieces} for ${product.product_name} not multiple of ${piecesPerBox}. Skipping.`);
                skipped++;
                continue;
            }
            const boxes = qtyPieces / piecesPerBox;

            // Fresh DB read — no cache
            const { data: current } = await client
                .from('distributor_inventory')
                .select('quantity_on_hand')
                .eq('distributor_id', distributor.distributor_id)
                .eq('product_id', product.product_id)
                .maybeSingle();

            const currentStock = current?.quantity_on_hand || 0;
            const newStock     = currentStock + boxes;

            await client
                .from('distributor_inventory')
                .upsert({
                    distributor_id:   distributor.distributor_id,
                    product_id:       product.product_id,
                    quantity_on_hand: newStock,
                    updated_at:       new Date().toISOString()
                }, { onConflict: 'distributor_id, product_id' });

            await logTransaction({
                distributor_id:   distributor.distributor_id,
                product_id:       product.product_id,
                transaction_type: 'IN',
                quantity:         boxes,
                previous_balance: currentStock,
                new_balance:      newStock,
                reference_type:   'ERP_INVOICE',
                reference_id:     window.lastParsedInvoice.invoice.name,
                notes:            `Auto-updated from ERP invoice (${qtyPieces} pieces = ${boxes} boxes)`
            });

            updated++;
        }

        Swal.close();
        Swal.fire('Success', `Updated ${updated} products, ${skipped} skipped`, 'success');

    } catch (error) {
        console.error('ERP update error:', error);
        Swal.close();
        Swal.fire('Error', 'Failed to update inventory: ' + error.message, 'error');
    }
}

function manualMapProduct(erpItemCode, erpItemName) {
    Swal.fire({
        title: 'Map Product',
        html: `
            <p>Map ERP Item: <strong>${erpItemCode}</strong> (${erpItemName})</p>
            <select id="mapProductSelect" class="swal2-select" style="width:100%;">
                <option value="">Select Product</option>
                ${products.map(p => `<option value="${p.product_id}">${p.product_name}</option>`).join('')}
            </select>`,
        showCancelButton: true,
        confirmButtonText: 'Map',
        preConfirm: () => {
            const productId = document.getElementById('mapProductSelect')?.value;
            if (!productId) { Swal.showValidationMessage('Please select a product'); return false; }
            return productId;
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            const productId = result.value;
            const { error } = await client
                .from('products')
                .update({ erp_item_id: erpItemCode.trim() })
                .eq('product_id', productId);
            if (error) {
                Swal.fire('Error', 'Failed to map product: ' + error.message, 'error');
            } else {
                Swal.fire('Success', 'Product mapped successfully', 'success');
                await loadProducts();   // refresh products array
                await parseInvoice();   // re-parse with updated mapping
            }
        }
    });
}


// ============================================
// RECONCILE DIFFERENCE HELPER (single-item modal, kept for compatibility)
// ============================================
function calculateDifference() {
    const systemStock  = parseInt(document.getElementById('systemStock')?.value) || 0;
    const physicalStock = parseInt(document.getElementById('physicalStock')?.value) || 0;
    const difference   = physicalStock - systemStock;
    const stockDiff    = document.getElementById('stockDifference');
    if (stockDiff) {
        stockDiff.value     = difference;
        stockDiff.className = difference !== 0 ? 'form-control text-danger fw-bold' : 'form-control';
    }
}


// ============================================
// EVENT LISTENERS
// ============================================
function setupEventListeners() {
    document.addEventListener('focusout', event => {
        if (event.target.matches('.calculative-qty') && event.target.value.trim()) readQuantityInput(event.target);
    });
    document.addEventListener('change', event => {
        if (event.target.matches('.calculative-qty') && event.target.value.trim()) readQuantityInput(event.target);
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Enter' && event.target.matches('.calculative-qty')) {
            event.preventDefault();
            readQuantityInput(event.target);
            event.target.select();
        }
    });
    document.getElementById('supply-tab')?.addEventListener('shown.bs.tab', loadDistributorSupply);
    document.getElementById('txnPageSize')?.addEventListener('change', event => { transactionPageSize = Number(event.target.value) || 25; transactionPage = 1; renderTransactionsPage(); });
    document.getElementById('txnPrevPage')?.addEventListener('click', () => { if (transactionPage > 1) { transactionPage--; renderTransactionsPage(); } });
    document.getElementById('txnNextPage')?.addEventListener('click', () => { if (transactionPage * transactionPageSize < transactionData.length) { transactionPage++; renderTransactionsPage(); } });
    // Distributor change → load product rows
    document.getElementById('stockInDistributor')?.addEventListener('change', (e) => {
        loadStockInProducts(e.target.value);
    });
    document.getElementById('stockOutDistributor')?.addEventListener('change', (e) => {
        loadStockOutProducts(e.target.value);
    });
    document.getElementById('reconcileDistributor')?.addEventListener('change', (e) => {
        loadReconcileProducts(e.target.value);
    });

    // Pagination
    const pageSizeSelect = document.getElementById('pageSizeSelect');
    const prevBtn        = document.getElementById('prevPageBtn');
    const nextBtn        = document.getElementById('nextPageBtn');

    if (pageSizeSelect) {
        pageSizeSelect.addEventListener('change', (e) => {
            pageSize    = e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10);
            currentPage = 1;
            updateInventoryTable();
        });
    }
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) { currentPage--; updateInventoryTable(); }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (currentPage < totalPages) { currentPage++; updateInventoryTable(); }
        });
    }
}

function renderTransactionsPage() {
    const tbody = document.getElementById('transactionsTableBody');
    if (!tbody) return;
    const start = (transactionPage - 1) * transactionPageSize;
    tbody.innerHTML = transactionData.slice(start, start + transactionPageSize).map(txn => {
        const date = new Date(txn.created_at).toLocaleString('en-IN');
        const typeClass = txn.transaction_type === 'IN' ? 'text-success' : txn.transaction_type === 'OUT' ? 'text-danger' : 'text-warning';
        return `<tr><td>${date}</td><td>${txn.distributors?.distributor_name || txn.distributor_id}</td><td>${txn.products?.product_name || txn.product_id}</td><td class="${typeClass} fw-bold">${txn.transaction_type}</td><td class="text-end">${Math.abs(Number(txn.quantity ?? txn.quantity_change) || 0)}</td><td class="text-end">${txn.previous_balance}</td><td class="text-end">${txn.new_balance}</td><td>${txn.reference_type || '-'} ${txn.reference_id || ''}</td><td>${txn.created_by_email || '-'}</td><td>${txn.notes || txn.reference_note || '-'}</td></tr>`;
    }).join('');
    updateTransactionPagination();
}

function updateTransactionPagination() {
    const totalPages = Math.max(1, Math.ceil(transactionData.length / transactionPageSize));
    transactionPage = Math.min(transactionPage, totalPages);
    const info = document.getElementById('txnPageInfo');
    if (info) info.textContent = `Page ${transactionPage} of ${totalPages} (${transactionData.length} records)`;
    const prev = document.getElementById('txnPrevPage');
    const next = document.getElementById('txnNextPage');
    if (prev) prev.disabled = transactionPage <= 1;
    if (next) next.disabled = transactionPage >= totalPages;
}

async function loadDistributorSupply() {
    const tbody = document.getElementById('distributorSupplyBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4"><span class="spinner-border spinner-border-sm me-2"></span>Calculating distributor supply...</td></tr>';
    try {
        const grouped = new Map();
        supplyInventoryData.forEach(item => {
            const id = item.distributor_id;
            if (!grouped.has(id)) grouped.set(id, { id, name:item.distributors?.distributor_name || id, openingValue:0, currentValue:0, boxes:0, reserve:0, reorder:0 });
            const row = grouped.get(id);
            const rate = Number(item.products?.case_rate) || 0;
            const boxes = Number(item.quantity_on_hand) || 0;
            const reserve = Number(item.reserved_stock) || 0;
            row.openingValue += (Number(item.opening_stock) || 0) * rate;
            row.currentValue += boxes * rate;
            row.boxes += boxes;
            row.reserve += reserve;
            row.reorder += item.reorder_level == null ? 5 : Number(item.reorder_level);
        });
        const rows = [...grouped.values()].sort((a,b) => a.name.localeCompare(b.name));
        tbody.innerHTML = rows.length ? rows.map(row => {
            const plan = getSupplyPlan(row.boxes, row.reserve, row.reorder);
            return `<tr><td><strong>${row.name}</strong></td><td class="text-end">₹${formatMoney(row.currentValue)}</td><td class="text-end">${row.boxes.toLocaleString('en-IN')}</td><td class="text-end">${row.reserve.toLocaleString('en-IN')}</td><td><span class="supply-plan ${plan.className}">${plan.label}<small>${plan.projected} boxes left</small></span></td></tr>`;
        }).join('') : '<tr><td colspan="5" class="text-center text-muted py-4">No distributor inventory available.</td></tr>';
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">Unable to calculate supply: ${error.message}</td></tr>`;
    }
}

// ============================================
// INVENTORY 4.0 PRESENTATION
// Correct headers, KPIs, totals and exports share one data model.
// ============================================
function inventoryMetrics(rows = filteredInventory) {
    return rows.reduce((totals, item) => {
        const boxes = Number(item.quantity_on_hand) || 0;
        const reserve = Number(item.reserved_stock) || 0;
        const rate = Number(item.products?.case_rate) || 0;
        totals.boxes += boxes;
        totals.value += boxes * rate;
        totals.reserve += reserve;
        totals.opening += Number(item.opening_stock) || 0;
        return totals;
    }, { boxes: 0, value: 0, reserve: 0, opening: 0 });
}

function formatMoney(value) {
    return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getSupplyPlan(boxes, reserve, reorderLevel) {
    const current = Math.max(0, Number(boxes) || 0);
    const committed = Math.max(0, Number(reserve) || 0);
    const projected = Math.max(0, current - committed);
    const reserveRatio = current > 0 ? committed / current : (committed > 0 ? 1 : 0);
    if ((committed > 0 && reserveRatio >= 0.70) || projected <= reorderLevel) {
        return { label: 'Supply Now', className: 'supply-now', projected };
    }
    if (reserveRatio >= 0.50 || projected <= reorderLevel * 2) {
        return { label: 'Watch', className: 'supply-watch', projected };
    }
    return { label: 'Healthy', className: 'supply-healthy', projected };
}

function enhanceProductTable(containerId, placeholder) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (container.previousElementSibling?.classList.contains('smart-table-tools')) {
        const existingSearch = container.previousElementSibling.querySelector('.smart-product-search');
        if (existingSearch) { existingSearch.value = ''; existingSearch.dispatchEvent(new Event('input')); }
        return;
    }
    const tools = document.createElement('div');
    tools.className = 'smart-table-tools d-flex align-items-center gap-2 mb-2';
    tools.innerHTML = `<div class="input-group input-group-sm"><span class="input-group-text bg-white border-end-0"><i class="fas fa-search text-muted"></i></span><input class="form-control border-start-0 smart-product-search" type="search" placeholder="${placeholder}"></div><span class="badge rounded-pill text-bg-light smart-visible-count"></span>`;
    container.parentNode.insertBefore(tools, container);
    const input = tools.querySelector('input');
    const count = tools.querySelector('.smart-visible-count');
    const refresh = () => {
        let visible = 0;
        container.querySelectorAll('tbody tr').forEach(row => {
            const match = row.textContent.toLowerCase().includes(input.value.trim().toLowerCase());
            row.style.display = match ? '' : 'none';
            if (match) visible++;
        });
        count.textContent = `${visible} flavours`;
    };
    input.addEventListener('input', refresh);
    refresh();
}

function updateStockCounts() {
    const totals = inventoryMetrics();
    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setText('totalBoxes', totals.boxes.toLocaleString('en-IN'));
    setText('currentStockValue', `₹${formatMoney(totals.value)}`);
    setText('reserveStock', totals.reserve.toLocaleString('en-IN'));
    setText('openingStock', totals.opening.toLocaleString('en-IN'));
}

function updateInventoryTable() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;
    totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(filteredInventory.length / pageSize));
    currentPage = Math.min(Math.max(currentPage, 1), totalPages);
    const start = pageSize === 'all' ? 0 : (currentPage - 1) * pageSize;
    const pageData = pageSize === 'all' ? filteredInventory : filteredInventory.slice(start, start + pageSize);

    if (!pageData.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">No inventory data found</td></tr>';
    } else {
        tbody.innerHTML = pageData.map(item => {
            const boxes = Number(item.quantity_on_hand) || 0;
            const reorderLevel = item.reorder_level == null ? 5 : Number(item.reorder_level);
            const reserve = Number(item.reserved_stock) || 0;
            const rate = Number(item.products?.case_rate) || 0;
            const value = boxes * rate;
            const name = item.products?.product_name || item.product_id;
            const status = getStockStatus(boxes, reorderLevel);
            const distributorName = (item.distributors?.distributor_name || '').replace(/'/g, "\\'");
            const safeName = name.replace(/'/g, "\\'");
            const badge = status === 'CRITICAL' ? '<span class="badge bg-danger">Critical</span>'
                : status === 'LOW' ? '<span class="badge bg-warning text-dark">Reorder</span>'
                : '<span class="badge bg-success">In stock</span>';
            return `<tr class="${getStockStatusClass(status)}">
                <td>${item.distributors?.distributor_name || item.distributor_id}</td>
                <td class="product-cell"><strong>${name}</strong></td>
                <td><span class="flavour-pill">${item.products?.product_type || 'Uncategorised'}</span></td>
                <td class="text-end fw-bold">${boxes.toLocaleString('en-IN')}</td>
                <td class="text-end">${reserve.toLocaleString('en-IN')}</td>
                <td class="text-end">₹${formatMoney(rate)}</td>
                <td class="text-end fw-bold">₹${formatMoney(value)}</td>
                <td>${badge}</td>
                <td class="text-center text-nowrap">
                    <button class="btn btn-sm btn-outline-primary action-btn" title="Set reorder level" onclick="showReorderModal('${item.distributor_id}','${item.product_id}','${distributorName}','${safeName}',${boxes},${reorderLevel})"><i class="fas fa-sliders-h"></i></button>
                    <button class="btn btn-sm btn-outline-success action-btn" title="Quick stock in" onclick="quickStockIn('${item.distributor_id}','${item.product_id}')"><i class="fas fa-arrow-down"></i></button>
                </td></tr>`;
        }).join('');
    }

    const totals = inventoryMetrics();
    tbody.insertAdjacentHTML('beforeend', `<tr class="table-dark fw-bold"><td colspan="3" class="text-end">Filtered totals</td><td class="text-end">${totals.boxes.toLocaleString('en-IN')}</td><td class="text-end">${totals.reserve.toLocaleString('en-IN')}</td><td></td><td class="text-end">₹${formatMoney(totals.value)}</td><td colspan="2"></td></tr>`);
    const pageInfo = document.getElementById('pageInfo');
    if (pageInfo) pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${filteredInventory.length} records)`;
    const prev = document.getElementById('prevPageBtn');
    const next = document.getElementById('nextPageBtn');
    if (prev) prev.disabled = currentPage <= 1;
    if (next) next.disabled = currentPage >= totalPages;
}

function inventoryExportRows() {
    return filteredInventory.map(item => {
        const boxes = Number(item.quantity_on_hand) || 0;
        const reorderLevel = item.reorder_level == null ? 5 : Number(item.reorder_level);
        const reserve = Number(item.reserved_stock) || 0;
        const rate = Number(item.products?.case_rate) || 0;
        const supplyPlan = getSupplyPlan(boxes, reserve, reorderLevel);
        return {
            Distributor: item.distributors?.distributor_name || item.distributor_id,
            'Flavour / Product': item.products?.product_name || '',
            Category: item.products?.product_type || '',
            'Opening Stock': Number(item.opening_stock) || 0,
            'Current Boxes': boxes,
            'Reserve Stock': reserve,
            'Projected Stock': supplyPlan.projected,
            'Rate / Box': rate,
            'Current Stock Value': boxes * rate,
            Status: getStockStatus(boxes, reorderLevel),
            'Last Updated': item.updated_at ? new Date(item.updated_at).toLocaleString('en-IN') : ''
        };
    });
}

function exportToExcel() {
    if (!filteredInventory.length) return Swal.fire('Info', 'Apply filters before exporting.', 'info');
    try {
        const rows = inventoryExportRows();
        const totals = inventoryMetrics();
        rows.push({ Distributor: 'FILTERED TOTALS', 'Opening Stock': totals.opening, 'Current Boxes': totals.boxes, 'Reserve Stock': totals.reserve, 'Current Stock Value': totals.value });
        const sheet = XLSX.utils.json_to_sheet(rows);
        sheet['!cols'] = [28,42,20,14,14,14,15,14,20,12,22].map(wch => ({ wch }));
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, 'Live Inventory');
        XLSX.writeFile(workbook, `${getMultiFilterValues('filterDistributor').join('-') || 'ALL'}-Stock-${new Date().toISOString().slice(0,10)}.xlsx`);
    } catch (error) { Swal.fire('Error', `Excel export failed: ${error.message}`, 'error'); }
}

function exportToPDF() {
    if (!filteredInventory.length) return Swal.fire('Info', 'Apply filters before exporting.', 'info');
    try {
        const JsPDF = window.jspdf?.jsPDF || window.jsPDF;
        if (!JsPDF) throw new Error('PDF library is unavailable');
        const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const totals = inventoryMetrics();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.text('K95 FOODS | LIVE INVENTORY REPORT', 10, 12);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, 10, 18);
        doc.text(`Total Boxes: ${totals.boxes}  |  Reserve Stock: ${totals.reserve}  |  Opening Stock: ${totals.opening}  |  Current Stock Value: INR ${formatMoney(totals.value)}`, 10, 22);
        const body = inventoryExportRows().map(row => [row.Distributor,row['Flavour / Product'],row.Category,row['Opening Stock'],row['Current Boxes'],row['Reserve Stock'],row['Projected Stock'],formatMoney(row['Rate / Box']),formatMoney(row['Current Stock Value']),row.Status]);
        body.push([{ content:'FILTERED TOTALS', colSpan:3, styles:{ fontStyle:'bold', halign:'right' } }, totals.opening, totals.boxes, totals.reserve, Math.max(0, totals.boxes - totals.reserve), '', formatMoney(totals.value), '']);
        doc.autoTable({
            startY: 27,
            head: [['Distributor', 'Flavour / Product', 'Category', 'Opening Stock', 'Current Boxes', 'Reserve Stock', 'Projected Stock', 'Rate / Box', 'Stock Value', 'Status']],
            body,
            theme: 'grid',
            margin: { left: 10, right: 10 },
            styles: { fontSize: 6.4, cellPadding: 1.5, valign: 'middle' },
            headStyles: { fillColor: [32, 37, 42], textColor: 255, fontStyle: 'bold', halign: 'center' },
            columnStyles: {
                0: { cellWidth: 35 },
                1: { cellWidth: 45 },
                2: { cellWidth: 31 },
                3: { cellWidth: 19, halign: 'right' },
                4: { cellWidth: 19, halign: 'right' },
                5: { cellWidth: 19, halign: 'right' },
                6: { cellWidth: 19, halign: 'right' },
                7: { cellWidth: 18, halign: 'right' },
                8: { cellWidth: 24, halign: 'right' },
                9: { cellWidth: 18, halign: 'center' }
            }
        });
        doc.save(`${getMultiFilterValues('filterDistributor').join('-') || 'ALL'}-Stock-${new Date().toISOString().slice(0,10)}.pdf`);
    } catch (error) { Swal.fire('Error', `PDF export failed: ${error.message}`, 'error'); }
}
