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
                    const requestHeaders = new Headers(options.headers || {});
                    requestHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate');
                    requestHeaders.set('Pragma', 'no-cache');
                    if (!isAuth && options.body && !requestHeaders.has('Content-Type')) {
                        requestHeaders.set('Content-Type', 'application/json');
                    }
                    options.headers = requestHeaders;

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

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[char]));
}

function localDateValue(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
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
            dateRange:   'month',
            fromDate:    null,
            toDate:      null,
            distributors: []
        };
        this.activeKpi = 'draft_pending';
        this.loadingOrders = false;
        this.lastLoadAt = 0;
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
        await this.getUserRoleAndAccess();
        this.renderUserAvatar();
        await this.loadAllDistributors();
        this.setDefaultDateRange();
        this.setupEventListeners();
        this.setupBulkActions();
        this.showDashboard();
        await this.loadOrders();
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
                .select('role_name, full_name, avatar_url, distributor_ids, tile_permissions')
                .ilike('user_email', this.currentUser.email)
                .maybeSingle();
            if (error) throw error;
            if (!data) throw new Error('Access record not found.');
            const permission = data.tile_permissions?.stock_management?.access;
            if (!permission || permission === 'none') throw new Error('You do not have access to Order Management.');

            this.userRole = String(data?.role_name || 'user').trim().toLowerCase();
            this.userAccess = data;
            this.allowedDistributorIds =
                (this.userRole === 'admin' || this.userRole === 'nsm')
                    ? []
                    : (data?.distributor_ids || []);

            console.log('Role:', this.userRole);
        } catch (err) {
            console.error('Access fetch error:', err);
            throw err;
        }
    }

    async loadAllDistributors() {
        let query = supabaseClient.from('distributors')
            .select('distributor_id, distributor_name')
            .eq('status', 'Active')
            .order('distributor_name');
        if (this.userRole !== 'admin' && this.userRole !== 'nsm') {
            if (!this.allowedDistributorIds.length) {
                this.distributorsList = [];
                return;
            }
            query = query.in('distributor_id', this.allowedDistributorIds);
        }
        const { data, error } = await query;
        if (error) { console.error('Distributor load error:', error); return; }

        this.distributorsList = data || [];
        this.filters.distributors = this.distributorsList.map(d => String(d.distributor_id));
        const options = document.getElementById('distributorOptions');
        if (!options) return;
        options.innerHTML = this.distributorsList.map(d => `<label class="distributor-option"><input type="checkbox" value="${escapeHTML(d.distributor_id)}" checked><span>${escapeHTML(d.distributor_name)}</span></label>`).join('');

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
        const today = new Date(`${localDateValue()}T12:00:00+05:30`);
        this.filters.fromDate  = localDateValue(new Date(today.getFullYear(), today.getMonth(), 1, 12));
        this.filters.toDate    = localDateValue(new Date(today.getFullYear(), today.getMonth() + 1, 0, 12));
        this.filters.dateRange = 'month';

        const df = document.getElementById('dateFrom');
        const dt = document.getElementById('dateTo');
        if (df) df.value = this.filters.fromDate;
        if (dt) dt.value = this.filters.toDate;

        document.querySelectorAll('[data-range]').forEach(chip =>
            chip.classList.toggle('active', chip.dataset.range === 'month')
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
            this.filters.distributors = Array.from(document.querySelectorAll('#distributorOptions input:checked')).map(el => el.value);
            this.loadOrders();
        });
        this._bindClick('selectAllDistributors', () => document.querySelectorAll('#distributorOptions input').forEach(el => el.checked = true));
        this._bindClick('unselectAllDistributors', () => document.querySelectorAll('#distributorOptions input').forEach(el => el.checked = false));
        document.querySelectorAll('[data-kpi]').forEach(card => card.addEventListener('click', () => {
            this.activeKpi = card.dataset.kpi; this.currentPage = 1; this.applyFiltersAndRender();
        }));
        this._bindClick('pagePrev', () => { if (this.currentPage > 1) { this.currentPage--; this.applyFiltersAndRender(); } });
        this._bindClick('pageNext', () => { if (this.currentPage < this.totalPages) { this.currentPage++; this.applyFiltersAndRender(); } });
        this._bindChange('pageSize', e => { this.pageSize = e.target.value === 'all' ? 0 : (Number(e.target.value) || 20); this.currentPage = 1; this.applyFiltersAndRender(); });

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
                    const today = new Date(`${localDateValue()}T12:00:00+05:30`);
                    if (range === 'today') {
                        this.filters.fromDate = this.filters.toDate = localDateValue(today);
                    } else if (range === 'week') {
                        const d = today.getDay(), diff = d === 0 ? 6 : d - 1;
                        const mon = new Date(today); mon.setDate(today.getDate() - diff);
                        const sun = new Date(mon);   sun.setDate(mon.getDate() + 6);
                        this.filters.fromDate = localDateValue(mon);
                        this.filters.toDate   = localDateValue(sun);
                    } else if (range === 'month') {
                        this.filters.fromDate = localDateValue(new Date(today.getFullYear(), today.getMonth(), 1, 12));
                        this.filters.toDate   = localDateValue(new Date(today.getFullYear(), today.getMonth() + 1, 0, 12));
                    }
                    if (df) df.value = this.filters.fromDate;
                    if (dt) dt.value = this.filters.toDate;
                }
            });
        });

        const df = document.getElementById('dateFrom');
        const dt = document.getElementById('dateTo');
        if (df) df.addEventListener('change', e => { this.filters.fromDate = e.target.value; });
        if (dt) dt.addEventListener('change', e => { this.filters.toDate   = e.target.value; });
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
            document.querySelectorAll('.order-checkbox input:not(:disabled)').forEach(cb => cb.checked = e.target.checked);
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
    const today = localDateValue();

    // Build a simple list of orders (no stock check)
    let ordersHtml = '<ul style="margin:8px 0 0 20px; font-size:0.85rem;">';
    for (const id of sorted.slice(0, 5)) {
        const order = this.ordersData.find(o => o.id === id);
        ordersHtml += `<li>#${order?.order_number || id} – ${order?.distributor?.distributor_name || order?.distributor_id}</li>`;
    }
    if (sorted.length > 5) ordersHtml += `<li><strong>+ ${sorted.length - 5} more orders</strong></li>`;
    ordersHtml += '</ul>';

    body.innerHTML = `
        <div class="form-group">
            <label>Delivery Date</label>
            <input type="date" id="bulkDeliveryDate" value="${today}" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:12px;">
        </div>
        ${this.userRole === 'admin' ? `<div class="form-group"><label>Fulfilment type</label><select id="bulkFulfillmentType" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:12px;background:white;"><option value="Distributor">Distributor inventory</option><option value="Self Serving">Self Fulfilment (no inventory deduction)</option></select><small style="display:block;margin-top:6px;color:#64748b">Self Fulfilment does not reduce distributor inventory.</small></div>` : ''}
        <div class="form-group">
            <label>Delivery Remarks (applies to all)</label>
            <textarea id="bulkDeliveryRemarks" placeholder="Optional remarks…" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:12px;"></textarea>
        </div>
        <div style="margin-top:12px;">
            <strong>Orders to deliver (${sorted.length})</strong>
            ${ordersHtml}
            <p id="bulkFulfilmentHelp" style="margin-top:10px; font-size:0.8rem; color:#64748b;">
                ⚠️ Stock availability will be checked by the system. Orders with insufficient stock will fail.
            </p>
        </div>
    `;

    deliveryModal.classList.add('show');
    document.getElementById('bulkFulfillmentType')?.addEventListener('change', event => {
        document.getElementById('bulkFulfilmentHelp').textContent = event.target.value === 'Self Serving'
            ? 'Self Fulfilment marks the selected Draft orders Delivered without changing distributor inventory.'
            : 'Distributor fulfilment checks and deducts inventory.';
    });

    document.getElementById('deliveryConfirm').onclick = async () => {
        const deliveryDate    = document.getElementById('bulkDeliveryDate').value;
        const deliveryRemarks = document.getElementById('bulkDeliveryRemarks').value.trim();
        const fulfillmentType = document.getElementById('bulkFulfillmentType')?.value || 'Distributor';
        deliveryModal.classList.remove('show');
        await this.bulkUpdateStatus(sorted, 'Delivered', deliveryDate, deliveryRemarks, fulfillmentType);
    };
    document.getElementById('deliveryCancel').onclick = () => deliveryModal.classList.remove('show');
}

    // FIX #3: Bulk processes in created_at order; FIX #8/#9: passes delivery date + remarks
    async bulkUpdateStatus(orderIds, newStatus, deliveryDate, deliveryRemarks, fulfillmentType = null) {
        // Ensure sorted by created_at ascending
        const sorted = [...orderIds].sort((a, b) => {
            const oa = this.ordersData.find(o => o.id === a);
            const ob = this.ordersData.find(o => o.id === b);
            return new Date(oa?.created_at) - new Date(ob?.created_at);
        });
        const eligibleIds = sorted.filter(id => this.ordersData.find(o => o.id === id)?.order_status === 'Draft');
        if (!eligibleIds.length) {
            this.showToast('Select at least one Draft order.', 'warning');
            return;
        }

        const btn = document.getElementById('applyBulk');
        this.showProcessing(`Updating ${eligibleIds.length} orders`, 'Applying changes in one secure batch...');
        if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }
        try {
            const selfFulfil = newStatus === 'Delivered' && fulfillmentType === 'Self Serving';
            if (selfFulfil) {
                if (this.userRole !== 'admin') throw new Error('Only an administrator can use Self Fulfilment.');
                const { error: fulfilmentError } = await supabaseClient.from('orders')
                    .update({ fulfillment_type: 'Self Serving', fulfilled_by_distributor_id: null })
                    .in('id', eligibleIds).eq('order_status', 'Draft');
                if (fulfilmentError) throw fulfilmentError;
            }
            const upd = { order_status: newStatus };
            if (newStatus === 'Delivered') {
                upd.delivery_date = deliveryDate || localDateValue();
                if (deliveryRemarks) upd.delivery_remarks = deliveryRemarks;
            }
            const { data, error } = await supabaseClient.from('orders').update(upd)
                .in('id', eligibleIds).eq('order_status', 'Draft').select('id');
            if (error) throw error;
            const updated = data?.length || 0;
            if (updated !== eligibleIds.length) throw new Error(`Only ${updated} of ${eligibleIds.length} Draft orders were updated. Refresh and try again.`);
            await this.finishProcessing(`${updated} orders updated`);
            this.showToast(`${updated} orders marked ${newStatus}.`, 'success');
            const selectAll = document.getElementById('selectAll');
            if (selectAll) selectAll.checked = false;
            await this.loadOrders();
        } catch (error) {
            console.error('Bulk update failed:', error);
            this.hideProcessing();
            this.showToast(`Bulk update failed: ${error.message || 'Unknown database error'}`, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Apply to Selected'; }
        }
    }

    async loadOrders() {
        const now = Date.now();
        if (this.loadingOrders || now - this.lastLoadAt < 700) return;
        this.loadingOrders = true;
        this.lastLoadAt = now;
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
                .order('created_at', { ascending: false })
                .limit(5000);

            if (this.userRole !== 'admin' && this.userRole !== 'nsm') {
                if (this.allowedDistributorIds.length > 0) {
                    query = query.in('distributor_id', this.allowedDistributorIds);
                } else {
                    if (loading) loading.style.display = 'none';
                    this.showEmptyState('No distributors assigned to your account.', 'fa-ban');
                    return;
                }
            }

            if (this.filters.distributors?.length && this.filters.distributors.length < this.distributorsList.length) {
                query = query.in('distributor_id', this.filters.distributors);
            } else if (this.filters.distributors && this.filters.distributors.length === 0) {
                this.ordersData = [];
                this.dataLoaded = true;
                this.applyFiltersAndRender();
                return;
            }

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
        } finally {
            this.loadingOrders = false;
        }
    }

    renderUserAvatar() {
        const avatar = document.getElementById('userAvatar');
        if (!avatar) return;
        const name = this.userAccess?.full_name || this.currentUser?.email || 'K95 User';
        const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'K9';
        avatar.textContent = initials;
        avatar.title = name;
        if (!this.userAccess?.avatar_url) return;
        try {
            const url = new URL(this.userAccess.avatar_url, window.location.origin);
            if (!['http:', 'https:'].includes(url.protocol)) return;
            const image = document.createElement('img');
            image.src = url.href;
            image.alt = `${name} profile photo`;
            image.referrerPolicy = 'no-referrer';
            image.onerror = () => { avatar.textContent = initials; };
            avatar.replaceChildren(image);
        } catch (error) { console.warn('Invalid profile photo URL:', error); }
    }

    applyFiltersAndRender() {
        const loading = document.getElementById('loading');
        if (loading) loading.style.display = 'none';

        const delayedCutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const isDelayed = o => ['Draft', 'Pending'].includes(o.order_status) && new Date(o.created_at).getTime() <= delayedCutoff;
        const counts = {
            draft_pending: this.ordersData.filter(o => ['Draft', 'Pending'].includes(o.order_status)).length,
            delivered: this.ordersData.filter(o => o.order_status === 'Delivered').length,
            cancelled: this.ordersData.filter(o => o.order_status === 'Cancelled').length,
            delayed: this.ordersData.filter(isDelayed).length
        };
        document.getElementById('kpiDraftPending').textContent = counts.draft_pending;
        document.getElementById('kpiDelivered').textContent = counts.delivered;
        document.getElementById('kpiCancelled').textContent = counts.cancelled;
        document.getElementById('kpiDelayed').textContent = counts.delayed;
        document.querySelectorAll('[data-kpi]').forEach(card => card.classList.toggle('active', card.dataset.kpi === this.activeKpi));

        const match = {
            draft_pending: o => ['Draft', 'Pending'].includes(o.order_status),
            delivered: o => o.order_status === 'Delivered',
            cancelled: o => o.order_status === 'Cancelled',
            delayed: isDelayed
        }[this.activeKpi] || (() => true);
        this.filteredOrders = this.ordersData.filter(match).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

        const sectionsEl = document.getElementById('orderSections');
        sectionsEl.innerHTML = '';

        const bulkBar    = document.getElementById('bulkBar');
        const totalCount = this.filteredOrders.length;

        if (totalCount === 0) {
            this.showEmptyState('No orders found for the selected filters.', 'fa-box-open');
            if (bulkBar) bulkBar.style.display = 'none';
            return;
        }

        if (bulkBar) bulkBar.style.display = 'flex';

        const effectivePageSize = this.pageSize === 0 ? Math.max(totalCount, 1) : this.pageSize;
        this.totalPages = Math.max(1, Math.ceil(totalCount / effectivePageSize));
        this.currentPage = Math.min(this.currentPage, this.totalPages);
        const start = (this.currentPage - 1) * effectivePageSize;
        const pageOrders = this.filteredOrders.slice(start, start + effectivePageSize);
        const labels = { draft_pending:'Draft / Pending Orders', delivered:'Delivered Orders', cancelled:'Cancelled Orders', delayed:'Delayed Orders (7+ days)' };
        sectionsEl.appendChild(this.renderSection({key:this.activeKpi,label:labels[this.activeKpi],icon:'fa-box',color:'#075bb8'}, pageOrders));
        const pager = document.getElementById('paginationBar');
        pager.style.display = 'flex';
        document.getElementById('pageInfo').textContent = `Page ${this.currentPage} of ${this.totalPages} · ${totalCount} orders`;
        document.getElementById('pagePrev').disabled = this.currentPage <= 1;
        document.getElementById('pageNext').disabled = this.currentPage >= this.totalPages;
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
        const pager = document.getElementById('paginationBar');
        if (pager) pager.style.display = 'none';
    }

renderOrderCard(order, container) {
    const card = document.createElement('div');
    card.className = 'order-card';
    card.dataset.id = order.id;
    card.dataset.status = order.order_status;

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
        ? `<div class="detail-item"><i class="fas fa-exchange-alt"></i> ${escapeHTML(fulfilledByName)}</div>` : '';

    // Delivery date & remarks (only for delivered orders)
    const deliveryDateHtml = order.delivery_date
        ? `<div class="detail-item"><i class="fas fa-truck"></i> ${formatDate(order.delivery_date)}</div>` : '';
    const remarksHtml = order.delivery_remarks
        ? `<div class="detail-item"><i class="fas fa-comment-alt"></i> ${escapeHTML(order.delivery_remarks)}</div>` : '';

    // Stock indicator (simplified)
    let stockHtml = '';
    if (order.fulfillment_type === 'Distributor' && !order.inventory_deducted && order.order_status === 'Draft') {
        stockHtml = `<span class="stock-badge na"><i class="fas fa-info-circle"></i> Stock verified on delivery</span>`;
    }

    card.innerHTML = `
        <div class="order-checkbox">
            <input type="checkbox" value="${order.id}" ${order.order_status === 'Draft' ? '' : 'disabled'} aria-label="Select draft order ${escapeHTML(order.order_number)}">
        </div>
        <div class="order-content">
            <div class="order-header-row">
                <div class="order-title">
                    <span class="order-number">#${escapeHTML(order.order_number)}</span>
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
                <div class="detail-item"><i class="fas fa-store"></i> ${escapeHTML(order.distributor?.distributor_name || order.distributor_id)}</div>
                <div class="detail-item"><i class="fas fa-map-marker-alt"></i> ${escapeHTML(order.outlet?.outlet_name || order.outlet_id)}</div>
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
            this.openSingleDeliveryPrompt(order, async (deliveryDate, deliveryRemarks, fulfilledById, fulfillmentType) => {
                statusSelect.disabled = true;
                try {
                    await this.updateOrderStatus(order.id, newStatus, deliveryDate, deliveryRemarks, fulfilledById, fulfillmentType);
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
        const today = localDateValue();

        // Build fulfillment distributor options
        let fulfilledByOptions = '<option value="">Same as Distributor</option>';
        this.distributorsList.forEach(d => {
            fulfilledByOptions += `<option value="${escapeHTML(d.distributor_id)}">${escapeHTML(d.distributor_name)}</option>`;
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
            ${order.fulfillment_type === 'Distributor' && !order.inventory_deducted ? `
            <div class="form-group">
                <label>Fulfilled By (if different)</label>
                <select id="singleFulfilledBy" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:12px;font-size:0.95rem;background:white;">
                    ${fulfilledByOptions}
                </select>
            </div>` : ''}
            ${this.userRole === 'admin' && !order.inventory_deducted ? `
            <div class="form-group">
                <label>Fulfilment type</label>
                <select id="singleFulfillmentType" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:12px;background:white;">
                    <option value="${escapeHTML(order.fulfillment_type || 'Distributor')}">Distributor inventory</option>
                    <option value="Self Serving">Self Fulfilment (no inventory deduction)</option>
                </select>
                <small style="display:block;margin-top:6px;color:#64748b">Use Self Fulfilment only when the order was supplied outside distributor inventory.</small>
            </div>` : ''}
        `;

        deliveryModal.classList.add('show');

        document.getElementById('deliveryConfirm').onclick = () => {
            const deliveryDate    = document.getElementById('singleDeliveryDate').value;
            const deliveryRemarks = document.getElementById('singleDeliveryRemarks').value.trim();
            const fulfilledById   = document.getElementById('singleFulfilledBy')?.value || null;
            const fulfillmentType = document.getElementById('singleFulfillmentType')?.value || order.fulfillment_type;
            deliveryModal.classList.remove('show');
            onConfirm(deliveryDate, deliveryRemarks, fulfilledById, fulfillmentType);
        };
        document.getElementById('deliveryCancel').onclick = () => {
            deliveryModal.classList.remove('show');
        };
    }

    // FIX #6, #8, #9, #7: updateOrderStatus now takes delivery details; preserves existing delivery_date
    async updateOrderStatus(orderId, newStatus, deliveryDate, deliveryRemarks, fulfilledById, fulfillmentType = null) {
        const order = this.ordersData.find(o => o.id === orderId);
        const upd = { order_status: newStatus };
        this.showProcessing(`Marking order ${newStatus}`, `Order #${order?.order_number || orderId}`);

        if (newStatus === 'Delivered') {
            // Only set/update delivery_date if explicitly provided
            if (deliveryDate) upd.delivery_date = deliveryDate;
            if (deliveryRemarks) upd.delivery_remarks = deliveryRemarks;
            // FIX #7: set fulfilled_by_distributor_id if provided
            if (fulfilledById && !order?.inventory_deducted) upd.fulfilled_by_distributor_id = fulfilledById;
            if (this.userRole === 'admin' && !order?.inventory_deducted && fulfillmentType === 'Self Serving') {
                const { error: fulfilmentError } = await supabaseClient.from('orders')
                    .update({ fulfillment_type: 'Self Serving', fulfilled_by_distributor_id: null })
                    .eq('id', orderId).eq('order_status', order.order_status);
                if (fulfilmentError) {
                    this.hideProcessing();
                    throw fulfilmentError;
                }
            }
        }
        // FIX #6: Do NOT null out delivery_date when changing non-delivery status
        // Only set it if new status is Delivered; otherwise leave existing column untouched

        try {
            const { error } = await supabaseClient.from('orders').update(upd).eq('id', orderId);
            if (error) throw error;
            await this.finishProcessing('Order updated successfully');
            this.showToast('Order updated successfully!', 'success');
            await this.loadOrders();
        } catch (error) {
            this.hideProcessing();
            throw error;
        }
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
            fulfilledByOptions += `<option value="${escapeHTML(d.distributor_id)}" ${sel}>${escapeHTML(d.distributor_name)}</option>`;
        });

        let html = `
            <div class="form-group">
                <label>Order: <strong>#${escapeHTML(order.order_number)}</strong></label>
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
                <input type="date" id="modalDeliveryDate" value="${order.delivery_date || localDateValue()}">
            </div>
            <div class="form-group" id="remarksGroup">
                <label>Delivery Remarks</label>
                <textarea id="modalDeliveryRemarks" placeholder="Optional remarks…">${order.delivery_remarks || ''}</textarea>
            </div>
            <div class="form-group" id="fulfilledByGroup" style="display:${order.fulfillment_type==='Distributor'&&!order.inventory_deducted?'block':'none'}">
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
                    <td>${escapeHTML(item.product_id)}</td>
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
            this.showProcessing('Saving order changes', `Order #${order.order_number}`);
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
                upd.delivery_date = deliveryDateEl?.value || localDateValue();
            }
            // delivery_remarks can be set regardless
            if (deliveryRemarks !== null) upd.delivery_remarks = deliveryRemarks;
            // FIX #7: fulfilled_by_distributor_id
            if (fulfilledById !== null && !order.inventory_deducted) upd.fulfilled_by_distributor_id = fulfilledById || null;

            // STEP 3 — Now update the order status (trigger fires here with correct item qtys)
            const { error: oe } = await supabaseClient.from('orders').update(upd).eq('id', order.id);
            if (oe) throw oe;

            this.showToast('Order updated successfully!', 'success');
            await this.finishProcessing('Order saved successfully');
            modal.classList.remove('show');
            this.loadOrders();
        } catch (err) {
            this.hideProcessing();
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

    showProcessing(title = 'Processing', detail = 'Please wait...') {
        const overlay = document.getElementById('processingOverlay');
        const card = overlay?.querySelector('.processing-card');
        if (!overlay || !card) return;
        card.classList.remove('success');
        card.querySelector('.processing-icon').innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        document.getElementById('processingTitle').textContent = title;
        document.getElementById('processingText').textContent = detail;
        overlay.classList.add('show');
    }

    async finishProcessing(title = 'Done') {
        const overlay = document.getElementById('processingOverlay');
        const card = overlay?.querySelector('.processing-card');
        if (!overlay || !card) return;
        card.classList.add('success');
        card.querySelector('.processing-icon').innerHTML = '<i class="fas fa-check"></i>';
        document.getElementById('processingTitle').textContent = title;
        document.getElementById('processingText').textContent = 'Done';
        await this.sleep(700);
        this.hideProcessing();
    }

    hideProcessing() { document.getElementById('processingOverlay')?.classList.remove('show'); }
}

// ============================================
// START
// ============================================
const app = new OrderReconciliation();
window.app = app;
