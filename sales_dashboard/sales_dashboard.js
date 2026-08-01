// ============================================
// K95 FOODS - SALES DASHBOARD v2.7 (TIME & HEIGHT FIXED)
// ============================================
console.log('✅ sales-dashboard.js v2.7 loaded');

const SUPABASE_URL = 'https://jaasosewjbrwdklscxrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphYXNvc2V3amJyd2RrbHNjeHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMjAxMDEsImV4cCI6MjA4NTY5NjEwMX0.OE-dD6EN5DR3fvnaAd9jW3cJ7_5sYXNkY5vOQFQ00w0';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
    global: { fetch: async (url, options = {}) => {
        const parsed = new URL(url);
        const isAuth = parsed.pathname.startsWith('/auth/v1/');
        const apiPath = parsed.pathname.replace(isAuth ? '/auth/v1/' : '/rest/v1/', '');
        const proxy = new URL('/salesk95/proxy.php', window.location.origin);
        proxy.searchParams.set('type', isAuth ? 'auth' : 'rest');
        proxy.searchParams.set('path', apiPath);
        parsed.searchParams.forEach((value, key) => proxy.searchParams.append(key, value));
        return fetch(proxy, options);
    } }
});

// ============ HELPERS ============
function formatCurrency(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) return '₹0';
    return '₹' + Number(amount).toLocaleString('en-IN');
}
function getInitials(name) {
    if (!name) return '??';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}
function getISTParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const get = type => Number(parts.find(part => part.type === type)?.value || 0);
    return { year: get('year'), month: get('month'), day: get('day') };
}
function dateValue({year, month, day}) {
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function formatDuration(start, end) {
    if (!start || !end) return '—';
    const diffMs = new Date(end) - new Date(start);
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
}
function getRemainingDaysExcludingSundays() {
    const today = getISTParts();
    const endDay = new Date(Date.UTC(today.year, today.month, 0)).getUTCDate();
    let count = 0;
    for (let day = today.day; day <= endDay; day++) {
        if (new Date(Date.UTC(today.year, today.month - 1, day)).getUTCDay() !== 0) count++;
    }
    return count;
}
function getElapsedWorkingDays() {
    const today = getISTParts();
    let count = 0;
    for (let day = 1; day <= today.day; day++) {
        if (new Date(Date.UTC(today.year, today.month - 1, day)).getUTCDay() !== 0) count++;
    }
    return count;
}
function formatLocalTime(isoString) {
    if (!isoString) return '--:--';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '--:--';
    return date.toLocaleTimeString('en-IN', { timeZone:'Asia/Kolkata', hour:'2-digit', minute:'2-digit', hour12:true });
}

// ============ MAIN CLASS ============
class K95SalesDashboard {
    constructor() {
        this.currentUser = null;
        this.userRole = null;
        this.distributorsList = [];
        this.charts = {};
        this.mtdFilters = {
            distributors: [],
            statuses: ['Pending', 'Confirmed', 'Delivered', 'Draft']
        };
        this.fullName = '';
        this.access = null;
        this.init();
    }

    async init() {
        console.log('🚀 Initializing...');
        try {
            const { data: { session }, error } = await supabaseClient.auth.getSession();
            if (error || !session) {
                window.location.href = '/salesk95/index.html';
                return;
            }
            this.currentUser = { email: session.user.email, id: session.user.id };
            console.log('👤 User:', this.currentUser.email);
            
            await this.loadUserInfo();
            if (!this.access) throw new Error('You do not have access to Sales Report.');
            await this.loadDistributors();
            this.setupEventListeners();
            this.initializeFilters();
            await this.loadAllData();
        } catch (err) {
            document.getElementById('mtdContent').innerHTML = `<div class="empty-state"><i class="fas fa-circle-exclamation"></i><p>${escapeHTML(err.message || 'Unable to load the sales dashboard.')}</p></div>`;
            console.error('❌ Init error:', err);
        }
    }

    async loadUserInfo() {
        try {
            const { data: accessData, error } = await supabaseClient
                .from('access_manager')
                .select('role_name, full_name, avatar_url, distributor_ids, tile_permissions')
                .ilike('user_email', this.currentUser.email)
                .maybeSingle();
            if (error) throw error;
            if (!accessData) throw new Error('Your access record was not found.');
            const permission = accessData.tile_permissions?.sale_report?.access;
            if (!permission || permission === 'none') throw new Error('You do not have access to Sales Report.');
            this.access = accessData;
            this.userRole = accessData?.role_name || 'user';
            this.fullName = accessData?.full_name || this.currentUser.email.split('@')[0];
            document.getElementById('userName').textContent = this.fullName;
            document.getElementById('userInitials').textContent = getInitials(this.fullName);
            if (accessData.avatar_url) {
                const image = document.createElement('img');
                image.src = accessData.avatar_url;
                image.alt = `${this.fullName} profile photo`;
                image.onerror = () => { document.getElementById('userInitials').textContent = getInitials(this.fullName); };
                document.getElementById('userInitials').replaceChildren(image);
            }
            document.getElementById('userRole').textContent = 
                this.userRole === 'admin' ? 'Admin' : this.userRole === 'nsm' ? 'NSM' : 'Sales Rep';
        } catch (error) {
            console.error('❌ loadUserInfo error:', error);
        }
    }

    async loadDistributors() {
        try {
            let query = supabaseClient.from('distributors')
                .select('distributor_id, distributor_name, city')
                .eq('status', 'Active');
            if (this.userRole !== 'admin' && this.userRole !== 'nsm') {
                if (this.access?.distributor_ids?.length) {
                    query = query.in('distributor_id', this.access.distributor_ids);
                } else {
                    this.distributorsList = [];
                    return;
                }
            }
            const { data, error } = await query.order('distributor_name');
            if (error) throw error;
            this.distributorsList = data || [];
            console.log('📦 Distributors loaded:', this.distributorsList.length);
        } catch (error) {
            console.error('❌ loadDistributors error:', error);
        }
    }

    setupEventListeners() {
        document.querySelectorAll('.tab').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabId = btn.dataset.tab;
                document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(tabId + 'Content').classList.add('active');
            });
        });

        const filterHeader = document.querySelector('.filter-panel-header');
        const filterPanel = document.querySelector('.filter-panel');
        if (filterHeader && filterPanel) {
            filterHeader.addEventListener('click', () => {
                filterPanel.classList.toggle('collapsed');
            });
        }

        document.getElementById('applyFiltersBtn')?.addEventListener('click', () => this.applyMTDFilters());
        document.getElementById('resetFiltersBtn')?.addEventListener('click', () => this.resetMTDFilters());
        document.getElementById('refreshBtn')?.addEventListener('click', () => this.loadAllData());
        document.getElementById('homeBtn')?.addEventListener('click', () => { window.location.href = '/salesk95/index.html'; });
    }

    initializeFilters() {
        const group = document.getElementById('distributorCheckboxGroup');
        group.innerHTML = '';
        this.distributorsList.forEach(dist => {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = dist.distributor_id;
            checkbox.className = 'mtdDistributorFilter';
            checkbox.checked = true;
            label.append(checkbox, document.createTextNode(` ${dist.distributor_name} (${dist.city || 'N/A'})`));
            group.appendChild(label);
        });
        const selectAllLabel = document.createElement('label');
        selectAllLabel.style.fontWeight = 'bold';
        selectAllLabel.innerHTML = `<input type="checkbox" id="selectAllDistributors" checked> Select All`;
        group.prepend(selectAllLabel);
        document.getElementById('selectAllDistributors').addEventListener('change', (e) => {
            document.querySelectorAll('.mtdDistributorFilter').forEach(cb => cb.checked = e.target.checked);
        });

        document.querySelectorAll('.mtdStatusFilter').forEach(cb => {
            cb.checked = ['Pending', 'Confirmed', 'Delivered', 'Draft'].includes(cb.value);
        });

        this.mtdFilters.distributors = this.distributorsList.map(d => d.distributor_id);
        this.mtdFilters.statuses = ['Pending', 'Confirmed', 'Delivered', 'Draft'];
    }

    applyMTDFilters() {
        const checkboxes = document.querySelectorAll('.mtdDistributorFilter');
        this.mtdFilters.distributors = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
        this.mtdFilters.statuses = Array.from(document.querySelectorAll('.mtdStatusFilter:checked')).map(c => c.value);
        document.getElementById('selectAllDistributors').checked = this.mtdFilters.distributors.length === this.distributorsList.length;
        this.renderMTDTab();
    }

    resetMTDFilters() {
        document.querySelectorAll('.mtdDistributorFilter').forEach(cb => cb.checked = true);
        document.getElementById('selectAllDistributors').checked = true;
        document.querySelectorAll('.mtdStatusFilter').forEach(cb => {
            cb.checked = ['Pending', 'Confirmed', 'Delivered', 'Draft'].includes(cb.value);
        });
        this.mtdFilters.distributors = this.distributorsList.map(d => d.distributor_id);
        this.mtdFilters.statuses = ['Pending', 'Confirmed', 'Delivered', 'Draft'];
        this.renderMTDTab();
    }

    async loadAllData() {
        await Promise.all([this.renderMTDTab(), this.renderTodayTab()]);
    }

async renderMTDTab() {
    const container = document.getElementById('mtdContent');
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    try {
        const now = new Date();
        const ist = getISTParts(now);

        // ✅ LOCAL DATE STRINGS (for date columns like target_month)
        const monthStartLocal = dateValue({ year: ist.year, month: ist.month, day: 1 });

        // ✅ FIXED: get last day of month in local calendar without UTC conversion
        const lastDay = new Date(Date.UTC(ist.year, ist.month, 0)).getUTCDate();
        const monthEndLocal = dateValue({ year: ist.year, month: ist.month, day: lastDay });

        // ✅ FULL UTC ISO TIMESTAMPS (for timestamptz columns like orders.created_at)
        //    These represent the exact instant when the Indian day/month starts/ends
        const monthStartISO = new Date(`${monthStartLocal}T00:00:00+05:30`).toISOString();
        const monthEndISO   = new Date(`${monthEndLocal}T23:59:59.999+05:30`).toISOString();

        const distIds = this.mtdFilters.distributors.length > 0
                        ? this.mtdFilters.distributors
                        : this.distributorsList.map(d => d.distributor_id);
        const statuses = this.mtdFilters.statuses;
        if (!distIds.length || !statuses.length) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-filter-circle-xmark"></i><p>Select at least one distributor and one order status.</p></div>';
            return;
        }

        // Targets – uses DATE column
        const { data: targets, error: targetsError } = await supabaseClient
            .from('sales_targets')
            .select('distributor_id, target_amount')
            .gte('target_month', monthStartLocal)
            .lte('target_month', monthEndLocal)
            .in('distributor_id', distIds);
        if (targetsError) throw targetsError;

        // Orders – uses TIMESTAMPTZ column
        let orderQuery = supabaseClient
            .from('orders')
            .select('id, distributor_id, order_items(qty, rate)')
            .gte('created_at', monthStartISO)      // full ISO, no concatenation
            .lte('created_at', monthEndISO)
            .in('distributor_id', distIds);

        if (statuses.length > 0) {
            orderQuery = orderQuery.in('order_status', statuses);
        }
        const { data: orders, error: ordersError } = await orderQuery;
        if (ordersError) throw ordersError;

        // … rest of the achievedMap calculation, HTML generation, and charts …
        // (unchanged, but shown below for completeness)

        const achievedMap = {};
        (orders || []).forEach(order => {
            const distId = order.distributor_id;
            const total = (order.order_items || []).reduce((sum, item) => sum + (Number(item.qty||0) * Number(item.rate||0)), 0);
            achievedMap[distId] = (achievedMap[distId] || 0) + total;
        });

        const totalTarget = (targets || []).reduce((sum, t) => sum + Number(t.target_amount||0), 0);
        const totalAchieved = Object.values(achievedMap).reduce((sum, v) => sum + v, 0);
        const achievementPct = totalTarget > 0 ? (totalAchieved / totalTarget) * 100 : 0;
        const daysPassed = getElapsedWorkingDays();
        const remainingDaysExclSun = getRemainingDaysExcludingSundays();
        const dailyAvg = daysPassed > 0 ? totalAchieved / daysPassed : 0;
        const requiredDaily = remainingDaysExclSun > 0 ? Math.max(0, totalTarget - totalAchieved) / remainingDaysExclSun : 0;

        let html = `
        <div class="card-grid-2">
            <div class="stat-card"><div class="stat-label">Target</div><div class="stat-value">${formatCurrency(totalTarget)}</div><div class="stat-sub">${distIds.length} distributors</div></div>
            <div class="stat-card success"><div class="stat-label">Achieved</div><div class="stat-value">${formatCurrency(totalAchieved)}</div><div class="stat-sub">${achievementPct.toFixed(1)}% of target</div><div class="progress-bar"><div class="progress-fill" style="width:${Math.min(achievementPct,100)}%"></div></div></div>
            <div class="stat-card warning"><div class="stat-label">Daily Avg</div><div class="stat-value">${formatCurrency(dailyAvg)}</div><div class="stat-sub">${daysPassed} days passed</div></div>
            <div class="stat-card ${requiredDaily > dailyAvg ? 'danger' : 'success'}"><div class="stat-label">Required Daily</div><div class="stat-value">${formatCurrency(requiredDaily)}</div><div class="stat-sub">${remainingDaysExclSun} days left</div></div>
        </div>
        `;

        html += `<div class="chart-box chart-box-bar"><h4><i class="fas fa-chart-bar"></i> Distributor Performance</h4><canvas id="mtdDistChart"></canvas></div>`;
        html += `<div class="chart-box chart-box-donut"><h4><i class="fas fa-chart-pie"></i> Target Achievement</h4><canvas id="mtdTargetChart"></canvas></div>`;

        html += `<div class="table-wrapper"><div class="table-header"><i class="fas fa-truck"></i> Distributor Details</div><div class="table-scroll"><table><thead><tr><th>Distributor</th><th>Target</th><th>Achieved</th><th>%</th><th>Dent</th><th>Req Daily</th></tr></thead><tbody>`;

        const filteredDists = this.distributorsList.filter(d => distIds.includes(d.distributor_id));
        for (const dist of filteredDists) {
            const target = (targets || []).filter(t => t.distributor_id === dist.distributor_id).reduce((sum, item) => sum + Number(item.target_amount || 0), 0);
            const achieved = achievedMap[dist.distributor_id] || 0;
            const pct = target > 0 ? (achieved / target) * 100 : 0;
            const dent = Math.max(0, target - achieved);
            const shortfall = Math.max(0, target - achieved);
            const distRequiredDaily = remainingDaysExclSun > 0 ? shortfall / remainingDaysExclSun : 0;
            html += `<tr><td><strong>${escapeHTML(dist.distributor_name)}</strong><br><small>${escapeHTML(dist.city||'')}</small></td><td>${formatCurrency(target)}</td><td>${formatCurrency(achieved)}</td><td><span class="badge ${pct>=80?'badge-success':'badge-warning'}">${pct.toFixed(1)}%</span></td><td>${formatCurrency(dent)}</td><td>${formatCurrency(distRequiredDaily)}</td></tr>`;
        }
        html += `</tbody></table></div></div>`;
        container.innerHTML = html;

        this.renderMTDCharts(targets, achievedMap, filteredDists);
    } catch (error) {
        console.error('❌ MTD error:', error);
        container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Failed to load data</p></div>`;
    }
}


    renderMTDCharts(targets, achievedMap, dists) {
        const labels = dists.map(d => d.distributor_name.length > 15 ? d.distributor_name.substring(0,13)+'…' : d.distributor_name);
        const achievedData = dists.map(d => achievedMap[d.distributor_id] || 0);
        const targetData = dists.map(d => {
            const t = (targets || []).find(tg => tg.distributor_id === d.distributor_id);
            return t ? Number(t.target_amount) : 0;
        });

        const ctx1 = document.getElementById('mtdDistChart')?.getContext('2d');
        if (ctx1) {
            if (this.charts.dist) this.charts.dist.destroy();
            this.charts.dist = new Chart(ctx1, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { label: 'Achieved', data: achievedData, backgroundColor: '#059669' },
                        { label: 'Remaining', data: targetData.map((t, i) => Math.max(0, t - achievedData[i])), backgroundColor: '#e5e7eb' }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'top' } },
                    scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
                }
            });
        }

        const totalTarget = targetData.reduce((a,b)=>a+b,0);
        const totalAchieved = achievedData.reduce((a,b)=>a+b,0);
        const ctx2 = document.getElementById('mtdTargetChart')?.getContext('2d');
        if (ctx2) {
            if (this.charts.target) this.charts.target.destroy();
            this.charts.target = new Chart(ctx2, {
                type: 'doughnut',
                data: {
                    labels: ['Achieved', 'Remaining'],
                    datasets: [{ data: [totalAchieved, Math.max(0, totalTarget - totalAchieved)], backgroundColor: ['#059669', '#e5e7eb'] }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
            });
        }
    }

async renderTodayTab() {
        const container = document.getElementById('todayContent');
        container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
        try {
            const todayParts = getISTParts();
            const todayLocal = dateValue(todayParts);
            const todayStartISO = new Date(`${todayLocal}T00:00:00+05:30`).toISOString();
            const todayEndISO = new Date(`${todayLocal}T23:59:59.999+05:30`).toISOString();
            const userEmail = this.currentUser.email;

            const { data: visits, error: visitsError } = await supabaseClient
                .from('visits')
                .select('id, created_at, distributor_id, outlet_id, visit_type, notes, order_created, order_id, new_outlet_name, outlets(outlet_name)')
                .eq('created_by_email', userEmail)
                .eq('visit_date', todayLocal)
                .order('created_at', { ascending: true });
            if (visitsError) throw new Error(visitsError.message);

            const { data: orders, error: ordersError } = await supabaseClient
                .from('orders')
                .select('id, created_at, outlet_id, order_status, outlets(outlet_name), order_items(qty, rate)')
                .eq('created_by_email', userEmail)
                .gte('created_at', todayStartISO)
                .lte('created_at', todayEndISO);
            if (ordersError) throw new Error(ordersError.message);

            const { data: attendanceRows, error: attendanceError } = await supabaseClient
                .from('attendance_records')
                .select('check_in_time, check_out_time')
                .eq('user_email', userEmail)
                .eq('attendance_date', todayLocal)
                .order('created_at', { ascending: true });
            if (attendanceError) throw attendanceError;

            const totalCalls = visits?.length || 0;
            const validOrders = (orders || []).filter(o => o.order_status !== 'Cancelled');
            const productiveCalls = new Set(validOrders.map(o => o.outlet_id)).size;
            const conversionRate = totalCalls > 0 ? ((productiveCalls / totalCalls) * 100).toFixed(1) : '0.0';

            let totalBoxes = 0, totalSales = 0;
            validOrders.forEach(order => {
                (order.order_items || []).forEach(item => {
                    const qty = Number(item.qty) || 0;
                    const rate = Number(item.rate) || 0;
                    totalBoxes += qty;
                    totalSales += qty * rate;
                });
            });
            const totalBottles = totalBoxes * 6;
            const strikeRate = totalCalls > 0 ? (totalBoxes / totalCalls).toFixed(1) : '0.0';
            const avgDropSize = productiveCalls > 0 ? (totalBoxes / productiveCalls).toFixed(1) : '0.0';

            const boxesForOrder = order => (order.order_items || []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
            const visitRowsHTML = (visits || []).map(visit => {
                const outletName = visit.outlets?.outlet_name || visit.new_outlet_name || 'New outlet';
                const note = visit.notes || 'No notes';
                return `<div class="activity-row">
                    <span class="activity-time">${formatLocalTime(visit.created_at)}</span>
                    <span class="activity-main"><strong>${escapeHTML(outletName)}</strong><small>${escapeHTML(note)}</small></span>
                    <span class="activity-status visit-only">Visit</span>
                </div>`;
            }).join('') || '<div class="activity-empty">No visits recorded today</div>';
            const orderRowsHTML = validOrders.map(order => {
                const boxes = boxesForOrder(order);
                const orderValue = (order.order_items || []).reduce((sum, item) => sum + ((Number(item.qty) || 0) * (Number(item.rate) || 0)), 0);
                const outletName = order.outlets?.outlet_name || 'Outlet';
                const visibleStatus = order.order_status === 'Draft' ? '' : order.order_status;
                return `<div class="activity-row">
                    <span class="activity-time">${formatLocalTime(order.created_at)}</span>
                    <span class="activity-main"><strong>${escapeHTML(outletName)}</strong>${visibleStatus ? `<small>${escapeHTML(visibleStatus)}</small>` : ''}</span>
                    <span class="order-metrics"><b>${boxes} ${boxes === 1 ? 'box' : 'boxes'}</b><small>${formatCurrency(orderValue)}</small></span>
                </div>`;
            }).join('') || '<div class="activity-empty">No orders recorded today</div>';

            let checkIn = '--:--', checkOut = '--:--', duration = '—';
            const attendanceCheckIn = (attendanceRows || []).find(row => row.check_in_time)?.check_in_time;
            const attendanceCheckOut = [...(attendanceRows || [])].reverse().find(row => row.check_out_time)?.check_out_time;
            const firstVisitTime = visits?.[0]?.created_at || null;
            const lastVisitTime = visits?.[visits.length - 1]?.created_at || null;
            const validTimes = values => values.filter(Boolean).map(value => new Date(value)).filter(date => !Number.isNaN(date.getTime()));
            const startTimes = validTimes([attendanceCheckIn, firstVisitTime]);
            const endTimes = validTimes([attendanceCheckOut, lastVisitTime]);
            const effectiveCheckIn = startTimes.length ? new Date(Math.min(...startTimes.map(date => date.getTime()))).toISOString() : null;
            const effectiveCheckOut = endTimes.length ? new Date(Math.max(...endTimes.map(date => date.getTime()))).toISOString() : null;
            if (effectiveCheckIn) {
                checkIn = formatLocalTime(effectiveCheckIn);
                checkOut = formatLocalTime(effectiveCheckOut);
                duration = formatDuration(effectiveCheckIn, effectiveCheckOut);
            }

            let html = `
            <div class="user-header">
                <div class="user-header-avatar">${getInitials(this.fullName)}</div>
                <div class="user-header-info"><h2>${escapeHTML(this.fullName)}</h2><p>${this.userRole==='admin'?'Administrator':this.userRole==='nsm'?'National Sales Manager':'Sales Representative'}</p></div>
            </div>
            <div class="time-row">
                <div class="time-item"><span class="time-label">Check-in</span><span class="time-value">${checkIn}</span></div>
                <div class="time-item"><span class="time-label">Check-out</span><span class="time-value">${checkOut}</span></div>
                <div class="time-item"><span class="time-label">Duration</span><span class="time-value">${duration}</span></div>
            </div>
            <div class="stat-card success"><div class="stat-label">Total Sales</div><div class="stat-value">${formatCurrency(totalSales)}</div><div class="stat-sub">Today's revenue</div></div>
            <div class="card-grid-2">
                <div class="stat-card"><div class="stat-label">Total Calls</div><div class="stat-value">${totalCalls}</div><div class="stat-sub">Outlets visited</div></div>
                <div class="stat-card success"><div class="stat-label">Productive Calls</div><div class="stat-value">${productiveCalls}</div><div class="stat-sub">Orders taken</div></div>
            </div>
            <div class="card-grid-2">
                <div class="stat-card warning"><div class="stat-label">Boxes Sold</div><div class="stat-value">${totalBoxes}</div><div class="stat-sub">Cases</div></div>
                <div class="stat-card warning"><div class="stat-label">Bottles</div><div class="stat-value">${totalBottles}</div><div class="stat-sub">${totalBoxes} × 6</div></div>
            </div>
            <div class="card-grid-3">
                <div class="stat-card"><div class="stat-label">Conversion</div><div class="stat-value">${conversionRate}%</div><div class="stat-sub">Orders/Visits</div></div>
                <div class="stat-card"><div class="stat-label">Strike Rate</div><div class="stat-value">${strikeRate}</div><div class="stat-sub">Boxes/Visit</div></div>
                <div class="stat-card"><div class="stat-label">Avg Drop</div><div class="stat-value">${avgDropSize}</div><div class="stat-sub">Boxes/Order</div></div>
            </div>
            <div class="summary-bar"><i class="fas fa-check-circle"></i> <span>Today's summary loaded</span> <span>${totalCalls} outlets visited, ${totalBoxes} boxes sold</span></div>
            `;
            const screenshotHtml = `
                <section class="today-snapshot">
                    <div class="snapshot-heading">
                        <div><h2>${escapeHTML(this.fullName)}</h2><p>Today's field summary · ${todayParts.day}/${todayParts.month}/${todayParts.year}</p></div>
                        <span class="snapshot-role">${this.userRole==='admin'?'Admin':this.userRole==='nsm'?'NSM':'Sales'}</span>
                    </div>
                    <div class="time-row compact-time">
                        <div class="time-item"><span class="time-label">Check-in</span><span class="time-value">${checkIn}</span></div>
                        <div class="time-item"><span class="time-label">Check-out</span><span class="time-value">${checkOut}</span></div>
                        <div class="time-item"><span class="time-label">Duration</span><span class="time-value">${duration}</span></div>
                    </div>
                    <div class="snapshot-kpis">
                        <div class="mini-kpi"><span>Sales</span><strong>${formatCurrency(totalSales)}</strong></div>
                        <div class="mini-kpi"><span>Visits</span><strong>${totalCalls}</strong></div>
                        <div class="mini-kpi"><span>Ordered Outlets</span><strong>${productiveCalls}</strong></div>
                        <div class="mini-kpi"><span>Boxes</span><strong>${totalBoxes}</strong></div>
                        <div class="mini-kpi"><span>Conversion</span><strong>${conversionRate}%</strong></div>
                        <div class="mini-kpi"><span>Boxes/Visit</span><strong>${strikeRate}</strong></div>
                        <div class="mini-kpi"><span>Avg Drop</span><strong>${avgDropSize}</strong></div>
                    </div>
                    <div class="activity-grid">
                        <section class="activity-card combined-card"><h3><i class="fas fa-list-check"></i> Orders & Visits <span>${validOrders.length + totalCalls}</span></h3><div class="activity-list">${orderRowsHTML}${visitRowsHTML}</div></section>
                    </div>
                </section>`;
            container.innerHTML = screenshotHtml;
        } catch (error) {
            console.error('❌ Today error:', error);
            container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Failed to load today's data</p></div>`;
        }
    }
}

// Initialize
const salesDashboard = new K95SalesDashboard();
window.salesDashboard = salesDashboard;
