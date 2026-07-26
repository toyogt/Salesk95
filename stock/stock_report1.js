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

// Pagination
let currentPage = 1;
let pageSize    = 50;
let totalPages  = 1;


// ============================================
// AUTH
// ============================================
async function checkAuth() {
    try {
        console.log('✅ checkAuth started');
        const { data: { user }, error } = await client.auth.getUser();
        if (error || !user) {
            window.location.href = '../index.html';
            return;
        }
        currentUser = user;
        document.getElementById('userDisplay').textContent = user.email;
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
    await checkAuth();
    await loadDistributors();   // needed for dropdowns
    await loadProducts();       // needed for Stock In / ERP dropdowns & type filter
    await loadTransactionFilters();
    setupEventListeners();

    // Show a prompt in the inventory table so users know to apply filters
    const tbody = document.getElementById('inventoryTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">'
            + '<i class="fas fa-filter me-2"></i>Apply filters above to load inventory data.'
            + '</td></tr>';
    }
});


// ============================================
// LOAD DISTRIBUTORS  (fresh every time)
// ============================================
async function loadDistributors() {
    try {
        console.log('✅ Loading distributors...');
        // Force fresh fetch — no caching. The timestamp param busts any
        // browser/CDN layer that might cache PostgREST responses.
        const { data, error } = await client
            .from('distributors')
            .select('distributor_id, distributor_name, GSTIN, status')
            .eq('status', 'Active')
            .order('distributor_name')
            .throwOnError();   // surface errors immediately

        distributors = data || [];
        console.log(`✅ Loaded ${distributors.length} active distributors (fresh from DB)`);

        const selects = [
            'filterDistributor', 'stockInDistributor', 'stockOutDistributor',
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
        const typeSelect = document.getElementById('filterType');
        if (typeSelect) {
            const types = [...new Set(products.map(p => p.product_type).filter(Boolean))];
            typeSelect.innerHTML = '<option value="">All Types</option>';
            types.forEach(type => {
                typeSelect.innerHTML += `<option value="${type}">${type}</option>`;
            });
        }

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


// ============================================
// APPLY FILTERS — fetches fresh data from DB
// This replaces the old loadInventory() that
// ran on page load. No caching.
// ============================================
async function applyFilters() {
    const distributor  = document.getElementById('filterDistributor')?.value || '';
    const productSearch = (document.getElementById('filterProduct')?.value || '').toLowerCase().trim();
    const productType  = document.getElementById('filterType')?.value || '';
    const stockStatus  = document.getElementById('filterStockStatus')?.value || '';

    // Collapse the filter panel after applying
    const filterCollapse = document.getElementById('filterCollapse');
    if (filterCollapse) {
        const bsCollapse = bootstrap.Collapse.getOrCreateInstance(filterCollapse);
        bsCollapse.hide();
    }

    const tbody = document.getElementById('inventoryTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center"><span class="spinner-border spinner-border-sm me-2"></span>Loading…</td></tr>';
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
                products!inner(product_name, product_type, erp_item_id, case_rate)
            `)
            .eq('distributors.status', 'Active');

        // Server-side filter for distributor
        if (distributor) {
            query = query.eq('distributor_id', distributor);
        }

        const { data, error } = await query;
        if (error) throw error;

        // Client-side filters for text search, type, stock status
        let result = data || [];

        if (productSearch) {
            result = result.filter(item => {
                const name = (item.products?.product_name || '').toLowerCase();
                const id   = (item.product_id || '').toLowerCase();
                return name.includes(productSearch) || id.includes(productSearch);
            });
        }

        if (productType) {
            result = result.filter(item => item.products?.product_type === productType);
        }

        if (stockStatus) {
            result = result.filter(item => {
                const status = getStockStatus(item.quantity_on_hand || 0, item.reorder_level || 5);
                if (stockStatus === 'low')      return status === 'LOW';
                if (stockStatus === 'critical') return status === 'CRITICAL';
                if (stockStatus === 'ok')       return status === 'OK';
                return true;
            });
        }

        inventoryData    = result;
        filteredInventory = result;
        currentPage      = 1;

        updateInventoryTable();
        updateStockCounts();

    } catch (error) {
        console.error('❌ Error loading inventory:', error);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Error loading inventory: ${error.message}</td></tr>`;
        }
    }
}


// ============================================
// RENDER INVENTORY TABLE
// Columns: Distributor | Product Code | Type | Stock | Reorder | Value | Status | Actions
// (Product Name removed)
// ============================================
function updateInventoryTable() {
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

function updateStockCounts() {
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
function exportToExcel() {
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
function exportToPDF() {
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
        if (type)          query = query.eq('transaction_type', type);
        if (fromDate)      query = query.gte('created_at', fromDate + 'T00:00:00');
        if (toDate)        query = query.lte('created_at', toDate + 'T23:59:59');

        const { data, error } = await query;
        if (error) throw error;

        const tbody = document.getElementById('transactionsTableBody');
        if (!tbody) return;

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="text-center">No transactions found</td></tr>';
            return;
        }

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
            .select('product_id, product_name')
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
        allProducts.forEach(product => {
            const currentStock = invMap[product.product_id] || 0;
            const row          = document.createElement('tr');
            row.setAttribute('data-product-id', product.product_id);
            row.innerHTML = `
                <td>${product.product_name}</td>
                <td><input type="number" class="form-control form-control-sm current-stock" value="${currentStock}" readonly disabled></td>
                <td><input type="number" class="form-control form-control-sm qty-add" min="0" value="0"></td>
                <td><button type="button" class="btn btn-sm btn-danger" onclick="removeStockInRow(this)"><i class="fas fa-times"></i></button></td>
            `;
            tbody.appendChild(row);
        });
        document.getElementById('stockInProductsContainer').style.display = 'block';
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
    const rows = document.querySelectorAll('#stockInProductsTable tr');
    if (rows.length === 0) {
        Swal.fire('Error', 'No products to process', 'error');
        return;
    }

    const updates = [];
    for (const row of rows) {
        const productId      = row.dataset.productId;
        const qtyInput       = row.querySelector('.qty-add');
        const qty            = parseInt(qtyInput?.value) || 0;
        if (qty <= 0) continue;
        const currentStockInput = row.querySelector('.current-stock');
        const currentStock   = parseInt(currentStockInput?.value) || 0;
        updates.push({ productId, qty, currentStock });
    }

    if (updates.length === 0) {
        Swal.fire('Info', 'No quantities entered', 'info');
        return;
    }

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
        Swal.fire('Success', `Added stock for ${success} products`, 'success');
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
            .select('product_id, quantity_on_hand, products(product_name)')
            .eq('distributor_id', distributorId)
            .gt('quantity_on_hand', 0);
        if (invError) throw invError;

        const tbody = document.getElementById('stockOutProductsTable');
        tbody.innerHTML = '';
        inventory.forEach(item => {
            const productName = item.products?.product_name || 'Unknown';
            const row         = document.createElement('tr');
            row.setAttribute('data-product-id', item.product_id);
            row.innerHTML = `
                <td>${productName}</td>
                <td><input type="number" class="form-control form-control-sm current-stock" value="${item.quantity_on_hand}" readonly disabled></td>
                <td><input type="number" class="form-control form-control-sm qty-remove" min="0" max="${item.quantity_on_hand}" value="0"></td>
                <td><button type="button" class="btn btn-sm btn-danger" onclick="removeStockOutRow(this)"><i class="fas fa-times"></i></button></td>
            `;
            tbody.appendChild(row);
        });
        document.getElementById('stockOutProductsContainer').style.display = 'block';
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

    const rows = document.querySelectorAll('#stockOutProductsTable tr');
    if (rows.length === 0) {
        Swal.fire('Error', 'No products to process', 'error');
        return;
    }

    const updates = [];
    for (const row of rows) {
        const productId      = row.dataset.productId;
        const qtyInput       = row.querySelector('.qty-remove');
        const qty            = parseInt(qtyInput?.value) || 0;
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
        Swal.fire('Success', `Removed stock from ${success} products`, 'success');
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
            .select('product_id, quantity_on_hand, products(product_name)')
            .eq('distributor_id', distributorId);
        if (invError) throw invError;

        const tbody = document.getElementById('reconcileProductsTable');
        tbody.innerHTML = '';
        inventory.forEach(item => {
            const productName = item.products?.product_name || 'Unknown';
            const row         = document.createElement('tr');
            row.setAttribute('data-product-id', item.product_id);
            row.innerHTML = `
                <td>${productName}</td>
                <td><input type="number" class="form-control form-control-sm system-stock" value="${item.quantity_on_hand}" readonly disabled></td>
                <td><input type="number" class="form-control form-control-sm physical-count" min="0" value="${item.quantity_on_hand}"></td>
                <td><button type="button" class="btn btn-sm btn-danger" onclick="removeReconcileRow(this)"><i class="fas fa-times"></i></button></td>
            `;
            tbody.appendChild(row);
        });
        document.getElementById('reconcileProductsContainer').style.display = 'block';
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

    const rows = document.querySelectorAll('#reconcileProductsTable tr');
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
        const physical    = parseInt(physicalInput?.value) || 0;
        if (physical === systemStock) continue;
        updates.push({ productId, systemStock, physical });
    }

    if (updates.length === 0) {
        Swal.fire('Info', 'No discrepancies to reconcile', 'info');
        return;
    }

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
        Swal.fire('Success', `Reconciled ${success} products`, 'success');
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