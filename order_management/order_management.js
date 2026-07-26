// ============================================
// K95 Order Reconciliation Dashboard
// v3.0 – Full review fixes applied
// ============================================
console.log('📦 order_management.js v3.0 loaded');

let supabaseClient = null;
let supabaseAvailable = false;

if (typeof window.supabase === 'undefined') {
    console.error('❌ Supabase library not loaded.');
    alert('Supabase library failed to load. Please refresh or contact admin.');
} else {
    supabaseAvailable = true;
}

const SUPABASE_URL = 'https://jaasosewjbrwdklscxrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphYXNvc2V3amJyd2RrbHNjeHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMjAxMDEsImV4cCI6MjA4NTY5NjEwMX0.OE-dD6EN5DR3fvnaAd9jW3cJ7_5sYXNkY5vOQFQ00w0';

if (supabaseAvailable) {
    supabaseClient = window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        {
            auth: { persistSession: true, autoRefreshToken: true },
            global: {
                // FIX #14: Add no-cache headers on every request
                fetch: async (url, options = {}) => {
                    const parsedUrl = new URL(url);
                    const path = parsedUrl.pathname;
                    const query = parsedUrl.search;
                    const isAuth = path.startsWith('/auth/v1/');
                    const type = isAuth ? 'auth' : 'rest';
                    const apiPath = path.replace(isAuth ? '/auth/v1/' : '/rest/v1/', '');

                    const proxyUrl = new URL('/salesk95/proxy.php', window.location.origin);
                    proxyUrl.searchParams.set('type', type);
                    proxyUrl.searchParams.set('path', apiPath);

                    const searchParams = new URLSearchParams(query);
                    for (let [key, value] of searchParams.entries()) {
                        proxyUrl.searchParams.append(key, value);
                    }

                    // Add no-cache headers
                    options.headers = {
                        ...(options.headers || {}),
                        'Cache-Control': 'no-store, no-cache, must-revalidate',
                        'Pragma': 'no-cache'
                    };

                    return fetch(proxyUrl.toString(), options);
                }
            }
        }
    );
    console.log('✅ Supabase client initialized');
}

// ============================================
// Helpers
// ============================================
function formatDate(isoString) {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleDateString('en-IN', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    });
}

function formatCurrency(amount) {
    if (!amount && amount !== 0) return '₹0';
    return '₹' + Number(amount).toLocaleString('en-IN');
}

// FIX #2: IST-aware date boundary helpers
function toISTDateStart(dateStr) {
    // dateStr = 'YYYY-MM-DD', returns ISO with IST offset
    return dateStr + 'T00:00:00+05:30';
}
function toISTDateEnd(dateStr) {
    return dateStr + 'T23:59:59+05:30';
}

// ============================================
// Main class
// ============================================
class OrderReconciliation {
    constructor() {
        this.currentUser           = null;
        this.userRole              = null;
        this.distributorsList      = [];
        this.allowedDistributorIds = [];
        this.ordersData            = [];
        this.filteredOrders        = [];
        this.dataLoaded            = false; // FIX #1: track if data has been loaded
        this.filters = {
            dateRange:   'week',
            fromDate:    null,
            toDate:      null,
            distributor: ''
        };
        this.currentPage     = 1;
        this.pageSize        = 20;
        this.totalPages      = 1;
        this.pageSizeOptions = [10, 20, 50, 100];

        this.init();
    }

    async init() {
        if (!supabaseAvailable || !supabaseClient) {
            this.showLoginCard('Supabase not available. Please refresh.');
            return;
        }

        this.setLoginMessage('Checking session…', 'info');

        try {
            let session = await this.getSessionWithRetry(3, 800);
            if (!session) {
                console.warn('⚠️ No session yet – waiting for auth state change…');
                session = await this.waitForAuthEvent(4000);
            }
            if (!session) {
                console.log('ℹ️ No active session – showing message');
                this.showLoginCard('No active session found. Please log in via the main portal.');
                return;
            }
            await this.bootWithSession(session);
        } catch (err) {
            console.error('Init error:', err);
            this.showLoginCard('Failed to initialize. Please refresh the page.');
        }
    }

    async getSessionWithRetry(attempts = 3, delayMs = 800) {
        for (let i = 0; i < attempts; i++) {
            try {
                const { data: { session }, error } = await supabaseClient.auth.getSession();
                if (!error && session) {
                    console.log(`✅ Session found on attempt ${i + 1}`);
                    return session;
                }
                if (error) console.warn(`getSession attempt ${i + 1} error:`, error.message);
            } catch (e) {
                console.warn(`getSession attempt ${i + 1} threw:`, e.message);
            }
            if (i < attempts - 1) await this.sleep(delayMs);
        }
        return null;
    }

    waitForAuthEvent(timeoutMs = 4000) {
        return new Promise((resolve) => {
            let done = false;
            const timer = setTimeout(() => {
                if (!done) { done = true; resolve(null); }
            }, timeoutMs);
            supabaseClient.auth.onAuthStateChange((event, session) => {
                if (!done && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
                    done = true;
                    clearTimeout(timer);
                    console.log(`✅ Auth event received: ${event}`);
                    resolve(session);
                }
            });
        });
    }

    sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    async bootWithSession(session) {
        this.currentUser = { email: session.user.email, id: session.user.id };
        document.getElementById('userEmail').textContent = this.currentUser.email;

        await this.getUserRoleAndAccess();
        await this.loadAllDistributors();
        this.setDefaultDateRange();
        this.setupEventListeners();
        this.setupBulkActions();
        this.showDashboard();
        // FIX #1: Do NOT call loadOrders() here. Show prompt, wait for user to apply filters.
        this.showEmptyState('Apply filters above to load orders', 'fa-filter');
    }

    showLoginCard(message = '') {
        document.getElementById('loginCard').style.display = 'block';
        document.getElementById('mainDashboard').style.display = 'none';
        if (message) this.setLoginMessage(message, 'error');
    }

    showDashboard() {
        document.getElementById('loginCard').style.display = 'none';
        document.getElementById('mainDashboard').style.display = 'block';
    }

    setLoginMessage(text, type = 'error') {
        const el = document.getElementById('loginMessage');
        if (!el) return;
        el.textContent = text;
        el.className = `message ${type} show`;
    }

    async getUserRoleAndAccess() {
        try {
            const { data, error } = await supabaseClient
                .from('access_manager')
                .select('role_name, distributor_ids')
                .eq('user_email', this.currentUser.email)
                .maybeSingle();
            if (error) throw error;

            this.userRole = data?.role_name || 'user';
            this.allowedDistributorIds =
                (this.userRole === 'admin' || this.userRole === 'nsm')
                    ? []
                    : (data?.distributor_ids || []);

            console.log('Role:', this.userRole);
        } catch (err) {
            console.error('Access fetch error:', err);
            this.userRole = 'user';
            this.allowedDistributorIds = [];
        }
    }

    async loadAllDistributors() {
        const { data, error } = await supabaseClient
            .from('distributors')
            .select('distributor_id, distributor_name')
            .eq('status', 'Active')
            .order('distributor_name');
        if (error) { console.error('Distributor load error:', error); return; }

        this.distributorsList = data || [];
        const select = document.getElementById('distributorSelect');
        if (!select) return;
        select.innerHTML = '<option value="">All Distributors</option>';
        this.distributorsList.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.distributor_id;
            opt.textContent = d.distributor_name;
            select.appendChild(opt);
        });

        // Also populate fulfilled_by dropdown in modal (if present)
        const fbSelect = document.getElementById('modalFulfilledBy');
        if (fbSelect) {
            fbSelect.innerHTML = '<option value="">Same as Distributor</option>';
            this.distributorsList.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.distributor_id;
                opt.textContent = d.distributor_name;
                fbSelect.appendChild(opt);
            });
        }
    }

    setDefaultDateRange() {
        const today = new Date();
        const day = today.getDay();
        const diffToMonday = day === 0 ? 6 : day - 1;
        const monday = new Date(today); monday.setDate(today.getDate() - diffToMonday);
        const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);

        this.filters.fromDate  = monday.toISOString().split('T')[0];
        this.filters.toDate    = sunday.toISOString().split('T')[0];
        this.filters.dateRange = 'week';

        const df = document.getElementById('dateFrom');
        const dt = document.getElementById('dateTo');
        if (df) df.value = this.filters.fromDate;
        if (dt) dt.value = this.filters.toDate;

        document.querySelectorAll('[data-range]').forEach(chip =>
            chip.classList.toggle('active', chip.dataset.range === 'week')
        );
        const customDiv = document.getElementById('customDateRange');
        if (customDiv) customDiv.style.display = 'none';
    }

    setupEventListeners() {
        this._bindClick('filterToggle', () =>
            document.getElementById('filterPanel').classList.toggle('show')
        );
        this._bindClick('closeFilter', () =>
            document.getElementById('filterPanel').classList.remove('show')
        );
        // FIX #1: Only load orders when Apply is clicked
        this._bindClick('applyFilters', () => {
            this.currentPage = 1;
            this.loadOrders();
            document.getElementById('filterPanel').classList.remove('show');
        });

        // FIX #13: date range chips — lock custom inputs, unlock on custom
        document.querySelectorAll('[data-range]').forEach(chip => {
            chip.addEventListener('click', (e) => {
                document.querySelectorAll('[data-range]').forEach(c => c.classList.remove('active'));
                e.target.classList.add('active');
                const range = e.target.dataset.range;
                this.filters.dateRange = range;
                const customDiv = document.getElementById('customDateRange');
                const df = document.getElementById('dateFrom');
                const dt = document.getElementById('dateTo');

                if (range === 'custom') {
                    if (customDiv) customDiv.style.display = 'flex';
                    // Don't overwrite date inputs — user fills them
                } else {
                    if (customDiv) customDiv.style.display = 'none';
                    const today = new Date();
                    if (range === 'today') {
                        this.filters.fromDate = this.filters.toDate = today.toISOString().split('T')[0];
                    } else if (range === 'week') {
                        const d = today.getDay(), diff = d === 0 ? 6 : d - 1;
                        const mon = new Date(today); mon.setDate(today.getDate() - diff);
                        const sun = new Date(mon);   sun.setDate(mon.getDate() + 6);
                        this.filters.fromDate = mon.toISOString().split('T')[0];
                        this.filters.toDate   = sun.toISOString().split('T')[0];
                    } else if (range === 'month') {
                        this.filters.fromDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
                        this.filters.toDate   = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
                    }
                    if (df) df.value = this.filters.fromDate;
                    if (dt) dt.value = this.filters.toDate;
                }
            });
        });

        const df = document.getElementById('dateFrom');
        const dt = document.getElementById('dateTo');
        const ds = document.getElementById('distributorSelect');
        if (df) df.addEventListener('change', e => { this.filters.fromDate = e.target.value; });
        if (dt) dt.addEventListener('change', e => { this.filters.toDate   = e.target.value; });
        if (ds) ds.addEventListener('change', e => { this.filters.distributor = e.target.value; });
    }

    _bindClick(id, fn) {
        const el = document.getElementById(id);
        if (!el) return;
        const clone = el.cloneNode(true);
        el.parentNode.replaceChild(clone, el);
        clone.addEventListener('click', fn);
    }

    setupBulkActions() {
        this._bindChange('selectAll', (e) => {
            document.querySelectorAll('.order-checkbox input').forEach(cb => cb.checked = e.target.checked);
        });
        this._bindClick('applyBulk', async () => {
            const status = document.getElementById('bulkStatus').value;
            if (!status) { this.showToast('Please select a status', 'warning'); return; }
            const ids = this.getSelectedOrderIds();
            if (ids.length === 0) { this.showToast('No orders selected', 'warning'); return; }

            if (status === 'Delivered') {
                // Show delivery prompt for bulk — get date + remarks before proceeding
                this.openBulkDeliveryPrompt(ids);
            } else {
                if (!confirm(`Change ${ids.length} order(s) to ${status}?`)) return;
                await this.bulkUpdateStatus(ids, status, null, null);
            }
        });
    }

    _bindChange(id, fn) {
        const el = document.getElementById(id);
        if (!el) return;
        const clone = el.cloneNode(true);
        el.parentNode.replaceChild(clone, el);
        clone.addEventListener('change', fn);
    }

    getSelectedOrderIds() {
        return Array.from(document.querySelectorAll('.order-checkbox input:checked')).map(cb => cb.value);
    }

    // FIX #4: Stock eligibility check before bulk delivery
    async checkStockEligibility(orderId) {
        const order = this.ordersData.find(o => o.id === orderId);
        if (!order || order.fulfillment_type !== 'Distributor') return { eligible: true, reason: 'N/A' };
        if (order.inventory_deducted) return { eligible: true, reason: 'Already deducted' };

        const distributorId = order.fulfilled_by_distributor_id || order.distributor_id;
        const items = order.order_items || [];

        for (const item of items) {
            try {
                const { data, error } = await supabaseClient.rpc('check_inventory', {
                    p_distributor_id: distributorId,
                    p_product_id: item.product_id,
                    p_required_qty: item.qty
                });
                if (error) throw error;
                if (data && !data.available) {
                    return { eligible: false, reason: data.message || 'Insufficient stock' };
                }
            } catch (e) {
                console.error('Stock check error:', e);
                return { eligible: null, reason: 'Check failed: ' + e.message };
            }
        }
         return { eligible: true, reason: 'Stock check skipped – DB will enforce inventory' };
    }

    // FIX #4 + #3: Pre-check and sort by created_at before bulk update
   // FIX #4: Simplified bulk delivery – no stock pre‑check
async openBulkDeliveryPrompt(ids) {
    // Sort by created_at ascending (FIX #3)
    const sorted = [...ids].sort((a, b) => {
        const oa = this.ordersData.find(o => o.id === a);
        const ob = this.ordersData.find(o => o.id === b);
        return new Date(oa?.created_at) - new Date(ob?.created_at);
    });

    const deliveryModal = document.getElementById('deliveryModal');
    const body = document.getElementById('deliveryModalBody');
    const today = new Date().toISOString().split('T')[0];

    // Build a simple list of orders (no stock check)
    let ordersHtml = '<ul style="margin:8px 0 0 20px; font-size:0.85rem;">';
    for (const id of sorted) {
        const order = this.ordersData.find(o => o.id === id);
        ordersHtml += `<li>#${order?.order_number || id} – ${order?.distributor?.distributor_name || order?.distributor_id}</li>`;
    }
    ordersHtml += '</ul>';

    body.innerHTML = `
        <div class="form-group">
            <label>Delivery Date</label>
            <input type="date" id="bulkDeliveryDate" value="${today}" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:12px;">
        </div>
        <div class="form-group">
            <label>Delivery Remarks (applies to all)</label>
            <textarea id="bulkDeliveryRemarks" placeholder="Optional remarks…" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:12px;"></textarea>
        </div>
        <div style="margin-top:12px;">
            <strong>Orders to deliver (${sorted.length})</strong>
            ${ordersHtml}
            <p style="margin-top:10px; font-size:0.8rem; color:#64748b;">
                ⚠️ Stock availability will be checked by the system. Orders with insufficient stock will fail.
            </p>
        </div>
    `;

    deliveryModal.classList.add('show');

    document.getElementById('deliveryConfirm').onclick = async () => {
        const deliveryDate    = document.getElementById('bulkDeliveryDate').value;
        const deliveryRemarks = document.getElementById('bulkDeliveryRemarks').value.trim();
        deliveryModal.classList.remove('show');
        await this.bulkUpdateStatus(sorted, 'Delivered', deliveryDate, deliveryRemarks);
    };
    document.getElementById('deliveryCancel').onclick = () => deliveryModal.classList.remove('show');
}

    // FIX #3: Bulk processes in created_at order; FIX #8/#9: passes delivery date + remarks
    async bulkUpdateStatus(orderIds, newStatus, deliveryDate, deliveryRemarks) {
        // Ensure sorted by created_at ascending
        const sorted = [...orderIds].sort((a, b) => {
            const oa = this.ordersData.find(o => o.id === a);
            const ob = this.ordersData.find(o => o.id === b);
            return new Date(oa?.created_at) - new Date(ob?.created_at);
        });

        const btn = document.getElementById('applyBulk');
        if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }
        let ok = 0, fail = 0;

        for (const id of sorted) {
            try {
                const upd = { order_status: newStatus };
                if (newStatus === 'Delivered') {
                    upd.delivery_date    = deliveryDate || new Date().toISOString().split('T')[0];
                    if (deliveryRemarks) upd.delivery_remarks = deliveryRemarks;
                }
                const { error } = await supabaseClient.from('orders').update(upd).eq('id', id);
                if (error) throw error;
                ok++;
            } catch (e) {
                console.error('Bulk update error for', id, e);
                fail++;
            }
        }

        if (btn) { btn.disabled = false; btn.textContent = 'Apply to Selected'; }
        this.showToast(`Updated ${ok} order(s)${fail ? `. ${fail} failed.` : '.'}`, fail ? 'warning' : 'success');
        this.loadOrders();
    }

    async loadOrders() {
        const sectionsEl = document.getElementById('orderSections');
        const loading    = document.getElementById('loading');
        const emptyState = document.getElementById('emptyState');

        if (loading)    loading.style.display = 'block';
        if (sectionsEl) sectionsEl.innerHTML  = '';
        if (emptyState) emptyState.style.display = 'none';

        try {
            let query = supabaseClient
                .from('orders')
                .select(`
                    *,
                    order_items ( * ),
                    distributor:distributor_id ( distributor_name ),
                    outlet:outlet_id ( outlet_name )
                `)
                .order('created_at', { ascending: false });

            if (this.userRole !== 'admin' && this.userRole !== 'nsm') {
                if (this.allowedDistributorIds.length > 0) {
                    query = query.in('distributor_id', this.allowedDistributorIds);
                } else {
                    if (loading) loading.style.display = 'none';
                    this.showEmptyState('No distributors assigned to your account.', 'fa-ban');
                    return;
                }
            }

            if (this.filters.distributor) query = query.eq('distributor_id', this.filters.distributor);

            // FIX #2: Use IST-aware timestamps
            if (this.filters.fromDate && this.filters.toDate) {
                query = query
                    .gte('created_at', toISTDateStart(this.filters.fromDate))
                    .lte('created_at', toISTDateEnd(this.filters.toDate));
            }

            const { data, error } = await query;
            if (error) throw error;

            this.dataLoaded = true;
            this.ordersData = data || [];
            console.log(`✅ ${this.ordersData.length} orders loaded`);
            this.applyFiltersAndRender();
        } catch (err) {
            console.error('Error loading orders:', err);
            if (loading) loading.style.display = 'none';
            this.showToast('Error loading orders: ' + err.message, 'error');
        }
    }

    applyFiltersAndRender() {
        const loading = document.getElementById('loading');
        if (loading) loading.style.display = 'none';

        // Group by status
        const groups = {
            Draft:     this.ordersData.filter(o => o.order_status === 'Draft').sort((a,b) => new Date(b.created_at) - new Date(a.created_at)),
            Delivered: this.ordersData.filter(o => o.order_status === 'Delivered').sort((a,b) => new Date(b.created_at) - new Date(a.created_at)),
            Cancelled: this.ordersData.filter(o => o.order_status === 'Cancelled').sort((a,b) => new Date(b.created_at) - new Date(a.created_at)),
        };

        const sectionsEl = document.getElementById('orderSections');
        sectionsEl.innerHTML = '';

        const bulkBar    = document.getElementById('bulkBar');
        const totalCount = this.ordersData.length;

        if (totalCount === 0) {
            this.showEmptyState('No orders found for the selected filters.', 'fa-box-open');
            if (bulkBar) bulkBar.style.display = 'none';
            return;
        }

        if (bulkBar) bulkBar.style.display = 'flex';

        const sectionConfig = [
            { key: 'Draft',     label: 'Draft Orders',     icon: 'fa-pencil-alt',   color: '#334155' },
            { key: 'Delivered', label: 'Delivered Orders',  icon: 'fa-check-circle', color: '#155724' },
            { key: 'Cancelled', label: 'Cancelled Orders',  icon: 'fa-times-circle', color: '#721c24' },
        ];

        sectionConfig.forEach(cfg => {
            const orders = groups[cfg.key] || [];
            const section = this.renderSection(cfg, orders);
            sectionsEl.appendChild(section);
        });
    }

    renderSection(cfg, orders) {
        const wrapper = document.createElement('div');

        const header = document.createElement('div');
        header.className = 'section-header';
        header.innerHTML = `
            <div class="section-title">
                <i class="fas ${cfg.icon}" style="color:${cfg.color};"></i>
                ${cfg.label}
                <span class="section-count">${orders.length}</span>
            </div>
            <i class="fas fa-chevron-down section-chevron ${orders.length === 0 ? 'collapsed' : ''}"></i>
        `;

        const body = document.createElement('div');
        body.className = 'section-body' + (orders.length === 0 ? ' collapsed' : '');

        if (orders.length === 0) {
            body.innerHTML = `<div class="empty-state" style="padding:20px 0;"><p>No ${cfg.key.toLowerCase()} orders</p></div>`;
        } else {
            orders.forEach(order => this.renderOrderCard(order, body));
        }

        header.addEventListener('click', () => {
            const chevron = header.querySelector('.section-chevron');
            body.classList.toggle('collapsed');
            chevron.classList.toggle('collapsed');
        });

        wrapper.appendChild(header);
        wrapper.appendChild(body);
        return wrapper;
    }

    showEmptyState(message, icon = 'fa-box-open') {
        const el = document.getElementById('emptyState');
        if (!el) return;
        el.innerHTML = `<i class="fas ${icon}"></i><p>${message}</p>`;
        el.style.display = 'block';
        const sectionsEl = document.getElementById('orderSections');
        if (sectionsEl) sectionsEl.innerHTML = '';
        const bulkBar = document.getElementById('bulkBar');
        if (bulkBar) bulkBar.style.display = 'none';
    }

renderOrderCard(order, container) {
    const card = document.createElement('div');
    card.className = 'order-card';
    card.dataset.id = order.id;

    const items = order.order_items || [];
    const totalQty = items.reduce((s, i) => s + (i.qty || 0), 0);
    const totalAmount = items.reduce((s, i) => s + (i.rate * i.qty), 0);

    const statusClass = {
        Draft: 'status-draft', Pending: 'status-pending',
        Delivered: 'status-delivered', Cancelled: 'status-cancelled'
    }[order.order_status] || '';

    const fulfillmentClass = order.fulfillment_type === 'Distributor'
        ? 'fulfillment-distributor' : 'fulfillment-self';

    // Fulfilled by info (if any)
    const fulfilledByName = order.fulfilled_by_distributor_id
        ? (this.distributorsList.find(d => d.distributor_id === order.fulfilled_by_distributor_id)?.distributor_name || order.fulfilled_by_distributor_id)
        : null;
    const fulfilledByHtml = fulfilledByName
        ? `<div class="detail-item"><i class="fas fa-exchange-alt"></i> ${fulfilledByName}</div>` : '';

    // Delivery date & remarks (only for delivered orders)
    const deliveryDateHtml = order.delivery_date
        ? `<div class="detail-item"><i class="fas fa-truck"></i> ${formatDate(order.delivery_date)}</div>` : '';
    const remarksHtml = order.delivery_remarks
        ? `<div class="detail-item"><i class="fas fa-comment-alt"></i> ${order.delivery_remarks}</div>` : '';

    // Stock indicator (simplified)
    let stockHtml = '';
    if (order.fulfillment_type === 'Distributor' && !order.inventory_deducted && order.order_status === 'Draft') {
        stockHtml = `<span class="stock-badge na"><i class="fas fa-info-circle"></i> Stock verified on delivery</span>`;
    }

    card.innerHTML = `
        <div class="order-checkbox">
            <input type="checkbox" value="${order.id}">
        </div>
        <div class="order-content">
            <div class="order-header-row">
                <div class="order-title">
                    <span class="order-number">#${order.order_number}</span>
                    <span class="status-badge ${statusClass}">${order.order_status}</span>
                    ${stockHtml ? `<span class="stock-indicator">${stockHtml}</span>` : ''}
                </div>
                <div class="order-actions">
                    <select class="status-select" data-order-id="${order.id}">
                        <option value="Draft"     ${order.order_status === 'Draft'     ? 'selected' : ''}>DRAFT</option>
                        <option value="Pending"   ${order.order_status === 'Pending'   ? 'selected' : ''}>PENDING</option>
                        <option value="Delivered" ${order.order_status === 'Delivered' ? 'selected' : ''}>DELIVERED</option>
                        <option value="Cancelled" ${order.order_status === 'Cancelled' ? 'selected' : ''}>CANCELLED</option>
                    </select>
                    <button class="btn-small edit-btn" data-order-id="${order.id}">Edit</button>
                </div>
            </div>
            <div class="order-details-row">
                <div class="detail-item"><i class="fas fa-calendar"></i> ${formatDate(order.created_at)}</div>
                <div class="detail-item"><i class="fas fa-store"></i> ${order.distributor?.distributor_name || order.distributor_id}</div>
                <div class="detail-item"><i class="fas fa-map-marker-alt"></i> ${order.outlet?.outlet_name || order.outlet_id}</div>
                <div class="detail-item"><i class="fas fa-boxes"></i> Total Qty: <strong>${totalQty}</strong> | Amount: <strong class="order-total">${formatCurrency(totalAmount)}</strong></div>
                ${fulfilledByHtml}
                ${deliveryDateHtml}
                ${remarksHtml}
                <div class="detail-item">
                    <span class="fulfillment-badge ${fulfillmentClass}">
                        <i class="fas ${order.fulfillment_type === 'Distributor' ? 'fa-truck' : 'fa-user'}"></i>
                        ${order.fulfillment_type}
                    </span>
                </div>
            </div>
        </div>
    `;

    // Event listeners (unchanged)
    const statusSelect = card.querySelector('.status-select');
    statusSelect.addEventListener('change', async (e) => {
        const newStatus = e.target.value;
        const oldStatus = order.order_status;
        if (newStatus === oldStatus) return;

        if (newStatus === 'Delivered') {
            statusSelect.value = oldStatus; // reset while modal is open
            this.openSingleDeliveryPrompt(order, async (deliveryDate, deliveryRemarks, fulfilledById) => {
                statusSelect.disabled = true;
                try {
                    await this.updateOrderStatus(order.id, newStatus, deliveryDate, deliveryRemarks, fulfilledById);
                } catch (err) {
                    this.showToast('Update failed: ' + err.message, 'error');
                    statusSelect.value = oldStatus;
                } finally {
                    statusSelect.disabled = false;
                }
            });
        } else {
            if (!confirm(`Change order #${order.order_number} to ${newStatus}?`)) {
                statusSelect.value = oldStatus;
                return;
            }
            statusSelect.disabled = true;
            try {
                await this.updateOrderStatus(order.id, newStatus, null, null, null);
            } catch (err) {
                this.showToast('Update failed: ' + err.message, 'error');
                statusSelect.value = oldStatus;
            } finally {
                statusSelect.disabled = false;
            }
        }
    });

    card.querySelector('.edit-btn').addEventListener('click', () => this.openEditModal(order));
    container.appendChild(card);
}


    // FIX #20: Delivery date + remarks + fulfilled_by prompt for single order
    openSingleDeliveryPrompt(order, onConfirm) {
        const deliveryModal = document.getElementById('deliveryModal');
        const body = document.getElementById('deliveryModalBody');
        const today = new Date().toISOString().split('T')[0];

        // Build fulfillment distributor options
        let fulfilledByOptions = '<option value="">Same as Distributor</option>';
        this.distributorsList.forEach(d => {
            fulfilledByOptions += `<option value="${d.distributor_id}">${d.distributor_name}</option>`;
        });

        body.innerHTML = `
            <p style="margin-bottom:14px;font-size:0.9rem;color:#334155;">
                <strong>#${order.order_number}</strong> — ${order.distributor?.distributor_name || order.distributor_id}
            </p>
            <div class="form-group">
                <label>Delivery Date</label>
                <input type="date" id="singleDeliveryDate" value="${today}" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:12px;font-size:0.95rem;">
            </div>
            <div class="form-group">
                <label>Delivery Remarks</label>
                <textarea id="singleDeliveryRemarks" placeholder="Optional remarks…" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:12px;font-size:0.9rem;min-height:60px;resize:vertical;"></textarea>
            </div>
            ${order.fulfillment_type === 'Distributor' ? `
            <div class="form-group">
                <label>Fulfilled By (if different)</label>
                <select id="singleFulfilledBy" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:12px;font-size:0.95rem;background:white;">
                    ${fulfilledByOptions}
                </select>
            </div>` : ''}
        `;

        deliveryModal.classList.add('show');

        document.getElementById('deliveryConfirm').onclick = () => {
            const deliveryDate    = document.getElementById('singleDeliveryDate').value;
            const deliveryRemarks = document.getElementById('singleDeliveryRemarks').value.trim();
            const fulfilledById   = document.getElementById('singleFulfilledBy')?.value || null;
            deliveryModal.classList.remove('show');
            onConfirm(deliveryDate, deliveryRemarks, fulfilledById);
        };
        document.getElementById('deliveryCancel').onclick = () => {
            deliveryModal.classList.remove('show');
        };
    }

    // FIX #6, #8, #9, #7: updateOrderStatus now takes delivery details; preserves existing delivery_date
    async updateOrderStatus(orderId, newStatus, deliveryDate, deliveryRemarks, fulfilledById) {
        const order = this.ordersData.find(o => o.id === orderId);
        const upd = { order_status: newStatus };

        if (newStatus === 'Delivered') {
            // Only set/update delivery_date if explicitly provided
            if (deliveryDate) upd.delivery_date = deliveryDate;
            if (deliveryRemarks) upd.delivery_remarks = deliveryRemarks;
            // FIX #7: set fulfilled_by_distributor_id if provided
            if (fulfilledById) upd.fulfilled_by_distributor_id = fulfilledById;
        }
        // FIX #6: Do NOT null out delivery_date when changing non-delivery status
        // Only set it if new status is Delivered; otherwise leave existing column untouched

        const { error } = await supabaseClient
            .from('orders')
            .update(upd)
            .eq('id', orderId);
        if (error) throw error;
        await this.loadOrders();
    }

    // ============================================
    // MODAL
    // ============================================
    openEditModal(order) {
        const modal      = document.getElementById('orderModal');
        const detailsDiv = document.getElementById('modalOrderDetails');

        // Build fulfillment distributor options for modal
        let fulfilledByOptions = '<option value="">Same as Distributor</option>';
        this.distributorsList.forEach(d => {
            const sel = order.fulfilled_by_distributor_id === d.distributor_id ? 'selected' : '';
            fulfilledByOptions += `<option value="${d.distributor_id}" ${sel}>${d.distributor_name}</option>`;
        });

        let html = `
            <div class="form-group">
                <label>Order: <strong>#${order.order_number}</strong></label>
                <p style="font-size:0.85rem;color:#64748b;margin-top:4px;">
                    ${order.distributor?.distributor_name || order.distributor_id} — ${order.outlet?.outlet_name || order.outlet_id}
                </p>
            </div>
            <div class="form-group">
                <label>Order Status</label>
                <select id="modalStatus">
                    <option value="Draft"     ${order.order_status==='Draft'     ?'selected':''}>Draft</option>
                    <option value="Pending"   ${order.order_status==='Pending'   ?'selected':''}>Pending</option>
                    <option value="Delivered" ${order.order_status==='Delivered' ?'selected':''}>Delivered</option>
                    <option value="Cancelled" ${order.order_status==='Cancelled' ?'selected':''}>Cancelled</option>
                </select>
            </div>
            <div class="form-group" id="deliveryDateGroup" style="display:${order.order_status==='Delivered'?'block':'none'}">
                <label>Delivery Date</label>
                <input type="date" id="modalDeliveryDate" value="${order.delivery_date || new Date().toISOString().split('T')[0]}">
            </div>
            <div class="form-group" id="remarksGroup">
                <label>Delivery Remarks</label>
                <textarea id="modalDeliveryRemarks" placeholder="Optional remarks…">${order.delivery_remarks || ''}</textarea>
            </div>
            <div class="form-group" id="fulfilledByGroup" style="display:${order.fulfillment_type==='Distributor'?'block':'none'}">
                <label>Fulfilled By (if different distributor)</label>
                <select id="modalFulfilledBy" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:12px;font-size:0.95rem;background:white;">
                    ${fulfilledByOptions}
                </select>
            </div>
            <h4 style="margin:16px 0 8px;color:#1e3c72;">Items</h4>
            <table class="items-table">
                <thead><tr><th>Product</th><th>Ordered</th><th>Qty</th><th>Rate</th><th>Total</th><th></th></tr></thead>
                <tbody id="modalItemsBody">
        `;

        (order.order_items || []).forEach(item => {
            html += `
                <tr data-item-id="${item.id}">
                    <td>${item.product_id}</td>
                    <td style="color:#94a3b8;">${item.qty}</td>
                    <td><input type="number" class="item-qty" value="${item.qty}" min="0" step="1"></td>
                    <td>${formatCurrency(item.rate)}</td>
                    <td class="item-total">${formatCurrency(item.rate * item.qty)}</td>
                    <td><button class="item-remove" title="Remove item">×</button></td>
                </tr>`;
        });
        html += '</tbody></table>';
        detailsDiv.innerHTML = html;

        document.getElementById('modalStatus').addEventListener('change', function () {
            document.getElementById('deliveryDateGroup').style.display = this.value === 'Delivered' ? 'block' : 'none';
        });

        document.querySelectorAll('.item-qty').forEach(input => {
            input.addEventListener('input', (e) => {
                const row  = e.target.closest('tr');
                const rate = parseFloat(row.cells[3].innerText.replace('₹', '').replace(/,/g, '')) || 0;
                const qty  = parseInt(e.target.value) || 0;
                row.querySelector('.item-total').innerText = formatCurrency(rate * qty);
            });
        });

        document.querySelectorAll('.item-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const row = e.target.closest('tr');
                row.querySelector('.item-qty').value = 0;
                row.style.opacity = '0.4';
                row.style.textDecoration = 'line-through';
                btn.textContent = '↩';
                btn.title = 'Undo removal';
                btn.style.background = '#d4edda';
                btn.style.color = '#155724';
                btn.onclick = () => {
                    row.style.opacity = '';
                    row.style.textDecoration = '';
                    btn.textContent = '×';
                    btn.title = 'Remove item';
                    btn.style.background = '';
                    btn.style.color = '';
                    row.querySelector('.item-qty').value = parseInt(row.cells[1].innerText) || 0;
                };
            });
        });

        modal.classList.add('show');
        document.getElementById('modalSave').onclick   = () => this.saveOrder(order);
        document.getElementById('modalCancel').onclick = () => modal.classList.remove('show');
    }

    // FIX #5: Update items FIRST, then update status to avoid trigger firing with wrong quantities
    // FIX #6: Only set delivery_date if status is Delivered; don't null it otherwise
    async saveOrder(order) {
        const modal = document.getElementById('orderModal');
        const newStatus       = document.getElementById('modalStatus').value;
        const deliveryDateEl  = document.getElementById('modalDeliveryDate');
        const deliveryRemarks = document.getElementById('modalDeliveryRemarks')?.value.trim() || null;
        const fulfilledById   = document.getElementById('modalFulfilledBy')?.value || null;

        const items = [];
        const itemsToDelete = [];

        document.querySelectorAll('#modalItemsBody tr').forEach(row => {
            const itemId = row.dataset.itemId;
            const qty = parseInt(row.querySelector('.item-qty').value) || 0;
            if (qty === 0) {
                itemsToDelete.push(itemId);
            } else {
                items.push({ id: itemId, qty });
            }
        });

        try {
            // FIX #5: STEP 1 — Update items first (trigger hasn't fired yet, status unchanged)
            for (const itemId of itemsToDelete) {
                const { error } = await supabaseClient.from('order_items').delete().eq('id', itemId);
                if (error) throw error;
            }
            for (const item of items) {
                const { error } = await supabaseClient.from('order_items').update({ qty: item.qty }).eq('id', item.id);
                if (error) throw error;
            }

            // STEP 2 — Build status update payload
            const upd = { order_status: newStatus };

            // FIX #6: Only set delivery_date when status is Delivered; don't wipe it when editing other fields
            if (newStatus === 'Delivered') {
                upd.delivery_date = deliveryDateEl?.value || new Date().toISOString().split('T')[0];
            }
            // delivery_remarks can be set regardless
            if (deliveryRemarks !== null) upd.delivery_remarks = deliveryRemarks;
            // FIX #7: fulfilled_by_distributor_id
            if (fulfilledById !== null) upd.fulfilled_by_distributor_id = fulfilledById || null;

            // STEP 3 — Now update the order status (trigger fires here with correct item qtys)
            const { error: oe } = await supabaseClient.from('orders').update(upd).eq('id', order.id);
            if (oe) throw oe;

            this.showToast('Order updated successfully!', 'success');
            modal.classList.remove('show');
            this.loadOrders();
        } catch (err) {
            console.error('Save error:', err);
            this.showToast('Error updating order: ' + err.message, 'error');
        }
    }

    // ============================================
    // TOAST
    // ============================================
    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => { toast.remove(); }, 4000);
    }
}

// ============================================
// START
// ============================================
const app = new OrderReconciliation();
window.app = app;