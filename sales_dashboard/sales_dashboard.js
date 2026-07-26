// ============================================
// K95 FOODS - SALES DASHBOARD v2.7 (TIME & HEIGHT FIXED)
// ============================================
console.log('✅ sales-dashboard.js v2.7 loaded');

const SUPABASE_URL = 'https://jaasosewjbrwdklscxrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphYXNvc2V3amJyd2RrbHNjeHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMjAxMDEsImV4cCI6MjA4NTY5NjEwMX0.OE-dD6EN5DR3fvnaAd9jW3cJ7_5sYXNkY5vOQFQ00w0';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
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
function formatDuration(start, end) {
    if (!start || !end) return '—';
    const diffMs = new Date(end) - new Date(start);
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
}
function getRemainingDaysExcludingSundays() {
    const today = new Date();
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    let count = 0;
    for (let d = new Date(today); d <= endOfMonth; d.setDate(d.getDate() + 1)) {
        if (d.getDay() !== 0) count++;
    }
    return count;
}
function formatLocalTime(isoString) {
    if (!isoString) return '--:--';
    // Extract hours and minutes directly from the ISO string (ignores timezone)
    const match = isoString.match(/T(\d{2}):(\d{2})/);
    if (!match) return '--:--';
    let hours = parseInt(match[1], 10);
    const minutes = match[2];
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
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
            statuses: ['Delivered', 'Draft']
        };
        this.fullName = '';
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
            await this.loadDistributors();
            this.setupEventListeners();
            this.initializeFilters();
            await this.loadAllData();
        } catch (err) {
            console.error('❌ Init error:', err);
        }
    }

    async loadUserInfo() {
        try {
            const { data: accessData } = await supabaseClient
                .from('access_manager')
                .select('role_name, full_name')
                .eq('user_email', this.currentUser.email)
                .maybeSingle();
            this.userRole = accessData?.role_name || 'user';
            this.fullName = accessData?.full_name || this.currentUser.email.split('@')[0];
            document.getElementById('userName').textContent = this.fullName;
            document.getElementById('userInitials').textContent = getInitials(this.fullName);
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
                const { data: access } = await supabaseClient
                    .from('access_manager')
                    .select('distributor_ids')
                    .eq('user_email', this.currentUser.email)
                    .maybeSingle();
                if (access?.distributor_ids?.length) {
                    query = query.in('distributor_id', access.distributor_ids);
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
    }

    initializeFilters() {
        const group = document.getElementById('distributorCheckboxGroup');
        group.innerHTML = '';
        this.distributorsList.forEach(dist => {
            const label = document.createElement('label');
            label.innerHTML = `<input type="checkbox" value="${dist.distributor_id}" class="mtdDistributorFilter" checked> ${dist.distributor_name} (${dist.city || 'N/A'})`;
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
            cb.checked = (cb.value === 'Delivered' || cb.value === 'Draft');
        });

        this.mtdFilters.distributors = this.distributorsList.map(d => d.distributor_id);
        this.mtdFilters.statuses = ['Delivered', 'Draft'];
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
            cb.checked = (cb.value === 'Delivered' || cb.value === 'Draft');
        });
        this.mtdFilters.distributors = this.distributorsList.map(d => d.distributor_id);
        this.mtdFilters.statuses = ['Delivered', 'Draft'];
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

        // ✅ LOCAL DATE STRINGS (for date columns like target_month)
        const monthStartLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

        // ✅ FIXED: get last day of month in local calendar without UTC conversion
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const monthEndLocal = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;

        // ✅ FULL UTC ISO TIMESTAMPS (for timestamptz columns like orders.created_at)
        //    These represent the exact instant when the Indian day/month starts/ends
        const monthStartISO = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const monthEndISO   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

        const distIds = this.mtdFilters.distributors.length > 0
                        ? this.mtdFilters.distributors
                        : this.distributorsList.map(d => d.distributor_id);
        const statuses = this.mtdFilters.statuses;

        // Targets – uses DATE column
        const { data: targets } = await supabaseClient
            .from('sales_targets')
            .select('distributor_id, target_amount')
            .gte('target_month', monthStartLocal)
            .lte('target_month', monthEndLocal)
            .in('distributor_id', distIds);

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
        const { data: orders } = await orderQuery;

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
        const daysPassed = now.getDate();
        const remainingDaysExclSun = getRemainingDaysExcludingSundays();
        const dailyAvg = daysPassed > 0 ? totalAchieved / daysPassed : 0;
        const requiredDaily = remainingDaysExclSun > 0 ? (totalTarget - totalAchieved) / remainingDaysExclSun : 0;

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
            const target = (targets || []).find(t => t.distributor_id === dist.distributor_id)?.target_amount || 0;
            const achieved = achievedMap[dist.distributor_id] || 0;
            const pct = target > 0 ? (achieved / target) * 100 : 0;
            const dent = target - achieved;
            const shortfall = Math.max(0, target - achieved);
            const distRequiredDaily = remainingDaysExclSun > 0 ? shortfall / remainingDaysExclSun : 0;
            html += `<tr><td><strong>${dist.distributor_name}</strong><br><small>${dist.city||''}</small></td><td>${formatCurrency(target)}</td><td>${formatCurrency(achieved)}</td><td><span class="badge ${pct>=80?'badge-success':'badge-warning'}">${pct.toFixed(1)}%</span></td><td>${formatCurrency(dent)}</td><td>${formatCurrency(distRequiredDaily)}</td></tr>`;
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
            const now = new Date();
            const todayLocal = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
            const userEmail = this.currentUser.email;

            const { data: visits, error: visitsError } = await supabaseClient
                .from('visits')
                .select('id, created_at, distributor_id, outlet_id, outlets(outlet_name)')
                .eq('created_by_email', userEmail)
                .eq('visit_date', todayLocal)
                .order('created_at', { ascending: true });
            if (visitsError) throw new Error(visitsError.message);

            const { data: orders, error: ordersError } = await supabaseClient
                .from('orders')
                .select('id, outlet_id, order_items(qty, rate)')
                .eq('created_by_email', userEmail)
                .gte('created_at', todayLocal + 'T00:00:00')
                .lte('created_at', todayLocal + 'T23:59:59');
            if (ordersError) throw new Error(ordersError.message);

            const totalCalls = visits?.length || 0;
            const validOrders = (orders || []).filter(o => !['Draft','Cancelled'].includes(o.order_status));
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

            let checkIn = '--:--', checkOut = '--:--', duration = '—';
            if (visits && visits.length > 0) {
                const first = visits[0];
                const last = visits[visits.length - 1];
                checkIn = formatLocalTime(first.created_at);
                checkOut = formatLocalTime(last.created_at);
                duration = formatDuration(first.created_at, last.created_at);
            }

            let html = `
            <div class="user-header">
                <div class="user-header-avatar">${getInitials(this.fullName)}</div>
                <div class="user-header-info"><h2>${this.fullName}</h2><p>${this.userRole==='admin'?'Administrator':this.userRole==='nsm'?'National Sales Manager':'Sales Representative'}</p></div>
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
            container.innerHTML = html;
        } catch (error) {
            console.error('❌ Today error:', error);
            container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Failed to load today's data</p></div>`;
        }
    }
}

// Initialize
const salesDashboard = new K95SalesDashboard();
window.salesDashboard = salesDashboard;