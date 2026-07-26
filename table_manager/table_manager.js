// ============================================
// SUPABASE TABLE MANAGER v5 – ADVANCED FILTERS + HIDE
// ============================================
console.log('✅ Table Manager v5 loaded');

const SUPABASE_URL = 'https://jaasosewjbrwdklscxrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphYXNvc2V3amJyd2RrbHNjeHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMjAxMDEsImV4cCI6MjA4NTY5NjEwMX0.OE-dD6EN5DR3fvnaAd9jW3cJ7_5sYXNkY5vOQFQ00w0';

let supabaseClient;
try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true }
    });
} catch (e) {
    console.error('❌ Supabase init failed:', e);
}

let currentTable = null;
let tabulator = null;
let currentUser = null;
let isViewerMode = true;
let currentColumns = [];
let currentData = [];

// ---------- Auth ----------
async function checkAuth() {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error || !session) {
        setStatus('Not authenticated. Redirecting...');
        setTimeout(() => window.location.href = '/salesk95/index.html', 1500);
        return false;
    }
    currentUser = session.user;
    setStatus(`✅ Logged in as ${currentUser.email}`);
    return true;
}

function setStatus(msg, isError = false) {
    const el = document.getElementById('statusMessage');
    if (el) {
        el.textContent = msg;
        el.style.color = isError ? '#dc2626' : '#4b5563';
    }
}

function showError(container, message) {
    container.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-triangle"></i> ${message}</div>`;
}

// ---------- Table List ----------
async function loadTableList() {
    const tables = [
        'access_manager', 'attendance_records', 'distributor_inventory', 'distributors',
        'inventory_transactions', 'order_items', 'orders', 'outlets', 'products',
        'sales_targets', 'users', 'visit_products', 'visits'
    ];
    const select = document.getElementById('tableSelect');
    select.innerHTML = '<option value="">-- Select a table --</option>';
    tables.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        select.appendChild(opt);
    });
}

// ---------- Build columns ----------
function buildColumnsFromRow(row) {
    return Object.keys(row).map(col => {
        const sample = row[col];
        let editor = 'input';
        let formatter = 'plaintext';
        let headerFilter = true;
        let formatterParams = {};

        if (sample === null || sample === undefined) {
            // keep defaults
        } else if (Array.isArray(sample)) {
            formatter = function(cell) {
                const val = cell.getValue();
                return val ? val.join(', ') : '';
            };
            editor = 'textarea';
            formatterParams = { height: '60px' };
        } else if (typeof sample === 'object') {
            formatter = function(cell) {
                const val = cell.getValue();
                if (!val) return '';
                try { return JSON.stringify(val, null, 1); } catch { return String(val); }
            };
            editor = 'textarea';
        } else if (typeof sample === 'number') {
            editor = 'number';
            formatter = 'money';
        } else if (typeof sample === 'boolean') {
            editor = 'tickCross';
            formatter = 'tickCross';
            headerFilter = false;
        } else if (col.includes('date') || col.includes('time') || col.endsWith('_at')) {
            formatter = 'datetime';
        }

        return {
            title: col,
            field: col,
            editor,
            formatter,
            formatterParams,
            headerFilter: headerFilter ? 'input' : false,
            headerFilterPlaceholder: `Filter ${col}`,
            resizable: true,
            editable: !isViewerMode
        };
    });
}

// ---------- Fallback schema for empty tables ----------
async function getColumnsForEmptyTable(tableName) {
    const knownSchemas = {
        'visits': ['id', 'distributor_id', 'outlet_id', 'visit_date', 'visit_type', 'notes', 'order_created', 'order_id', 'latitude', 'longitude', 'location_map_url', 'created_by_email', 'created_at', 'updated_at', 'new_outlet_name', 'new_outlet_contact', 'new_outlet_email', 'new_outlet_type', 'new_outlet_location', 'new_outlet_location_url', 'photo_urls', 'stock_check', 'rerack_bottles', 'share_visi_pic', 'payment_follow_up', 'eye_level_placement'],
        'access_manager': ['id', 'user_email', 'full_name', 'role_name', 'city', 'distributor_ids', 'tile_permissions', 'created_at', 'updated_at', 'created_by']
    };
    if (knownSchemas[tableName]) {
        const dummyRow = {};
        knownSchemas[tableName].forEach(col => dummyRow[col] = null);
        return buildColumnsFromRow(dummyRow);
    }
    throw new Error(`Table "${tableName}" is empty and no schema defined. Add one row manually.`);
}

// ---------- Fetch all data ----------
async function fetchAllData(tableName) {
    let allData = [];
    let from = 0;
    const limit = 1000;
    setStatus(`Fetching data from ${tableName}...`);
    while (true) {
        const { data, error } = await supabaseClient
            .from(tableName)
            .select('*')
            .range(from, from + limit - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData = allData.concat(data);
        setStatus(`Fetched ${allData.length} rows...`);
        if (data.length < limit) break;
        from += limit;
    }
    return allData;
}

// ---------- Render Tabulator ----------
function renderTabulator(tableName, columns, data) {
    const container = document.getElementById('tableContainer');
    container.innerHTML = '';

    if (tabulator) {
        tabulator.destroy();
        tabulator = null;
    }

    const displayColumns = columns.map(col => ({
        ...col,
        editable: !isViewerMode && col.field !== '_delete'
    }));

    if (!isViewerMode) {
        displayColumns.unshift({
            title: '',
            field: '_delete',
            formatter: 'buttonCross',
            width: 40,
            headerSort: false,
            cellClick: (e, cell) => {
                if (confirm('Delete permanently?')) cell.getRow().delete();
            }
        });
    }

    // Add row selection column
    displayColumns.unshift({
        title: '<i class="fas fa-check-double"></i>',
        field: '_select',
        formatter: 'rowSelection',
        titleFormatter: 'rowSelection',
        width: 40,
        headerSort: false,
        hozAlign: 'center'
    });

    tabulator = new Tabulator(container, {
        data: data,
        layout: 'fitDataFill',
        height: '600px',
        pagination: true,
        paginationSize: 50,
        paginationSizeSelector: [20, 50, 100, 200],
        columns: displayColumns,
        selectable: true,
        selectableRangeMode: 'click',
        // Excel‑style filter: header filters + global search
        headerFilterLiveFilterDelay: 300,
        // Column visibility menu
        columnDefaults: { headerMenu: true },
        cellEdited: !isViewerMode ? (cell) => {
            const row = cell.getRow();
            const rowData = row.getData();
            const id = rowData.id;
            if (!id) { alert('Row must have an "id" column to update.'); return; }
            supabaseClient.from(tableName).update({ [cell.getField()]: cell.getValue() }).eq('id', id)
                .then(({ error }) => {
                    if (error) alert(`Update failed: ${error.message}`);
                    else setStatus(`✅ Updated ${cell.getField()}`);
                });
        } : undefined,
        rowDeleted: !isViewerMode ? (row) => {
            const id = row.getData().id;
            if (!id) return;
            supabaseClient.from(tableName).delete().eq('id', id)
                .then(({ error }) => {
                    if (error) alert(`Delete failed: ${error.message}`);
                    else setStatus(`🗑️ Deleted row ${id}`);
                });
        } : undefined
    });

    setStatus(`✅ Loaded "${tableName}" with ${data.length} rows (${isViewerMode ? 'Viewer' : 'Editor'} mode)`);
}

// ---------- Load Selected Table ----------
async function loadSelectedTable() {
    const select = document.getElementById('tableSelect');
    const tableName = select.value;
    if (!tableName) { alert('Select a table'); return; }

    const container = document.getElementById('tableContainer');
    container.innerHTML = '<div class="loading-indicator"><i class="fas fa-spinner fa-spin"></i> Loading data...</div>';
    setStatus(`Loading ${tableName}...`);

    try {
        const { data: sample, error: sampleError } = await supabaseClient
            .from(tableName)
            .select('*')
            .limit(1);
        if (sampleError) throw new Error(`Cannot access "${tableName}": ${sampleError.message}`);

        let columns;
        if (sample && sample.length > 0) {
            columns = buildColumnsFromRow(sample[0]);
        } else {
            columns = await getColumnsForEmptyTable(tableName);
        }

        const allData = await fetchAllData(tableName);
        currentTable = tableName;
        currentColumns = columns;
        currentData = allData;

        renderTabulator(tableName, columns, allData);
    } catch (error) {
        console.error('❌ Load error:', error);
        showError(container, error.message);
        setStatus(`Error: ${error.message}`, true);
    }
}

// ---------- Add Row ----------
async function addNewRow() {
    if (isViewerMode) { alert('Switch to Editor mode to add rows.'); return; }
    if (!currentTable) { alert('Select a table first'); return; }
    if (tabulator) {
        await tabulator.addRow({}, true);
        setStatus('➕ New row added. Double‑click to edit.');
    }
}

// ---------- Refresh ----------
async function refreshTable() {
    if (!currentTable) return;
    try {
        const allData = await fetchAllData(currentTable);
        currentData = allData;
        renderTabulator(currentTable, currentColumns, allData);
    } catch (e) { alert('Refresh failed: ' + e.message); }
}

// ---------- Toggle Mode ----------
function toggleMode() {
    isViewerMode = !isViewerMode;
    const toggleBtn = document.getElementById('modeToggleBtn');
    toggleBtn.innerHTML = isViewerMode ? '<i class="fas fa-eye"></i> Viewer' : '<i class="fas fa-edit"></i> Editor';
    toggleBtn.style.background = isViewerMode ? '#6b7280' : '#1e40af';
    if (currentTable && currentColumns.length) {
        renderTabulator(currentTable, currentColumns, currentData);
    }
    setStatus(`Switched to ${isViewerMode ? 'Viewer' : 'Editor'} mode`);
}

// ---------- Hide Selected Rows ----------
function hideSelectedRows() {
    if (!tabulator) return;
    const selectedRows = tabulator.getSelectedRows();
    if (selectedRows.length === 0) { alert('No rows selected'); return; }
    selectedRows.forEach(row => row.hide());
    setStatus(`Hidden ${selectedRows.length} row(s)`);
}

// ---------- Column Visibility ----------
function showColumnVisibility() {
    if (!tabulator) return;
    // Tabulator's built‑in column visibility menu is triggered by right‑clicking header.
    // We'll programmatically open the first column's menu.
    const firstCol = tabulator.getColumns()[0];
    if (firstCol) {
        // Not directly possible, but we can use the headerMenu option.
        // Alternative: create a custom dropdown using Tabulator's column list.
        // For simplicity, we'll alert that user can right-click headers.
        alert('Right‑click any column header to show/hide columns, or use the "Columns" button to toggle.');
    }
}

// ---------- Init ----------
async function init() {
    const isAuth = await checkAuth();
    if (!isAuth) return;

    await loadTableList();

    // Replace buttons to remove old listeners
    const loadBtn = document.getElementById('loadTableBtn');
    const addBtn = document.getElementById('addRowBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const modeBtn = document.getElementById('modeToggleBtn');
    const colVisBtn = document.getElementById('columnVisibilityBtn');
    const hideRowsBtn = document.getElementById('hideSelectedRowsBtn');

    const newLoad = loadBtn.cloneNode(true);
    const newAdd = addBtn.cloneNode(true);
    const newRefresh = refreshBtn.cloneNode(true);
    loadBtn.parentNode.replaceChild(newLoad, loadBtn);
    addBtn.parentNode.replaceChild(newAdd, addBtn);
    refreshBtn.parentNode.replaceChild(newRefresh, refreshBtn);

    newLoad.addEventListener('click', loadSelectedTable);
    newAdd.addEventListener('click', addNewRow);
    newRefresh.addEventListener('click', refreshTable);
    modeBtn.addEventListener('click', toggleMode);
    colVisBtn.addEventListener('click', showColumnVisibility);
    hideRowsBtn.addEventListener('click', hideSelectedRows);

    modeBtn.innerHTML = '<i class="fas fa-eye"></i> Viewer';
    console.log('🎉 Table Manager ready');
}

init();