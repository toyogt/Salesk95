// ============================================
// K95 FOODS - ATTENDANCE REPORT
// ============================================
console.log('✅ report.js loaded');

let supabaseClient = null;
let supabaseAvailable = false;

if (typeof window.supabase === 'undefined') {
    console.error('❌ Supabase library not loaded. Check network / CSP.');
    alert('Supabase library failed to load. Please refresh or contact admin.');
} else {
    console.log('✅ Supabase library detected');
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
        }
    );
    console.log('✅ Supabase client with proxy initialized');
}

// ============================================
// HELPER FUNCTIONS (with availability checks)
// ============================================
async function supabaseFetch(table, options = {}) {
    if (!supabaseAvailable || !supabaseClient) {
        throw new Error('Supabase client not available. Please refresh.');
    }
    const { filters = {}, single = false, limit = null } = options;
    try {
        let query = supabaseClient.from(table).select('*');
        Object.entries(filters).forEach(([key, value]) => {
            if (value !== undefined && value !== null) query = query.eq(key, value);
        });
        if (limit) query = query.limit(limit);
        const { data, error } = await query;
        if (error) throw error;
        return single ? data[0] : data;
    } catch (error) {
        console.error(`❌ Error fetching from ${table}:`, error);
        throw error;
    }
}

// Convert UTC to IST
function utcToIst(utcDate) {
    if (!utcDate) return null;
    const date = new Date(utcDate);
    return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

// Format time for display
function formatTime(date) {
    if (!date) return '-';
    return date.toLocaleTimeString('en-IN', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
    });
}

// Format date for display
function formatDate(date) {
    if (!date) return '-';
    return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

// Calculate working hours
function calculateWorkingHours(checkIn, checkOut) {
    if (!checkIn || !checkOut) return '-';
    
    const checkInTime = new Date(checkIn).getTime();
    const checkOutTime = new Date(checkOut).getTime();
    const diffMs = checkOutTime - checkInTime;
    const diffHrs = diffMs / (1000 * 60 * 60);
    
    return diffHrs.toFixed(2);
}

// Check if time is late (after 10:30 AM IST)
function isLateCheckIn(checkInTime) {
    if (!checkInTime) return false;
    
    const istTime = utcToIst(checkInTime);
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    
    // 10:30 AM IST = 10.5 hours
    return hours > 10 || (hours === 10 && minutes > 30);
}

// Check if early check-out (before 5:30 PM IST)
function isEarlyCheckOut(checkOutTime) {
    if (!checkOutTime) return false;
    
    const istTime = utcToIst(checkOutTime);
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    
    // 5:30 PM IST = 17.5 hours
    return hours < 17 || (hours === 17 && minutes < 30);
}

// Get day name
function getDayName(dateStr) {
    const date = new Date(dateStr);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[date.getDay()];
}

function getISTDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const value = type => Number(parts.find(part => part.type === type)?.value || 0);
    return { year: value('year'), month: value('month'), day: value('day') };
}

function toDateInputValue(year, month, day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ============================================
// MAIN APPLICATION CLASS
// ============================================
class K95AttendanceReport {
    constructor() {
        this.currentUser = null;
        this.userRole = null;
        this.distributorsList = [];
        this.holidays = [];
        this.attendanceData = [];
        this.reportUsers = [];
        this.userNames = {};
        this.dataTable = null;
        
        this.init();
    }

    async init() {
        console.log('K95 Attendance Report - Initializing...');
        
        if (!supabaseAvailable || !supabaseClient) {
            alert('Supabase not available. Please refresh or contact admin.');
            return;
        }
        
        try {
            const { data: { session }, error } = await supabaseClient.auth.getSession();
            
            if (error || !session) {
                console.log('No active session, redirecting to login');
                window.location.href = '/salesk95/index.html';
                return;
            }
            
            this.currentUser = {
                email: session.user.email,
                id: session.user.id
            };
            
            console.log('✅ User authenticated:', this.currentUser.email);
            
            document.getElementById('userEmail').textContent = this.currentUser.email;
            
            await this.getUserRole();
            this.setCurrentMonthRange();
            await this.loadUsers();
            await this.loadAttendanceData();
            this.setupEventListeners();
            this.setupColumnSelector();
            
        } catch (error) {
            console.error('Init error:', error);
            alert('Failed to initialize: ' + error.message);
        }
    }

    setCurrentMonthRange() {
        const { year, month } = getISTDateParts();
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        document.getElementById('dateFrom').value = toDateInputValue(year, month, 1);
        document.getElementById('dateTo').value = toDateInputValue(year, month, lastDay);
    }

    setupColumnSelector() {
        const checkboxes = document.querySelectorAll('.column-toggle');
        checkboxes.forEach(cb => {
            cb.addEventListener('change', () => {
                this.renderTable();
            });
        });
    }

    async loadUsers() {
        try {
            let query = supabaseClient
                .from('access_manager')
                .select('user_email, full_name')
                .order('user_email');
            
            if (this.userRole !== 'admin' && this.userRole !== 'nsm') {
                query = query.eq('user_email', this.currentUser.email);
            }
            
            const { data, error } = await query;
            if (error) throw error;
            
            this.reportUsers = (data || []).filter(item => item.user_email && item.user_email !== 'unknown');
            this.userNames = Object.fromEntries(this.reportUsers.map(item => [
                item.user_email,
                String(item.full_name || '').trim() || item.user_email.split('@')[0]
            ]));
            
            const select = document.getElementById('userFilter');
            if (select) {
                select.innerHTML = '<option value="">All Users</option>' +
                    this.reportUsers.map(user =>
                        `<option value="${user.user_email}">${this.userNames[user.user_email]}</option>`
                    ).join('');
            }
            
        } catch (error) {
            console.error('Error loading users:', error);
        }
    }

    async getUserRole() {
        try {
            console.log('Fetching role for:', this.currentUser.email);
            
            const { data, error } = await supabaseClient
                .from('access_manager')
                .select('role_name')
                .eq('user_email', this.currentUser.email)
                .maybeSingle();
            
            if (error) {
                console.error('Error fetching role:', error);
                this.userRole = 'user';
            } else if (data) {
                this.userRole = String(data.role_name || 'user').trim().toLowerCase();
                console.log('✅ Found role:', this.userRole);
            } else {
                console.log('No role found, defaulting to user');
                this.userRole = 'user';
            }
            
            const roleBadge = document.getElementById('userRole');
            if (roleBadge) {
                roleBadge.textContent = this.userRole.toUpperCase();
                if (this.userRole === 'admin') {
                    roleBadge.style.background = '#dc3545';
                } else if (this.userRole === 'nsm') {
                    roleBadge.style.background = '#fd7e14';
                } else {
                    roleBadge.style.background = '#1e3c72';
                }
            }
            
            if (this.userRole === 'admin') {
                const adminSection = document.getElementById('adminSection');
                if (adminSection) {
                    adminSection.style.display = 'block';
                    await this.loadUsersForAdmin();
                }
            }
            
        } catch (error) {
            console.error('Error in getUserRole:', error);
            this.userRole = 'user';
        }
    }

    async loadUsersForAdmin() {
        try {
            console.log('Loading users for admin dropdown...');
            
            const { data: accessUsers, error } = await supabaseClient
                .from('access_manager')
                .select('user_email, full_name, role_name')
                .order('user_email');
            
            if (error) throw error;
            
            console.log('Access manager users:', accessUsers);
            
            const select = document.getElementById('leaveUserSelect');
            if (!select) return;
            
            select.innerHTML = '<option value="">Select User</option>';
            
            if (accessUsers && accessUsers.length > 0) {
                accessUsers.forEach(user => {
                    if (user.user_email) {
                        const option = document.createElement('option');
                        option.value = user.user_email;
                        option.textContent = `${String(user.full_name || '').trim() || user.user_email.split('@')[0]} (${user.role_name || 'user'})`;
                        select.appendChild(option);
                    }
                });
                console.log(`✅ Loaded ${accessUsers.length} users for admin`);
            }
            
        } catch (error) {
            console.error('Error loading users for admin:', error);
        }
    }

    async loadAttendanceData() {
        try {
            const tableBody = document.getElementById('tableBody');
            if (!tableBody) return;
            
            tableBody.innerHTML = `
                <tr><td colspan="12" class="text-center">
                    <div class="loading-spinner"><div class="spinner"></div></div>
                </td></tr>
            `;
            
            let query = supabaseClient
                .from('attendance_records')
                .select(`
                    *,
                    distributors ( distributor_name )
                `)
                .eq('is_draft', false)
                .order('attendance_date', { ascending: false });
            
            const userFilter = document.getElementById('userFilter');
            const userEmail = userFilter ? userFilter.value : '';
            
            if (userEmail) {
                query = query.eq('user_email', userEmail);
            } else if (this.userRole !== 'admin' && this.userRole !== 'nsm') {
                query = query.eq('user_email', this.currentUser.email);
            }
            
            const dateFrom = document.getElementById('dateFrom');
            const dateTo = document.getElementById('dateTo');
            
            if (dateFrom && dateFrom.value) query = query.gte('attendance_date', dateFrom.value);
            if (dateTo && dateTo.value) query = query.lte('attendance_date', dateTo.value);
            
            const { data, error } = await query;
            if (error) throw error;

            this.attendanceData = this.buildCalendarRows(data || [], userEmail, dateFrom?.value, dateTo?.value);
            const status = document.getElementById('statusFilter')?.value || '';
            if (status) this.attendanceData = this.attendanceData.filter(record => record.status === status);
            
            this.updateSummaryCards();
            await this.loadHolidays();
            this.renderTable();
            
        } catch (error) {
            console.error('Error loading attendance data:', error);
            alert('Error loading data: ' + error.message);
        }
    }

    buildCalendarRows(records, selectedEmail, fromValue, toValue) {
        if (!fromValue || !toValue) return records;
        const emails = selectedEmail
            ? [selectedEmail]
            : (this.userRole === 'admin' || this.userRole === 'nsm')
                ? this.reportUsers.map(user => user.user_email)
                : [this.currentUser.email];
        const byUserDate = new Map(records.map(record => [`${record.user_email}|${record.attendance_date}`, record]));
        const now = new Date();
        const nowISTParts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
        }).formatToParts(now);
        const part = type => Number(nowISTParts.find(item => item.type === type)?.value || 0);
        const today = toDateInputValue(part('year'), part('month'), part('day'));
        const currentHour = part('hour');
        const rows = [];
        const start = new Date(`${fromValue}T00:00:00Z`);
        const end = new Date(`${toValue}T00:00:00Z`);

        for (const email of emails) {
            for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
                const date = toDateInputValue(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
                const existing = byUserDate.get(`${email}|${date}`);
                if (existing) {
                    rows.push(existing);
                    continue;
                }
                const sunday = cursor.getUTCDay() === 0;
                let status = 'upcoming';
                if (sunday) status = 'off';
                else if (date < today || (date === today && currentHour >= 14)) status = 'leave';
                else if (date === today) status = 'pending';
                rows.push({
                    id: null, synthetic: true, user_email: email, attendance_date: date,
                    status, check_in_time: null, check_out_time: null
                });
            }
        }
        return rows.sort((a, b) => a.attendance_date.localeCompare(b.attendance_date)
            || (this.userNames[a.user_email] || a.user_email).localeCompare(this.userNames[b.user_email] || b.user_email));
    }

    updateSummaryCards() {
        const stats = {
            total: this.attendanceData.length,
            present: 0,
            halfDay: 0,
            leave: 0,
            absent: 0,
            totalHours: 0,
            hoursCount: 0
        };
        
        this.attendanceData.forEach(record => {
            switch(record.status) {
                case 'present': stats.present++; break;
                case 'half_day': stats.halfDay++; break;
                case 'leave': stats.leave++; break;
                case 'absent': stats.absent++; break;
            }
            
            if (record.check_in_time && record.check_out_time) {
                const hours = calculateWorkingHours(record.check_in_time, record.check_out_time);
                if (hours !== '-') {
                    stats.totalHours += parseFloat(hours);
                    stats.hoursCount++;
                }
            }
        });
        
        document.getElementById('totalDays').textContent = stats.total;
        document.getElementById('totalPresent').textContent = stats.present;
        document.getElementById('totalHalfDay').textContent = stats.halfDay;
        document.getElementById('totalLeave').textContent = stats.leave;
        document.getElementById('totalAbsent').textContent = stats.absent;
        
        const avgHours = stats.hoursCount > 0 ? (stats.totalHours / stats.hoursCount).toFixed(2) : 0;
        document.getElementById('avgHours').textContent = avgHours;
    }

    async loadHolidays() {
        try {
            const { data } = await supabaseClient
                .from('holidays')
                .select('*')
                .order('holiday_date', { ascending: true });
            
            this.holidays = data || [];
            
            const holidaysSection = document.getElementById('holidaysSection');
            const holidaysList = document.getElementById('holidaysList');
            
            if (this.holidays.length > 0) {
                holidaysSection.style.display = 'block';
                document.getElementById('holidaysCount').textContent = this.holidays.length;
                
                holidaysList.innerHTML = this.holidays.map(h => `
                    <span class="holiday-tag">
                        <i class="fas fa-gift"></i>
                        ${new Date(h.holiday_date).toLocaleDateString('en-IN')} - ${h.holiday_name}
                    </span>
                `).join('');
            } else {
                holidaysSection.style.display = 'none';
            }
            
        } catch (error) {
            console.error('Error loading holidays:', error);
        }
    }

    renderTable() {
        if (this.dataTable) {
            this.dataTable.destroy();
        }
        
        const tbody = document.getElementById('tableBody');
        tbody.innerHTML = '';
        
        const selectedCols = Array.from(document.querySelectorAll('.column-toggle:checked')).map(cb => cb.value);
        
        const thead = document.querySelector('#attendanceTable thead tr');
        if (thead) {
            const headerMap = {
                date: 'Date',
                day: 'Day',
                user: 'User',
                status: 'Status',
                checkin: 'Check In',
                checkout: 'Check Out',
                hours: 'Hours',
                beat: 'Beat Route',
                comments: 'Comments',
                leavereason: 'Leave Reason',
                actions: 'Actions'
            };
            thead.innerHTML = selectedCols.map(col => `<th>${headerMap[col]}</th>`).join('');
        }
        
        this.attendanceData.forEach(record => {
            const row = document.createElement('tr');
            
            const date = new Date(record.attendance_date);
            const dayName = getDayName(record.attendance_date);
            const isSunday = date.getDay() === 0;
            if (isSunday) row.classList.add('sunday-row');
            
            const checkInTime = record.check_in_time ? utcToIst(record.check_in_time) : null;
            const checkOutTime = record.check_out_time ? utcToIst(record.check_out_time) : null;
            const isLate = checkInTime ? isLateCheckIn(record.check_in_time) : false;
            const isEarly = checkOutTime ? isEarlyCheckOut(record.check_out_time) : false;
            const workingHours = calculateWorkingHours(record.check_in_time, record.check_out_time);
            const isHoliday = this.holidays.some(h => h.holiday_date === record.attendance_date);
            const formattedDate = date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
            
            const cells = selectedCols.map(col => {
                switch(col) {
                    case 'date': return `<td class="date-col">${formattedDate}</td>`;
                    case 'day': return `<td class="day-col">${dayName} ${isHoliday ? '<i class="fas fa-gift" style="color: #ffc107;" title="Holiday"></i>' : ''}</td>`;
                    case 'user': return `<td>${this.userNames[record.user_email] || record.user_email.split('@')[0]}</td>`;
                    case 'status': return `<td><span class="status-badge status-${record.status}">${record.status.replace('_', ' ')}</span></td>`;
                    case 'checkin': return `<td class="${isLate ? 'time-late' : 'time-early'}">${checkInTime ? checkInTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>`;
                    case 'checkout': return `<td class="${isEarly ? 'time-late' : 'time-early'}">${checkOutTime ? checkOutTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>`;
                    case 'hours': return `<td>${workingHours}</td>`;
                    case 'beat': return `<td>${record.beat_route || '-'}</td>`;
                    case 'comments': return `<td>${record.comments || '-'}</td>`;
                    case 'leavereason': return `<td>${record.leave_reason || '-'}</td>`;
                    case 'actions': return record.id ? `<td><button class="view-btn" onclick="attendanceReport.viewDetails(${record.id})"><i class="fas fa-eye"></i></button></td>` : '<td>—</td>';
                    default: return '<td>-</td>';
                }
            }).join('');
            
            row.innerHTML = cells;
            tbody.appendChild(row);
        });
        
        const colDefs = [{ targets: '_all', orderable: true }];
        const actionsIndex = selectedCols.indexOf('actions');
        if (actionsIndex !== -1) {
            colDefs.push({ targets: actionsIndex, orderable: false });
        }
        
        this.dataTable = $('#attendanceTable').DataTable({
            responsive: true,
            pageLength: 50,
            lengthMenu: [[50, 100, -1], [50, 100, 'All']],
            order: [],
            columnDefs: colDefs,
            language: {
                search: "Search:",
                lengthMenu: "Show _MENU_ entries",
                info: "Showing _START_ to _END_ of _TOTAL_ entries",
                paginate: { first: "First", last: "Last", next: "Next", previous: "Previous" }
            }
        });
    }

    viewDetails(recordId) {
        const record = this.attendanceData.find(r => r.id === recordId);
        if (!record) return;
        
        const checkInTime = record.check_in_time ? utcToIst(record.check_in_time) : null;
        const checkOutTime = record.check_out_time ? utcToIst(record.check_out_time) : null;
        const date = new Date(record.attendance_date);
        
        const details = `
            <div style="padding: 15px; max-width: 500px;">
                <h3 style="color: #1e3c72; margin-bottom: 15px;">Attendance Details</h3>
                <p><strong>Date:</strong> ${date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })} (${getDayName(record.attendance_date)})</p>
                <p><strong>User:</strong> ${this.userNames[record.user_email] || record.user_email.split('@')[0]}</p>
                <p><strong>Status:</strong> <span class="status-badge status-${record.status}">${record.status.replace('_', ' ')}</span></p>
                ${record.distributors?.distributor_name ? `<p><strong>Distributor:</strong> ${record.distributors.distributor_name}</p>` : ''}
                ${record.beat_route ? `<p><strong>Beat Route:</strong> ${record.beat_route}</p>` : ''}
                ${checkInTime ? `<p><strong>Check In:</strong> ${checkInTime.toLocaleString('en-IN')}</p>` : ''}
                ${checkOutTime ? `<p><strong>Check Out:</strong> ${checkOutTime.toLocaleString('en-IN')}</p>` : ''}
                ${record.check_in_map_url ? `<p><strong>Location:</strong> <a href="${record.check_in_map_url}" target="_blank">View Map</a></p>` : ''}
                ${record.comments ? `<p><strong>Comments:</strong> ${record.comments}</p>` : ''}
                ${record.leave_reason ? `<p><strong>Leave Reason:</strong> ${record.leave_reason}</p>` : ''}
                ${record.check_in_photo_url ? `<p><strong>Photo:</strong> <a href="${record.check_in_photo_url}" target="_blank">View Photo</a></p>` : ''}
                ${record.check_out_photo_url ? `<p><strong>Check Out Photo:</strong> <a href="${record.check_out_photo_url}" target="_blank">View Photo</a></p>` : ''}
                <p><small>Submitted: ${record.submitted_at ? new Date(record.submitted_at).toLocaleString('en-IN') : 'Not submitted'}</small></p>
            </div>
        `;
        
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                title: 'Attendance Details',
                html: details,
                icon: 'info',
                confirmButtonColor: '#1e3c72',
                width: '600px'
            });
        } else {
            alert('Check console for details');
            console.log('Attendance Details:', record);
        }
    }

    async markHoliday() {
        const date = document.getElementById('holidayDate').value;
        const name = document.getElementById('holidayName').value;
        const desc = document.getElementById('holidayDesc').value;
        
        if (!date || !name) {
            alert('Please enter date and holiday name');
            return;
        }
        
        try {
            const { error } = await supabaseClient
                .from('holidays')
                .insert({
                    holiday_date: date,
                    holiday_name: name,
                    description: desc,
                    created_by_email: this.currentUser.email
                });
            
            if (error) throw error;
            
            alert('Holiday marked successfully!');
            
            document.getElementById('holidayDate').value = '';
            document.getElementById('holidayName').value = '';
            document.getElementById('holidayDesc').value = '';
            
            await this.loadHolidays();
            await this.loadAttendanceData();
            
        } catch (error) {
            console.error('Error marking holiday:', error);
            alert('Error: ' + error.message);
        }
    }

    async markUserLeave() {
        const userEmail = document.getElementById('leaveUserSelect').value;
        const date = document.getElementById('leaveUserDate').value;
        const status = document.getElementById('leaveUserStatus').value;
        const notes = document.getElementById('leaveUserNotes').value;
        
        if (!userEmail || !date) {
            alert('Please select user and date');
            return;
        }
        
        try {
            const { data: existing, error: existingError } = await supabaseClient
                .from('attendance_records')
                .select('id, check_in_time, check_out_time, status')
                .eq('user_email', userEmail)
                .eq('attendance_date', date)
                .limit(1)
                .maybeSingle();
            if (existingError) throw existingError;
            if (existing?.check_in_time) {
                throw new Error('This user already checked in. They cannot be marked absent or half day.');
            }
            if (existing) throw new Error('Attendance or leave is already marked for this user on this date.');
            let userId = userEmail;
            
            const { data: existingUser } = await supabaseClient
                .from('attendance_records')
                .select('user_id')
                .eq('user_email', userEmail)
                .limit(1)
                .maybeSingle();
            
            if (existingUser?.user_id) {
                userId = existingUser.user_id;
            }
            
            const attendanceData = {
                user_id: userId,
                user_email: userEmail,
                attendance_date: date,
                status: status,
                leave_from_date: date,
                leave_to_date: date,
                leave_reason: notes || `Marked as ${status} by admin`,
                is_draft: false,
                submitted_at: new Date().toISOString()
            };
            
            const { error } = await supabaseClient
                .from('attendance_records')
                .insert(attendanceData)
                .select();
            
            if (error) throw error;
            
            alert(`✅ ${status === 'leave' ? 'Leave' : 'Absent'} marked successfully for ${userEmail}!`);
            
            document.getElementById('leaveUserDate').value = '';
            document.getElementById('leaveUserNotes').value = '';
            
            await this.loadAttendanceData();
            
        } catch (error) {
            console.error('Error marking leave:', error);
            alert('Error: ' + error.message);
        }
    }

    exportToExcel() {
        if (!this.attendanceData.length) {
            alert('No attendance records are available to download.');
            return;
        }
        const selectedCols = Array.from(document.querySelectorAll('.column-toggle:checked')).map(cb => cb.value);
        
        const data = this.attendanceData.map(record => {
            const checkInTime = record.check_in_time ? utcToIst(record.check_in_time) : null;
            const checkOutTime = record.check_out_time ? utcToIst(record.check_out_time) : null;
            const workingHours = calculateWorkingHours(record.check_in_time, record.check_out_time);
            const date = new Date(record.attendance_date);
            const dayName = getDayName(record.attendance_date);
            
            const row = {};
            selectedCols.forEach(col => {
                switch(col) {
                    case 'date': row['Date'] = date.toLocaleDateString('en-IN'); break;
                    case 'day': row['Day'] = dayName; break;
                    case 'user': row['User'] = this.userNames[record.user_email] || record.user_email.split('@')[0]; break;
                    case 'status': row['Status'] = record.status; break;
                    case 'checkin': row['Check In'] = checkInTime ? checkInTime.toLocaleTimeString('en-IN') : '-'; break;
                    case 'checkout': row['Check Out'] = checkOutTime ? checkOutTime.toLocaleTimeString('en-IN') : '-'; break;
                    case 'hours': row['Hours'] = workingHours; break;
                    case 'beat': row['Beat Route'] = record.beat_route || '-'; break;
                    case 'comments': row['Comments'] = record.comments || '-'; break;
                    case 'leavereason': row['Leave Reason'] = record.leave_reason || '-'; break;
                }
            });
            return row;
        });
        
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
        
        const dateStr = new Date().toISOString().split('T')[0];
        const selectedUser = document.getElementById('userFilter')?.value || 'All_Users';
        const safeUser = selectedUser.replace(/[^a-z0-9@._-]+/gi, '_');
        XLSX.writeFile(wb, `K95_Attendance_${safeUser}_${dateStr}.xlsx`);
        
        alert('✅ Report exported successfully!');
    }

    resetFilters() {
        this.setCurrentMonthRange();
        
        const statusFilter = document.getElementById('statusFilter');
        if (statusFilter) statusFilter.value = '';
        
        const userFilter = document.getElementById('userFilter');
        if (userFilter) userFilter.value = '';
        
        this.loadAttendanceData();
    }

    applyQuickFilter(days) {
        const today = getISTDateParts();
        const from = new Date(Date.UTC(today.year, today.month - 1, today.day));
        from.setUTCDate(from.getUTCDate() - days);
        document.getElementById('dateFrom').value = toDateInputValue(from.getUTCFullYear(), from.getUTCMonth() + 1, from.getUTCDate());
        document.getElementById('dateTo').value = toDateInputValue(today.year, today.month, today.day);
        
        this.loadAttendanceData();
    }

    applyMonthFilter(monthType) {
        const today = getISTDateParts();
        let year = today.year;
        let month = today.month;
        
        if (monthType === 'last') {
            month -= 1;
            if (month < 1) {
                month = 12;
                year = year - 1;
            }
        }
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        document.getElementById('dateFrom').value = toDateInputValue(year, month, 1);
        document.getElementById('dateTo').value = toDateInputValue(year, month, lastDay);
        
        this.loadAttendanceData();
    }

    setupEventListeners() {
        const toggleFiltersBtn = document.getElementById('toggleFiltersBtn');
        if (toggleFiltersBtn) {
            toggleFiltersBtn.addEventListener('click', () => {
                const filtersBody = document.getElementById('filtersBody');
                const collapsed = filtersBody.classList.toggle('filters-collapsed');
                toggleFiltersBtn.setAttribute('aria-expanded', String(!collapsed));
                toggleFiltersBtn.querySelector('i').className = `fas fa-chevron-${collapsed ? 'down' : 'up'}`;
                toggleFiltersBtn.querySelector('span').textContent = collapsed ? 'Show' : 'Hide';
            });
        }
        document.getElementById('applyFiltersBtn').addEventListener('click', () => {
            this.loadAttendanceData();
        });
        
        document.getElementById('resetFiltersBtn').addEventListener('click', () => {
            this.resetFilters();
        });
        
        document.getElementById('exportExcelBtn').addEventListener('click', () => {
            this.exportToExcel();
        });
        
        const homeBtn = document.getElementById('homeBtn');
        if (homeBtn) {
            homeBtn.addEventListener('click', () => {
                window.location.href = '/salesk95/index.html';
            });
        }
        
        const markHolidayBtn = document.getElementById('markHolidayBtn');
        if (markHolidayBtn) {
            markHolidayBtn.addEventListener('click', () => {
                this.markHoliday();
            });
        }
        
        const markLeaveBtn = document.getElementById('markLeaveBtn');
        if (markLeaveBtn) {
            markLeaveBtn.addEventListener('click', () => {
                this.markUserLeave();
            });
        }
    }
}

// ============================================
// INITIALIZE
// ============================================
const attendanceReport = new K95AttendanceReport();
window.attendanceReport = attendanceReport;
