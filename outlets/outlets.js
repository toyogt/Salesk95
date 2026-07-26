// ============================================
// K95 FOODS - OUTLET MANAGEMENT DASHBOARD v4.20
// ============================================
console.log('✅ outlets.js loaded (v4.20)');

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
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
        global: {
            fetch: async (url, options) => {
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
                return fetch(proxyUrl.toString(), options);
            }
        }
    });
}

// ============================================
// CHECKBOX DROPDOWN — position:fixed, appended to body
// ============================================
class CheckboxDropdown {
    constructor(containerId, options, opts = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;
        this.options = options;
        this.selected = new Set();
        this.placeholder = opts.placeholder || 'Select...';
        this.showSelectAll = opts.showSelectAll !== false;
        this.showSearch = opts.showSearch || false;
        this.onChangeCallback = opts.onChangeCallback || null;
        this.render();
        this.bindEvents();
    }

    render() {
        this.container.innerHTML = '';
        this.container.classList.add('checkbox-dropdown');

        this.trigger = document.createElement('div');
        this.trigger.className = 'checkbox-dropdown-trigger';
        this.trigger.innerHTML = `<span class="selected-text">${this.placeholder}</span><i class="fas fa-chevron-down dd-arrow"></i>`;
        this.container.appendChild(this.trigger);

        this.list = document.createElement('div');
        this.list.className = 'checkbox-dropdown-list';

        if (this.showSearch) {
            const sd = document.createElement('div');
            sd.className = 'dd-search';
            sd.innerHTML = '<input type="text" placeholder="Search...">';
            this.list.appendChild(sd);
            this.searchInput = sd.querySelector('input');
        }
        if (this.showSelectAll) {
            const ai = document.createElement('div');
            ai.className = 'dd-item select-all';
            ai.innerHTML = '<input type="checkbox" data-value="__all__"> Select All';
            this.list.appendChild(ai);
        }
        this.options.forEach(opt => {
            const item = document.createElement('div');
            item.className = 'dd-item';
            item.innerHTML = `<input type="checkbox" data-value="${opt.value}"> ${opt.label}`;
            this.list.appendChild(item);
        });

        document.body.appendChild(this.list);
    }

    positionList() {
        const rect = this.trigger.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const top = spaceBelow >= 240 ? rect.bottom + 2 : rect.top - 240 - 2;
        this.list.style.top = Math.max(4, top) + 'px';
        this.list.style.left = rect.left + 'px';
        this.list.style.width = Math.max(rect.width, 220) + 'px';
    }

    bindEvents() {
        this.trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.checkbox-dropdown-list.open').forEach(el => {
                if (el !== this.list) el.classList.remove('open');
            });
            this.positionList();
            this.list.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target) && !this.list.contains(e.target))
                this.list.classList.remove('open');
        });
        window.addEventListener('scroll', () => { if (this.list.classList.contains('open')) this.positionList(); }, true);

        this.list.querySelectorAll('.dd-item').forEach(item => {
            const cb = item.querySelector('input[type="checkbox"]');
            item.addEventListener('click', (e) => {
                if (e.target !== cb) cb.checked = !cb.checked;
                if (cb.dataset.value === '__all__') {
                    this.handleSelectAll(cb.checked);
                } else {
                    if (cb.checked) this.selected.add(cb.dataset.value);
                    else this.selected.delete(cb.dataset.value);
                    this.updateSelectAllState();
                }
                this.updateTriggerText();
                if (this.onChangeCallback) this.onChangeCallback(this.getSelected());
            });
        });

        if (this.searchInput) {
            this.searchInput.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();
                this.list.querySelectorAll('.dd-item:not(.select-all)').forEach(item => {
                    item.style.display = item.textContent.toLowerCase().includes(term) ? '' : 'none';
                });
            });
            this.searchInput.addEventListener('click', (e) => e.stopPropagation());
        }
    }

    handleSelectAll(checked) {
        this.list.querySelectorAll('.dd-item:not(.select-all) input[type="checkbox"]').forEach(cb => {
            if (cb.closest('.dd-item').style.display !== 'none') {
                cb.checked = checked;
                if (checked) this.selected.add(cb.dataset.value);
                else this.selected.delete(cb.dataset.value);
            }
        });
    }
    updateSelectAllState() {
        const allCb = this.list.querySelector('.select-all input');
        if (!allCb) return;
        allCb.checked = Array.from(this.list.querySelectorAll('.dd-item:not(.select-all) input[type="checkbox"]')).every(cb => cb.checked);
    }
    updateTriggerText() {
        const el = this.trigger.querySelector('.selected-text');
        if (this.selected.size === 0) el.textContent = this.placeholder;
        else if (this.selected.size === this.options.length) el.textContent = 'All selected';
        else if (this.selected.size <= 2) el.textContent = this.options.filter(o => this.selected.has(o.value)).map(o => o.label).join(', ');
        else el.textContent = `${this.selected.size} selected`;
    }
    getSelected() { return Array.from(this.selected); }
    setSelected(values) {
        this.selected = new Set(values);
        this.list.querySelectorAll('.dd-item:not(.select-all) input[type="checkbox"]').forEach(cb => {
            cb.checked = this.selected.has(cb.dataset.value);
        });
        this.updateSelectAllState();
        this.updateTriggerText();
    }
    destroy() {
        if (this.list && this.list.parentNode) this.list.parentNode.removeChild(this.list);
    }
}

// ============================================
// MAIN APPLICATION
// ============================================
class OutletManager {
    constructor() {
        this.CACHE = { USER: 'k95_user', EMAIL: 'k95_last_email' };
        this.currentUser = null;
        this.userRole = null;
        this.allowedDistributorIds = [];
        this.distributorsList = [];
        this.createdByEmails = [];
        this.listenersAttached = false;

        this.outletData = [];
        this.filteredOutletData = [];
        this.visitsData = [];
        this.filteredVisitsData = [];
        this.nonBuyersData = [];
        this.filteredNonBuyersData = [];

        this.dataLoaded = { outlets: false, visits: false, nonbuyers: false };

        this.filters = {
            outlets: { distributors: [], outletType: '', visitDay: '', colours: ['green', 'yellow', 'red'], sortBy: 'name', sortOrder: 'asc' },
            visits: { distributors: [], createdByEmail: '', dateFilterType: 'month', fromDate: '', toDate: '', orderStatusFilter: 'all', sortBy: 'visit_date', sortOrder: 'desc' },
            nonbuyers: { distributors: [], fromDate: '', toDate: '', sortBy: 'outlet_name', sortOrder: 'asc' }
        };

        this.columnDefs = {
            outlets: [
                { id: 'sn', label: 'S.No' },
                { id: 'distributor_id', label: 'Distributor ID' },
                { id: 'outlet_name', label: 'Outlet Name' },
                { id: 'outlet_type', label: 'Type' },
                { id: 'visit_day', label: 'Visit Day' },
                { id: 'status', label: 'Status' },
                { id: 'location_url', label: 'Map' },
                { id: 'last_visit_date', label: 'Last Visit' },
                { id: 'last_order_date', label: 'Last Order' },
                { id: 'last_order_value', label: 'Order Value', hidden: true },
                { id: 'visit_count', label: 'Visit Count' }
            ],
            visits: [
                { id: 'sn', label: 'S.No' },
                { id: 'distributor_id', label: 'Distributor' },
                { id: 'outlet_name', label: 'Outlet' },
                { id: 'visit_type', label: 'Type' },
                { id: 'visit_day', label: 'Visit Day' },
                { id: 'notes', label: 'Notes' },
                { id: 'order_created', label: 'Order Created' },
                { id: 'location_map_url', label: 'Map' },
                { id: 'visit_date', label: 'Visit Date' },
                { id: 'visit_count', label: 'Visit Count' },
                { id: 'created_by_email', label: 'Created By' }
            ],
            nonbuyers: [
                { id: 'sn', label: 'S.No' },
                { id: 'distributor_id', label: 'Distributor' },
                { id: 'outlet_name', label: 'Outlet' },
                { id: 'visit_day', label: 'Visit Day' },
                { id: 'report_month', label: 'Report Month', hidden: true },
                { id: 'last_order_date', label: 'Last Order' },
                { id: 'last_visit_date', label: 'Last Visit' },
                { id: 'last_order_value', label: 'Last Order Value', hidden: true },
                { id: 'visit_count', label: 'Visit Count' },
                { id: 'remarks', label: 'Remarks', hidden: true }
            ]
        };

        this.currentTab = 'outlets';
        this.pagination = {
            outlets: { page: 1, size: 50, options: [50, 100, 500, 1000] },
            visits: { page: 1, size: 50, options: [50, 100, 150] },
            nonbuyers: { page: 1, size: 50, options: [50, 100, 150] }
        };
        this.dropdowns = {};
        this.init();
    }

    // ===== INIT =====
    async init() {
        if (!supabaseAvailable || !supabaseClient) { alert('Supabase not available.'); return; }
        try {
            const savedUser = localStorage.getItem(this.CACHE.USER);
            if (savedUser) {
                const userData = JSON.parse(savedUser);
                this.currentUser = { email: userData.email };
                document.getElementById('userEmail').textContent = userData.email;
                // Go straight to dashboard — no login card flash
                document.getElementById('dashboard').style.display = 'block';
                await this.loadDistributorsFromEmail(userData.email, true);
            } else {
                document.getElementById('loginCard').style.display = 'block';
                const lastEmail = localStorage.getItem(this.CACHE.EMAIL);
                if (lastEmail) document.getElementById('email').value = lastEmail;
            }
        } catch (err) {
            console.error(err);
            document.getElementById('loginCard').style.display = 'block';
        }
    }

    async handleLoadDistributors() {
        const email = document.getElementById('email').value.trim();
        if (!email) return this.showMessage('Please enter email', 'error', 'loginMessage');
        await this.loadDistributorsFromEmail(email, false);
    }

    async loadDistributorsFromEmail(email, silent = false) {
        try {
            const { data: access, error: accessError } = await supabaseClient
                .from('access_manager').select('role_name, distributor_ids')
                .eq('user_email', email).maybeSingle();
            if (accessError) throw accessError;
            if (!access) {
                if (!silent) this.showMessage('No access record found for this email.', 'error', 'loginMessage');
                document.getElementById('loginCard').style.display = 'block';
                document.getElementById('dashboard').style.display = 'none';
                return;
            }

            this.userRole = access.role_name || 'user';
            this.allowedDistributorIds = access.distributor_ids || [];

            let query = supabaseClient.from('distributors').select('distributor_id, distributor_name')
                .eq('status', 'Active').order('distributor_name');
            if (this.userRole !== 'admin' && this.userRole !== 'nsm' && this.allowedDistributorIds.length)
                query = query.in('distributor_id', this.allowedDistributorIds);

            const { data: distributors, error: distError } = await query;
            if (distError) throw distError;
            if (!distributors || !distributors.length) {
                if (!silent) this.showMessage('No distributors assigned.', 'error', 'loginMessage');
                document.getElementById('loginCard').style.display = 'block';
                document.getElementById('dashboard').style.display = 'none';
                return;
            }

            this.distributorsList = distributors;
            this.currentUser = { email };
            localStorage.setItem(this.CACHE.EMAIL, email);
            localStorage.setItem(this.CACHE.USER, JSON.stringify({ email, distributors: distributors.map(d => d.distributor_id) }));

            document.getElementById('userEmail').textContent = email;
            document.getElementById('loginCard').style.display = 'none';
            document.getElementById('dashboard').style.display = 'block';

            await this.loadCreatedByEmails();
            if (!this.listenersAttached) { this.setupEventListeners(); this.listenersAttached = true; }
            this.buildFilterPanel();
            this.updateLegend();
        } catch (e) {
            console.error('Login error:', e);
            if (!silent) this.showMessage('Error: ' + e.message, 'error', 'loginMessage');
            document.getElementById('loginCard').style.display = 'block';
            document.getElementById('dashboard').style.display = 'none';
        }
    }

    async loadCreatedByEmails() {
        try {
            let q = supabaseClient.from('visits').select('created_by_email');
            q = this.applyDistributorFilter(q);
            const { data } = await q;
            const s = new Set();
            if (data) data.forEach(v => { if (v.created_by_email) s.add(v.created_by_email); });
            this.createdByEmails = Array.from(s).sort();
        } catch (e) { this.createdByEmails = []; }
    }

    applyDistributorFilter(query, field = 'distributor_id') {
        if (this.allowedDistributorIds.length && this.userRole !== 'admin' && this.userRole !== 'nsm')
            return query.in(field, this.allowedDistributorIds);
        return query;
    }

    // ===== FILE NAMING: "PageName-DistID-DateTime" =====
    getExportFilename(ext) {
        const pageNames = { outlets: 'Outlets', visits: 'Visits', nonbuyers: 'NonBuyers' };
        const pageName = pageNames[this.currentTab] || this.currentTab;
        const distIds = this.filters[this.currentTab]?.distributors || [];
        const distPart = distIds.length === 1 ? distIds[0] : distIds.length > 1 ? `${distIds.length}Dist` : 'All';
        const now = new Date();
        const datePart = now.toISOString().replace(/[-:T]/g, '').substring(0, 14);
        return `${pageName}-${distPart}-${datePart}.${ext}`;
    }

    // ===== OUTLETS =====
    async loadAllOutlets() {
        try {
            const now = new Date();
            const year = now.getFullYear(), month = String(now.getMonth() + 1).padStart(2, '0');
            const monthStart = `${year}-${month}-01`;
            const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
            const monthEnd = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

            let query = supabaseClient.from('outlets')
                .select(`*, visits!left(visit_date, order_created), orders!left(created_at, order_status, order_items(rate, qty))`)
                .eq('status', 'Active');
            query = this.applyDistributorFilter(query);
            const { data, error } = await query;
            if (error) { console.error('Error loading outlets:', error); return; }

            let vq = supabaseClient.from('visits').select('outlet_id, visit_date')
                .gte('visit_date', monthStart).lte('visit_date', monthEnd);
            vq = this.applyDistributorFilter(vq);
            const { data: monthVisits } = await vq;
            const visitCountMap = new Map();
            if (monthVisits) monthVisits.forEach(v => visitCountMap.set(v.outlet_id, (visitCountMap.get(v.outlet_id) || 0) + 1));

            this.outletData = data.map(outlet => {
                const visitsM = outlet.visits?.filter(v => v.visit_date >= monthStart && v.visit_date <= monthEnd) || [];
                const ordersM = outlet.orders?.filter(o => {
                    const d = o.created_at.split('T')[0];
                    return d >= monthStart && d <= monthEnd && !['Draft', 'Cancelled'].includes(o.order_status);
                }) || [];
                const hasVisit = visitsM.length > 0, hasOrder = ordersM.length > 0;
                const colourClass = hasOrder ? 'row-green' : hasVisit ? 'row-yellow' : 'row-red';
                const lastVisit = outlet.visits?.sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date))[0];
                const lastOrder = outlet.orders?.filter(o => !['Draft', 'Cancelled'].includes(o.order_status))
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
                const lastOrderValue = lastOrder ? lastOrder.order_items.reduce((s, i) => s + i.rate * i.qty, 0) : 0;
                return {
                    ...outlet, hasVisit, hasOrder, colourClass,
                    last_visit_date: lastVisit?.visit_date || null,
                    last_order_date: lastOrder ? lastOrder.created_at.split('T')[0] : null,
                    last_order_value: lastOrderValue,
                    visit_count: visitCountMap.get(outlet.outlet_id) || 0
                };
            });
            this.dataLoaded.outlets = true;
            this.applyOutletFilters();
        } catch (error) { console.error('Error in loadAllOutlets:', error); }
    }

    applyOutletFilters() {
        let filtered = this.outletData;
        const f = this.filters.outlets;
        if (f.distributors.length) filtered = filtered.filter(o => f.distributors.includes(o.distributor_id));
        if (f.outletType) filtered = filtered.filter(o => o.outlet_type === f.outletType);
        if (f.visitDay) filtered = filtered.filter(o => o.visit_day === f.visitDay);
        if (f.colours.length) filtered = filtered.filter(o => f.colours.includes(o.colourClass.replace('row-', '')));

        const dayOrder = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7, Flexible: 8 };
        filtered.sort((a, b) => {
            let aV, bV;
            switch (f.sortBy) {
                case 'name': aV = (a.outlet_name || '').toLowerCase(); bV = (b.outlet_name || '').toLowerCase(); break;
                case 'date': aV = a.last_visit_date || ''; bV = b.last_visit_date || ''; break;
                case 'visit': aV = a.visit_count || 0; bV = b.visit_count || 0; break;
                case 'orderValue': aV = a.last_order_value || 0; bV = b.last_order_value || 0; break;
                case 'visitDay': aV = dayOrder[a.visit_day] || 99; bV = dayOrder[b.visit_day] || 99; break;
                default: aV = (a.outlet_name || '').toLowerCase(); bV = (b.outlet_name || '').toLowerCase();
            }
            return f.sortOrder === 'asc' ? (aV > bV ? 1 : aV < bV ? -1 : 0) : (aV < bV ? 1 : aV > bV ? -1 : 0);
        });

        this.filteredOutletData = filtered;
        this.pagination.outlets.page = 1;
        document.getElementById('outletsPlaceholder').style.display = 'none';
        document.getElementById('outletsTableWrapper').style.display = '';
        this.renderOutletTable();
    }

    renderOutletTable() {
        const thead = document.getElementById('outletsHeader'), tbody = document.getElementById('outletsBody');
        thead.innerHTML = '<tr>' + this.columnDefs.outlets.filter(c => !c.hidden).map(c => `<th>${c.label}</th>`).join('') + '</tr>';
        const pag = this.pagination.outlets;
        if (!this.filteredOutletData.length) {
            tbody.innerHTML = '<tr><td colspan="100" style="text-align:center;padding:20px;">No outlets match filters.</td></tr>';
            document.getElementById('outletsPagination').style.display = 'none'; return;
        }
        const start = (pag.page - 1) * pag.size;
        const pageData = this.filteredOutletData.slice(start, start + pag.size);
        tbody.innerHTML = pageData.map((o, idx) => {
            let cells = '';
            this.columnDefs.outlets.forEach(col => {
                if (col.hidden) return;
                let val = col.id === 'sn' ? start + idx + 1 : o[col.id];
                if (col.id === 'status') val = 'Active';
                if (col.id === 'last_order_value' && val) val = '₹' + val.toLocaleString();
                if (col.id === 'location_url') {
                    const url = o.location_url || o.location;
                    val = url && url.startsWith('http') ? `<a href="${url}" target="_blank" class="map-link">🗺️</a>` : '—';
                }
                cells += `<td>${val || '—'}</td>`;
            });
            return `<tr class="${o.colourClass}">${cells}</tr>`;
        }).join('');
        this.renderPaginationFor('outlets', this.filteredOutletData.length);
    }

    // ===== VISITS =====
    async loadAllVisits() {
        try {
            const dd = new Date(); dd.setMonth(dd.getMonth() - 3);
            const defaultFrom = dd.toISOString().split('T')[0];
            let query = supabaseClient.from('visits').select(`*, outlets(outlet_name, visit_day)`)
                .gte('visit_date', defaultFrom).order('visit_date', { ascending: false });
            query = this.applyDistributorFilter(query);
            const { data: visits, error } = await query;
            if (error) throw error;
            if (!visits || !visits.length) { this.visitsData = []; this.dataLoaded.visits = true; this.applyVisitsFilters(); return; }

            let oq = supabaseClient.from('orders').select('outlet_id, created_at')
                .gte('created_at', defaultFrom + 'T00:00:00').not('order_status', 'in', '("Draft","Cancelled")');
            oq = this.applyDistributorFilter(oq, 'distributor_id');
            const { data: orders } = await oq;
            const orderKeySet = new Set();
            if (orders) orders.forEach(o => orderKeySet.add(`${o.outlet_id}|${o.created_at.split('T')[0]}`));

            const vcMap = new Map();
            visits.forEach(v => {
                const ym = v.visit_date.substring(0, 7);
                const k = v.outlet_id ? `${v.outlet_id}|${ym}` : `new:${v.new_outlet_name || '?'}|${ym}`;
                vcMap.set(k, (vcMap.get(k) || 0) + 1);
            });

            this.visitsData = visits.map(v => {
                const vd = v.visit_date.split('T')[0], ym = vd.substring(0, 7);
                const oe = v.outlet_id ? orderKeySet.has(`${v.outlet_id}|${vd}`) : false;
                const k = v.outlet_id ? `${v.outlet_id}|${ym}` : `new:${v.new_outlet_name || '?'}|${ym}`;
                return { ...v, order_created: v.order_created || oe, visit_count: vcMap.get(k) || 0, visit_day: v.outlets?.visit_day || '—' };
            });
            this.dataLoaded.visits = true;
            this.applyVisitsFilters();
        } catch (error) {
            console.error('Error in loadAllVisits:', error);
            this.visitsData = []; this.dataLoaded.visits = true; this.applyVisitsFilters();
        }
    }

    applyVisitsFilters() {
        let filtered = this.visitsData;
        const f = this.filters.visits;
        if (f.distributors.length) filtered = filtered.filter(v => f.distributors.includes(v.distributor_id));
        if (f.createdByEmail) {
            const t = f.createdByEmail.toLowerCase();
            filtered = filtered.filter(v => (v.created_by_email || '').toLowerCase().includes(t));
        }
        const today = new Date(), todayStr = today.toISOString().split('T')[0];
        const curYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        if (f.dateFilterType === 'today') filtered = filtered.filter(v => v.visit_date === todayStr);
        else if (f.dateFilterType === 'month') filtered = filtered.filter(v => v.visit_date.startsWith(curYM));
        else if (f.dateFilterType === 'custom' && f.fromDate && f.toDate) filtered = filtered.filter(v => v.visit_date >= f.fromDate && v.visit_date <= f.toDate);
        if (f.orderStatusFilter === 'yes') filtered = filtered.filter(v => v.order_created);
        else if (f.orderStatusFilter === 'no') filtered = filtered.filter(v => !v.order_created);

        // Sort
        const dayOrder = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7, Flexible: 8 };
        filtered.sort((a, b) => {
            let aV, bV;
            switch (f.sortBy) {
                case 'visit_date': aV = a.visit_date || ''; bV = b.visit_date || ''; break;
                case 'visit_day': aV = dayOrder[a.visit_day] || 99; bV = dayOrder[b.visit_day] || 99; break;
                default: aV = a.visit_date || ''; bV = b.visit_date || '';
            }
            return f.sortOrder === 'asc' ? (aV > bV ? 1 : aV < bV ? -1 : 0) : (aV < bV ? 1 : aV > bV ? -1 : 0);
        });

        this.filteredVisitsData = filtered;
        this.pagination.visits.page = 1;
        document.getElementById('visitsPlaceholder').style.display = 'none';
        document.getElementById('visitsTableWrapper').style.display = '';
        this.renderVisitsTable();
    }

    renderVisitsTable() {
        const thead = document.getElementById('visitsHeader'), tbody = document.getElementById('visitsBody');
        thead.innerHTML = '<tr>' + this.columnDefs.visits.filter(c => !c.hidden).map(c => `<th>${c.label}</th>`).join('') + '</tr>';
        const pag = this.pagination.visits;
        if (!this.filteredVisitsData.length) {
            tbody.innerHTML = '<tr><td colspan="100" style="text-align:center;padding:20px;">No visits found.</td></tr>';
            document.getElementById('visitsPagination').style.display = 'none'; return;
        }
        const start = (pag.page - 1) * pag.size;
        const pageData = this.filteredVisitsData.slice(start, start + pag.size);
        tbody.innerHTML = pageData.map((v, idx) => {
            let cells = '';
            this.columnDefs.visits.forEach(col => {
                if (col.hidden) return;
                let val = col.id === 'sn' ? start + idx + 1 : v[col.id];
                if (col.id === 'outlet_name') val = v.outlets?.outlet_name || v.new_outlet_name || v.outlet_id || '—';
                if (col.id === 'visit_day') val = v.outlets?.visit_day || v.visit_day || '—';
                if (col.id === 'order_created') val = v.order_created ? 'Yes' : 'No';
                if (col.id === 'visit_date') {
                    const ts = v.created_at || v.updated_at;
                    val = ts ? new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
                }
                if (col.id === 'location_map_url' && val && val !== '—') val = `<a href="${val}" target="_blank" class="map-link">🗺️</a>`;
                cells += `<td>${val || '—'}</td>`;
            });
            return `<tr class="${v.order_created ? 'row-green' : 'row-red'}">${cells}</tr>`;
        }).join('');
        this.renderPaginationFor('visits', this.filteredVisitsData.length);
    }

    // ===== NON-BUYERS =====
    async loadNonBuyers() {
        try {
            const now = new Date();
            const year = now.getFullYear(), month = String(now.getMonth() + 1).padStart(2, '0');
            const monthStart = `${year}-${month}-01`;
            const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
            const monthEnd = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

            let query = supabaseClient.from('non_buyers')
                .select(`*, outlets(outlet_name, visit_day)`)
                .eq('report_month', monthStart).order('outlet_id');
            query = this.applyDistributorFilter(query, 'distributor_id');
            const { data, error } = await query;
            if (error) throw error;
            if (!data || !data.length) {
                this.nonBuyersData = []; this.filteredNonBuyersData = [];
                this.dataLoaded.nonbuyers = true;
                document.getElementById('nonbuyersPlaceholder').style.display = 'none';
                document.getElementById('nonbuyersTableWrapper').style.display = '';
                this.renderNonBuyersTable(); return;
            }

            const outletIds = new Set(data.map(nb => nb.outlet_id));

            let vq = supabaseClient.from('visits').select('outlet_id, visit_date')
                .gte('visit_date', monthStart).lte('visit_date', monthEnd);
            vq = this.applyDistributorFilter(vq, 'distributor_id');
            const { data: allVisits } = await vq;
            const vcMap = new Map(), lvMap = new Map();
            if (allVisits) allVisits.forEach(v => {
                if (outletIds.has(v.outlet_id)) {
                    vcMap.set(v.outlet_id, (vcMap.get(v.outlet_id) || 0) + 1);
                    if (!lvMap.has(v.outlet_id) || v.visit_date > lvMap.get(v.outlet_id)) lvMap.set(v.outlet_id, v.visit_date);
                }
            });

            let oq = supabaseClient.from('orders').select('outlet_id, order_items(rate, qty)')
                .gte('created_at', monthStart + 'T00:00:00').lte('created_at', monthEnd + 'T23:59:59')
                .not('order_status', 'in', '("Draft","Cancelled")');
            oq = this.applyDistributorFilter(oq, 'distributor_id');
            const { data: allOrders } = await oq;
            const ovMap = new Map();
            if (allOrders) allOrders.forEach(o => {
                if (outletIds.has(o.outlet_id)) {
                    const t = o.order_items?.reduce((s, i) => s + i.rate * i.qty, 0) || 0;
                    ovMap.set(o.outlet_id, (ovMap.get(o.outlet_id) || 0) + t);
                }
            });

            this.nonBuyersData = data.map(nb => {
                const hasVisit = (vcMap.get(nb.outlet_id) || 0) > 0;
                return {
                    id: nb.id, distributor_id: nb.distributor_id, outlet_id: nb.outlet_id,
                    outlet_name: nb.outlets?.outlet_name || nb.outlet_name || nb.outlet_id,
                    visit_day: nb.outlets?.visit_day || '—',
                    report_month: nb.report_month,
                    last_order_date: nb.last_order_date ? nb.last_order_date.split('T')[0] : '—',
                    last_visit_date: lvMap.get(nb.outlet_id) || '—',
                    last_order_value: ovMap.get(nb.outlet_id) || 0,
                    visit_count: vcMap.get(nb.outlet_id) || 0,
                    colourClass: hasVisit ? 'row-yellow' : 'row-red',
                    remarks: nb.remarks || ''
                };
            });
            this.dataLoaded.nonbuyers = true;
            this.applyNonBuyersFilters();
        } catch (error) {
            console.error('Error in loadNonBuyers:', error);
            this.nonBuyersData = []; this.filteredNonBuyersData = [];
            this.dataLoaded.nonbuyers = true; this.renderNonBuyersTable();
        }
    }

    applyNonBuyersFilters() {
        let filtered = this.nonBuyersData;
        const f = this.filters.nonbuyers;
        if (f.distributors.length) filtered = filtered.filter(nb => f.distributors.includes(nb.distributor_id));
        if (f.fromDate && f.toDate) filtered = filtered.filter(nb => nb.last_visit_date !== '—' && nb.last_visit_date >= f.fromDate && nb.last_visit_date <= f.toDate);

        const dayOrder = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7, Flexible: 8 };
        filtered.sort((a, b) => {
            let aV, bV;
            switch (f.sortBy) {
                case 'outlet_name': aV = (a.outlet_name || '').toLowerCase(); bV = (b.outlet_name || '').toLowerCase(); break;
                case 'visit_day': aV = dayOrder[a.visit_day] || 99; bV = dayOrder[b.visit_day] || 99; break;
                case 'last_visit_date': aV = a.last_visit_date || ''; bV = b.last_visit_date || ''; break;
                case 'visit_count': aV = a.visit_count || 0; bV = b.visit_count || 0; break;
                default: aV = (a.outlet_name || '').toLowerCase(); bV = (b.outlet_name || '').toLowerCase();
            }
            return f.sortOrder === 'asc' ? (aV > bV ? 1 : aV < bV ? -1 : 0) : (aV < bV ? 1 : aV > bV ? -1 : 0);
        });

        this.filteredNonBuyersData = filtered;
        this.pagination.nonbuyers.page = 1;
        document.getElementById('nonbuyersPlaceholder').style.display = 'none';
        document.getElementById('nonbuyersTableWrapper').style.display = '';
        this.renderNonBuyersTable();
    }

    renderNonBuyersTable() {
        const thead = document.getElementById('nonbuyersHeader'), tbody = document.getElementById('nonbuyersBody');
        const visibleCols = this.columnDefs.nonbuyers.filter(c => !c.hidden);
        thead.innerHTML = '<tr>' + visibleCols.map(c => `<th>${c.label}</th>`).join('') + '</tr>';

        const showRemarks = visibleCols.some(c => c.id === 'remarks');
        const bulkBar = document.getElementById('nonbuyersBulkSave');
        if (bulkBar) bulkBar.style.display = showRemarks && this.filteredNonBuyersData.length ? '' : 'none';

        const pag = this.pagination.nonbuyers;
        if (!this.filteredNonBuyersData.length) {
            tbody.innerHTML = '<tr><td colspan="100" style="text-align:center;padding:20px;">No non‑buyers this month.</td></tr>';
            document.getElementById('nonbuyersPagination').style.display = 'none'; return;
        }
        const start = (pag.page - 1) * pag.size;
        const pageData = this.filteredNonBuyersData.slice(start, start + pag.size);

        tbody.innerHTML = pageData.map((nb, idx) => {
            let cells = '';
            visibleCols.forEach(col => {
                if (col.id === 'sn') { cells += `<td>${start + idx + 1}</td>`; return; }
                if (col.id === 'remarks') {
                    const ev = (nb.remarks || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                    cells += `<td><input type="text" class="remarks-input" value="${ev}" data-nb-id="${nb.id}" placeholder="Add remark..."></td>`;
                    return;
                }
                let val = nb[col.id];
                if (col.id === 'last_order_value' && val) val = '₹' + val.toLocaleString();
                cells += `<td>${val || '—'}</td>`;
            });
            return `<tr class="${nb.colourClass || ''}">${cells}</tr>`;
        }).join('');
        this.renderPaginationFor('nonbuyers', this.filteredNonBuyersData.length);
    }

    async bulkSaveRemarks() {
        const inputs = document.querySelectorAll('#nonbuyersBody .remarks-input');
        const btn = document.getElementById('bulkSaveRemarksBtn');
        const status = document.getElementById('bulkSaveStatus');
        if (!inputs.length) return;

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        status.textContent = '';
        let saved = 0, errors = 0;

        for (const input of inputs) {
            const nbId = parseInt(input.dataset.nbId);
            const newVal = input.value.trim();
            const nbItem = this.nonBuyersData.find(n => n.id === nbId);
            // Only save if value actually changed
            if (nbItem && nbItem.remarks === newVal) continue;

            try {
                const { error } = await supabaseClient.from('non_buyers').update({ remarks: newVal }).eq('id', nbId);
                if (error) throw error;
                if (nbItem) nbItem.remarks = newVal;
                const fi = this.filteredNonBuyersData.find(n => n.id === nbId);
                if (fi) fi.remarks = newVal;
                saved++;
            } catch (e) {
                console.error('Error saving remark for id', nbId, e);
                errors++;
            }
        }

        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Save All Remarks';
        if (errors === 0) {
            status.style.color = '#16a34a';
            status.textContent = saved > 0 ? `✓ ${saved} remark(s) saved` : '✓ No changes to save';
        } else {
            status.style.color = '#dc2626';
            status.textContent = `${saved} saved, ${errors} failed`;
        }
        setTimeout(() => { status.textContent = ''; }, 3000);
    }

    // ===== PAGINATION =====
    renderPaginationFor(tab, totalItems) {
        const pag = this.pagination[tab];
        const tp = Math.ceil(totalItems / pag.size) || 1;
        if (pag.page > tp) pag.page = tp;
        const div = document.getElementById(`${tab}Pagination`);
        if (!div) return;
        if (totalItems === 0) { div.style.display = 'none'; return; }
        div.style.display = 'flex';
        const s = (pag.page - 1) * pag.size + 1, e = Math.min(pag.page * pag.size, totalItems);
        div.innerHTML = `
            <div class="pagination-info">${s}–${e} of ${totalItems}</div>
            <div class="pagination-controls">
                <button class="btn-pagination" onclick="app.paginate('${tab}',1)" ${pag.page === 1 ? 'disabled' : ''}><i class="fas fa-angle-double-left"></i></button>
                <button class="btn-pagination" onclick="app.paginate('${tab}',${pag.page - 1})" ${pag.page === 1 ? 'disabled' : ''}><i class="fas fa-angle-left"></i></button>
                <span class="page-number">${pag.page}/${tp}</span>
                <button class="btn-pagination" onclick="app.paginate('${tab}',${pag.page + 1})" ${pag.page === tp ? 'disabled' : ''}><i class="fas fa-angle-right"></i></button>
                <button class="btn-pagination" onclick="app.paginate('${tab}',${tp})" ${pag.page === tp ? 'disabled' : ''}><i class="fas fa-angle-double-right"></i></button>
            </div>
            <div class="pagination-size">
                <select onchange="app.changePageSizeFor('${tab}',this.value)">
                    ${pag.options.map(o => `<option value="${o}" ${o === pag.size ? 'selected' : ''}>${o} rows</option>`).join('')}
                    <option value="all" ${pag.size >= totalItems ? 'selected' : ''}>All</option>
                </select>
            </div>`;
    }
    paginate(tab, page) {
        const pag = this.pagination[tab];
        const total = tab === 'outlets' ? this.filteredOutletData.length : tab === 'visits' ? this.filteredVisitsData.length : this.filteredNonBuyersData.length;
        pag.page = Math.max(1, Math.min(page, Math.ceil(total / pag.size) || 1));
        if (tab === 'outlets') this.renderOutletTable();
        else if (tab === 'visits') this.renderVisitsTable();
        else this.renderNonBuyersTable();
    }
    changePageSizeFor(tab, size) {
        const pag = this.pagination[tab];
        const total = tab === 'outlets' ? this.filteredOutletData.length : tab === 'visits' ? this.filteredVisitsData.length : this.filteredNonBuyersData.length;
        pag.size = size === 'all' ? total : parseInt(size, 10);
        pag.page = 1;
        if (tab === 'outlets') this.renderOutletTable();
        else if (tab === 'visits') this.renderVisitsTable();
        else this.renderNonBuyersTable();
    }

    // ===== LEGEND =====
    updateLegend() {
        const el = document.getElementById('legend');
        if (this.currentTab === 'outlets') el.innerHTML = '<div class="legend-item"><span class="colour-dot dot-green"></span> Buyer & Visited</div><div class="legend-item"><span class="colour-dot dot-yellow"></span> Non‑buyer, Visited</div><div class="legend-item"><span class="colour-dot dot-red"></span> Non‑buyer, Not Visited</div>';
        else if (this.currentTab === 'visits') el.innerHTML = '<div class="legend-item"><span class="colour-dot dot-green"></span> Order Created</div><div class="legend-item"><span class="colour-dot dot-red"></span> No Order</div>';
        else if (this.currentTab === 'nonbuyers') el.innerHTML = '<div class="legend-item"><span class="colour-dot dot-yellow"></span> Visited, No Order</div><div class="legend-item"><span class="colour-dot dot-red"></span> Not Visited, No Order</div>';
        else el.innerHTML = '';
    }

    // ===== EXPORT =====
    exportToExcel() {
        const { data, headers } = this.getExportData();
        if (!data.length) return alert('No data to export.');
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data, { header: headers });
        XLSX.utils.book_append_sheet(wb, ws, this.currentTab);
        XLSX.writeFile(wb, this.getExportFilename('xlsx'));
    }

    getExportData() {
        let data = [], headers = [];
        const tab = this.currentTab;
        const cols = this.columnDefs[tab].filter(c => !c.hidden && c.id !== 'remarks');
        headers = cols.map(c => c.label);
        const srcData = tab === 'outlets' ? this.filteredOutletData : tab === 'visits' ? this.filteredVisitsData : this.filteredNonBuyersData;
        data = srcData.map((item, idx) => {
            const row = {};
            cols.forEach(c => {
                let val = c.id === 'sn' ? idx + 1 : item[c.id];
                if (c.id === 'outlet_name' && tab === 'visits') val = item.outlets?.outlet_name || item.outlet_id;
                if (c.id === 'order_created') val = item.order_created ? 'Yes' : 'No';
                if (c.id === 'location_url') val = item.location_url || item.location || '';
                if (c.id === 'location_map_url') val = item.location_map_url || '';
                row[c.label] = val || '';
            });
            if (tab === 'nonbuyers') row['Remarks'] = item.remarks || '';
            return row;
        });
        if (tab === 'nonbuyers') headers.push('Remarks');
        return { data, headers };
    }

    async exportToImage() {
        const wrapper = document.getElementById(`${this.currentTab}TableWrapper`);
        if (!wrapper || wrapper.style.display === 'none') return alert('No data to export. Apply filters first.');
        try {
            const canvas = await html2canvas(wrapper, { scale: 1.5, useCORS: true, backgroundColor: '#ffffff' });
            const link = document.createElement('a');
            link.download = this.getExportFilename('png');
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch (e) { console.error('Image export error:', e); alert('Failed to export image.'); }
    }

    async exportToPdf() {
        const wrapper = document.getElementById(`${this.currentTab}TableWrapper`);
        if (!wrapper || wrapper.style.display === 'none') return alert('No data to export. Apply filters first.');
        try {
            const canvas = await html2canvas(wrapper, { scale: 1.5, useCORS: true, backgroundColor: '#ffffff' });
            const imgData = canvas.toDataURL('image/jpeg', 0.6);
            const { jsPDF } = window.jspdf;
            // Portrait A4, multi-page if needed
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const pdfW = pdf.internal.pageSize.getWidth();
            const pdfH = pdf.internal.pageSize.getHeight();
            const margin = 5;
            const usableW = pdfW - margin * 2;
            const imgW = canvas.width, imgH = canvas.height;
            const scaledH = (usableW / imgW) * imgH;

            if (scaledH <= pdfH - margin * 2) {
                // Fits on one page
                pdf.addImage(imgData, 'JPEG', margin, margin, usableW, scaledH);
            } else {
                // Multi-page: slice the canvas into page-sized chunks
                const pageContentH = pdfH - margin * 2;
                const srcPageH = (pageContentH / scaledH) * imgH;
                let yOffset = 0;
                let pageNum = 0;

                while (yOffset < imgH) {
                    if (pageNum > 0) pdf.addPage();
                    const sliceH = Math.min(srcPageH, imgH - yOffset);
                    // Create a temp canvas for this slice
                    const sliceCanvas = document.createElement('canvas');
                    sliceCanvas.width = imgW;
                    sliceCanvas.height = sliceH;
                    const ctx = sliceCanvas.getContext('2d');
                    ctx.drawImage(canvas, 0, yOffset, imgW, sliceH, 0, 0, imgW, sliceH);
                    const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.6);
                    const sliceScaledH = (usableW / imgW) * sliceH;
                    pdf.addImage(sliceData, 'JPEG', margin, margin, usableW, sliceScaledH);
                    yOffset += sliceH;
                    pageNum++;
                }
            }
            pdf.save(this.getExportFilename('pdf'));
        } catch (e) { console.error('PDF export error:', e); alert('Failed to export PDF.'); }
    }

    // ===== FILTER PANEL =====
    buildFilterPanel() {
        Object.values(this.dropdowns).forEach(d => { if (d && d.destroy) d.destroy(); });
        this.dropdowns = {};
        const panel = document.getElementById('filterPanel');
        let html = '';

        if (this.currentTab === 'outlets') {
            html = `
                <div class="filter-row">
                    <div class="filter-group"><label>Distributors</label><div id="filterDistributors"></div></div>
                    <div class="filter-group"><label>Outlet Type</label>
                        <select id="filterOutletType"><option value="">All</option><option value="HVO">HVO</option><option value="GTM">GTM</option><option value="HORECA">HORECA</option></select></div>
                    <div class="filter-group"><label>Visit Day</label>
                        <select id="filterVisitDay"><option value="">All</option><option value="Monday">Monday</option><option value="Tuesday">Tuesday</option><option value="Wednesday">Wednesday</option><option value="Thursday">Thursday</option><option value="Friday">Friday</option><option value="Saturday">Saturday</option><option value="Flexible">Flexible</option></select></div>
                </div>
                <div class="filter-row">
                    <div class="filter-group"><label>Sort By</label>
                        <select id="sortBy"><option value="name">Outlet Name</option><option value="date">Last Visit</option><option value="visit">Visit Count</option><option value="orderValue">Order Value</option><option value="visitDay">Visit Day</option></select></div>
                    <div class="filter-group"><label>Order</label>
                        <select id="sortOrder"><option value="asc">Ascending</option><option value="desc">Descending</option></select></div>
                    <div class="filter-group"><label>Colour</label>
                        <div class="colour-filter" id="colourFilter">
                            <label class="colour-check"><span class="colour-dot dot-green"></span><input type="checkbox" value="green" checked> Green</label>
                            <label class="colour-check"><span class="colour-dot dot-yellow"></span><input type="checkbox" value="yellow" checked> Yellow</label>
                            <label class="colour-check"><span class="colour-dot dot-red"></span><input type="checkbox" value="red" checked> Red</label>
                        </div></div>
                </div>`;
        } else if (this.currentTab === 'visits') {
            html = `
                <div class="filter-row">
                    <div class="filter-group"><label>Distributors</label><div id="filterDistributors"></div></div>
                    <div class="filter-group"><label>Created By</label><div id="filterCreatedByEmail"></div></div>
                </div>
                <div class="filter-row">
                    <div class="filter-group"><label>Date Filter</label>
                        <select id="visitDateFilterType"><option value="month">This Month</option><option value="today">Today</option><option value="custom">Custom Range</option></select></div>
                    <div class="filter-group" id="customDateRange" style="display:none;">
                        <label>From</label><input type="date" id="filterDateFrom">
                        <label style="margin-top:4px;">To</label><input type="date" id="filterDateTo"></div>
                    <div class="filter-group"><label>Order Status</label>
                        <select id="filterOrderStatus"><option value="all">All Visits</option><option value="yes">Order Created</option><option value="no">No Order</option></select></div>
                </div>
                <div class="filter-row">
                    <div class="filter-group"><label>Sort By</label>
                        <select id="sortBy"><option value="visit_date">Visit Date</option><option value="visit_day">Visit Day</option></select></div>
                    <div class="filter-group"><label>Order</label>
                        <select id="sortOrder"><option value="desc">Descending</option><option value="asc">Ascending</option></select></div>
                </div>`;
        } else if (this.currentTab === 'nonbuyers') {
            html = `
                <div class="filter-row">
                    <div class="filter-group"><label>Distributors</label><div id="filterDistributors"></div></div>
                    <div class="filter-group"><label>From Date</label><input type="date" id="filterDateFrom"></div>
                    <div class="filter-group"><label>To Date</label><input type="date" id="filterDateTo"></div>
                </div>
                <div class="filter-row">
                    <div class="filter-group"><label>Sort By</label>
                        <select id="sortBy"><option value="outlet_name">Outlet Name</option><option value="visit_day">Visit Day</option><option value="last_visit_date">Last Visit</option><option value="visit_count">Visit Count</option></select></div>
                    <div class="filter-group"><label>Order</label>
                        <select id="sortOrder"><option value="asc">Ascending</option><option value="desc">Descending</option></select></div>
                </div>`;
        }

        html += `<div class="filter-actions">
            <button class="btn btn-secondary btn-sm" id="closeFilter">Close</button>
            <button class="btn btn-primary btn-sm" id="applyFilters"><i class="fas fa-check"></i> Apply</button>
        </div>`;
        panel.innerHTML = html;

        setTimeout(() => {
            this.initFilterDropdowns();
            this.restoreFilterValues();
            const dtf = document.getElementById('visitDateFilterType'), cr = document.getElementById('customDateRange');
            if (dtf && cr) dtf.addEventListener('change', () => { cr.style.display = dtf.value === 'custom' ? 'flex' : 'none'; });
        }, 50);

        panel.querySelector('#closeFilter').addEventListener('click', () => {
            panel.classList.remove('show');
            document.getElementById('filterArrow').classList.remove('open');
        });
        panel.querySelector('#applyFilters').addEventListener('click', () => {
            this.saveFilters();
            this.handleApplyFilters();
            panel.classList.remove('show');
            document.getElementById('filterArrow').classList.remove('open');
        });
    }

    initFilterDropdowns() {
        const distOpts = this.distributorsList.map(d => ({ value: d.distributor_id, label: d.distributor_name }));
        if (document.getElementById('filterDistributors'))
            this.dropdowns.distributors = new CheckboxDropdown('filterDistributors', distOpts, { placeholder: 'Select distributors...', showSelectAll: true, showSearch: distOpts.length > 6 });
        if (document.getElementById('filterCreatedByEmail'))
            this.dropdowns.createdBy = new CheckboxDropdown('filterCreatedByEmail', this.createdByEmails.map(e => ({ value: e, label: e })), { placeholder: 'Select email...', showSelectAll: false, showSearch: true });
    }

    async handleApplyFilters() {
        if (this.currentTab === 'outlets') { if (!this.dataLoaded.outlets) await this.loadAllOutlets(); else this.applyOutletFilters(); }
        else if (this.currentTab === 'visits') { if (!this.dataLoaded.visits) await this.loadAllVisits(); else this.applyVisitsFilters(); }
        else if (this.currentTab === 'nonbuyers') { if (!this.dataLoaded.nonbuyers) await this.loadNonBuyers(); else this.applyNonBuyersFilters(); }
    }

    restoreFilterValues() {
        if (this.currentTab === 'outlets') {
            if (this.dropdowns.distributors) this.dropdowns.distributors.setSelected(this.filters.outlets.distributors);
            const ot = document.getElementById('filterOutletType'), vd = document.getElementById('filterVisitDay');
            const sb = document.getElementById('sortBy'), so = document.getElementById('sortOrder');
            if (ot) ot.value = this.filters.outlets.outletType || '';
            if (vd) vd.value = this.filters.outlets.visitDay || '';
            if (sb) sb.value = this.filters.outlets.sortBy || 'name';
            if (so) so.value = this.filters.outlets.sortOrder || 'asc';
            document.querySelectorAll('#colourFilter input').forEach(cb => { cb.checked = this.filters.outlets.colours.includes(cb.value); });
        } else if (this.currentTab === 'visits') {
            if (this.dropdowns.distributors) this.dropdowns.distributors.setSelected(this.filters.visits.distributors);
            if (this.dropdowns.createdBy) { const v = this.filters.visits.createdByEmail; if (v) this.dropdowns.createdBy.setSelected([v]); }
            const dtf = document.getElementById('visitDateFilterType'), f = document.getElementById('filterDateFrom'), t = document.getElementById('filterDateTo');
            const os = document.getElementById('filterOrderStatus'), cr = document.getElementById('customDateRange');
            const sb = document.getElementById('sortBy'), so = document.getElementById('sortOrder');
            if (dtf) { dtf.value = this.filters.visits.dateFilterType || 'month'; if (cr) cr.style.display = dtf.value === 'custom' ? 'flex' : 'none'; }
            if (f) f.value = this.filters.visits.fromDate || '';
            if (t) t.value = this.filters.visits.toDate || '';
            if (os) os.value = this.filters.visits.orderStatusFilter || 'all';
            if (sb) sb.value = this.filters.visits.sortBy || 'visit_date';
            if (so) so.value = this.filters.visits.sortOrder || 'desc';
        } else if (this.currentTab === 'nonbuyers') {
            if (this.dropdowns.distributors) this.dropdowns.distributors.setSelected(this.filters.nonbuyers.distributors);
            const f = document.getElementById('filterDateFrom'), t = document.getElementById('filterDateTo');
            const sb = document.getElementById('sortBy'), so = document.getElementById('sortOrder');
            if (f) f.value = this.filters.nonbuyers.fromDate || '';
            if (t) t.value = this.filters.nonbuyers.toDate || '';
            if (sb) sb.value = this.filters.nonbuyers.sortBy || 'outlet_name';
            if (so) so.value = this.filters.nonbuyers.sortOrder || 'asc';
        }
    }

    saveFilters() {
        if (this.currentTab === 'outlets') {
            this.filters.outlets.distributors = this.dropdowns.distributors ? this.dropdowns.distributors.getSelected() : [];
            this.filters.outlets.outletType = document.getElementById('filterOutletType')?.value || '';
            this.filters.outlets.visitDay = document.getElementById('filterVisitDay')?.value || '';
            this.filters.outlets.sortBy = document.getElementById('sortBy')?.value || 'name';
            this.filters.outlets.sortOrder = document.getElementById('sortOrder')?.value || 'asc';
            this.filters.outlets.colours = Array.from(document.querySelectorAll('#colourFilter input:checked')).map(c => c.value);
        } else if (this.currentTab === 'visits') {
            this.filters.visits.distributors = this.dropdowns.distributors ? this.dropdowns.distributors.getSelected() : [];
            this.filters.visits.createdByEmail = this.dropdowns.createdBy ? (this.dropdowns.createdBy.getSelected()[0] || '') : '';
            this.filters.visits.dateFilterType = document.getElementById('visitDateFilterType')?.value || 'month';
            this.filters.visits.fromDate = document.getElementById('filterDateFrom')?.value || '';
            this.filters.visits.toDate = document.getElementById('filterDateTo')?.value || '';
            this.filters.visits.orderStatusFilter = document.getElementById('filterOrderStatus')?.value || 'all';
            this.filters.visits.sortBy = document.getElementById('sortBy')?.value || 'visit_date';
            this.filters.visits.sortOrder = document.getElementById('sortOrder')?.value || 'desc';
        } else if (this.currentTab === 'nonbuyers') {
            this.filters.nonbuyers.distributors = this.dropdowns.distributors ? this.dropdowns.distributors.getSelected() : [];
            this.filters.nonbuyers.fromDate = document.getElementById('filterDateFrom')?.value || '';
            this.filters.nonbuyers.toDate = document.getElementById('filterDateTo')?.value || '';
            this.filters.nonbuyers.sortBy = document.getElementById('sortBy')?.value || 'outlet_name';
            this.filters.nonbuyers.sortOrder = document.getElementById('sortOrder')?.value || 'asc';
        }
    }

    // ===== EVENT LISTENERS =====
    setupEventListeners() {
        document.getElementById('filterToggle').addEventListener('click', () => {
            document.getElementById('filterPanel').classList.toggle('show');
            document.getElementById('filterArrow').classList.toggle('open');
        });

        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById(tab.dataset.tab + 'Tab').classList.add('active');
                this.currentTab = tab.dataset.tab;
                document.getElementById('filterPanel').classList.remove('show');
                document.getElementById('filterArrow').classList.remove('open');
                this.buildFilterPanel();
                this.updateLegend();
                this.buildColumnDropdown();
            });
        });

        document.getElementById('columnBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('columnDropdown').classList.toggle('show');
        });
        document.addEventListener('click', () => document.getElementById('columnDropdown').classList.remove('show'));

        document.getElementById('exportBtn').addEventListener('click', () => this.exportToExcel());
        document.getElementById('exportPdfBtn').addEventListener('click', () => this.exportToPdf());
        document.getElementById('exportImgBtn').addEventListener('click', () => this.exportToImage());
        document.getElementById('bulkSaveRemarksBtn')?.addEventListener('click', () => this.bulkSaveRemarks());

        document.getElementById('homeBtn')?.addEventListener('click', () => {
            this.handleLogout();
            window.location.href = '/salesk95/index.html';
        });

        this.buildColumnDropdown();
    }

    buildColumnDropdown() {
        const cols = this.columnDefs[this.currentTab];
        const container = document.getElementById('columnDropdown');
        container.innerHTML = cols.map(col =>
            `<label><input type="checkbox" data-col="${col.id}" ${col.hidden ? '' : 'checked'}> ${col.label}</label>`
        ).join('');
        container.querySelectorAll('input').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const col = this.columnDefs[this.currentTab].find(c => c.id === e.target.dataset.col);
                if (col) col.hidden = !e.target.checked;
                if (this.currentTab === 'outlets') this.renderOutletTable();
                else if (this.currentTab === 'visits') this.renderVisitsTable();
                else this.renderNonBuyersTable();
            });
        });
    }

    showMessage(text, type, elementId) {
        const msg = document.getElementById(elementId);
        if (msg) { msg.textContent = text; msg.className = `message ${type} show`; setTimeout(() => msg.classList.remove('show'), 3000); }
    }

    handleLogout() {
        const lastEmail = localStorage.getItem(this.CACHE.EMAIL);
        Object.keys(localStorage).forEach(k => { if (k.startsWith('k95_') && k !== this.CACHE.EMAIL) localStorage.removeItem(k); });
        if (lastEmail) localStorage.setItem(this.CACHE.EMAIL, lastEmail);
        this.currentUser = null;
        document.getElementById('dashboard').style.display = 'none';
        document.getElementById('loginCard').style.display = 'block';
    }
}

const app = new OutletManager();
window.app = app;