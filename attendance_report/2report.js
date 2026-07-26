// ============================================
// K95 FOODS - ATTENDANCE REPORT
// ============================================
console.log('✅ report.js loaded');

const SUPABASE_URL = 'https://jaasosewjbrwdklscxrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphYXNvc2V3amJyd2RrbHNjeHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMjAxMDEsImV4cCI6MjA4NTY5NjEwMX0.OE-dD6EN5DR3fvnaAd9jW3cJ7_5sYXNkY5vOQFQ00w0';

// Create Supabase client with proxy
const supabaseClient = window.supabase.createClient(
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

// ============================================
// HELPER FUNCTIONS
// ============================================
async function supabaseFetch(table, options = {}) {
    if (!supabaseClient) throw new Error('Supabase client not initialized');
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
        this.dataTable = null;
        
        this.init();
    }

    async init() {
        console.log('K95 Attendance Report - Initializing...');
        
        try {
            // Get the current user from session
            const { data: { session }, error } = await supabaseClient.auth.getSession();
            
            if (error || !session) {
                console.log('No active session, redirecting to login');
                window.location.href = '/salesk95/index.html';
                return;
            }
            
            // Set current user from session
            this.currentUser = {
                email: session.user.email,
                id: session.user.id
            };
            
            console.log('✅ User authenticated:', this.currentUser.email);
            
            // Get user role from access_manager
            await this.getUserRole();
            
            // Display user email in header
            document.getElementById('userEmail').textContent = this.currentUser.email;
            
            // Load distributors for filter
            await this.loadDistributors();
            
            // Set default date range (current month)
            this.setDefaultDateRange();
            
            // Load initial data
            await this.loadAttendanceData();
            
            // Setup event listeners
            this.setupEventListeners();
            
        } catch (error) {
            console.error('Init error:', error);
            alert('Failed to initialize: ' + error.message);
        }
    }

    async getUserRole() {
        try {
            const { data } = await supabaseClient
                .from('access_manager')
                .select('role_name')
                .eq('user_email', this.currentUser.email)
                .single();
            
            this.userRole = data?.role_name || 'user';
            
            // Display role badge
            const roleBadge = document.getElementById('userRole');
            if (roleBadge) {
                roleBadge.textContent = this.userRole.toUpperCase();
                roleBadge.style.background = this.userRole === 'admin' ? '#dc3545' : 
                                             this.userRole === 'nsm' ? '#fd7e14' : '#1e3c72';
            }
            
            // Show admin section for admin/nsm
            if (this.userRole === 'admin' || this.userRole === 'nsm') {
                document.getElementById('adminSection').style.display = 'block';
                await this.loadUsersForAdmin();
            }
            
            console.log('✅ User role:', this.userRole);
            
        } catch (error) {
            console.error('Error getting user role:', error);
            this.userRole = 'user';
        }
    }

    async loadDistributors() {
        try {
            let query = supabaseClient.from('distributors').select('distributor_id, distributor_name').eq('status', 'Active');
            
            // If not admin/nsm, filter by user's distributors
            if (this.userRole !== 'admin' && this.userRole !== 'nsm') {
                const { data: userDistributors } = await supabaseClient
                    .from('attendance_records')
                    .select('distributor_id')
                    .eq('user_email', this.currentUser.email)
                    .not('distributor_id', 'is', null);
                
                const distributorIds = [...new Set(userDistributors.map(d => d.distributor_id))];
                
                if (distributorIds.length > 0) {
                    query = query.in('distributor_id', distributorIds);
                }
            }
            
            const { data } = await query.order('distributor_name');
            
            this.distributorsList = data || [];
            
            const filterSelect = document.getElementById('distributorFilter');
            filterSelect.innerHTML = '<option value="">All Distributors</option>' +
                this.distributorsList.map(d => 
                    `<option value="${d.distributor_id}">${d.distributor_name}</option>`
                ).join('');
            
        } catch (error) {
            console.error('Error loading distributors:', error);
        }
    }

    async loadUsersForAdmin() {
        try {
            const { data } = await supabaseClient
                .from('attendance_records')
                .select('user_id, user_email')
                .order('user_email');
            
            const uniqueUsers = [...new Map(data.map(item => [item.user_id, item])).values()];
            
            const select = document.getElementById('leaveUserSelect');
            select.innerHTML = '<option value="">Select User</option>' +
                uniqueUsers.map(u => 
                    `<option value="${u.user_id}">${u.user_email}</option>`
                ).join('');
            
        } catch (error) {
            console.error('Error loading users:', error);
        }
    }

    setDefaultDateRange() {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        
        document.getElementById('dateFrom').value = firstDay.toISOString().split('T')[0];
        document.getElementById('dateTo').value = lastDay.toISOString().split('T')[0];
    }

    async loadAttendanceData() {
        try {
            // Show loading
            document.getElementById('tableBody').innerHTML = `
                <tr><td colspan="14" class="text-center">
                    <div class="loading-spinner"><div class="spinner"></div></div>
                </td></tr>
            `;
            
            // Build query
            let query = supabaseClient
                .from('attendance_records')
                .select(`
                    *,
                    distributors!left(distributor_name)
                `)
                .eq('is_draft', false)
                .order('attendance_date', { ascending: false });
            
            // Apply user filter (non-admin/nsm see only their own data)
            if (this.userRole !== 'admin' && this.userRole !== 'nsm') {
                query = query.eq('user_email', this.currentUser.email);
            }
            
            // Apply date filters
            const fromDate = document.getElementById('dateFrom').value;
            const toDate = document.getElementById('dateTo').value;
            
            if (fromDate) query = query.gte('attendance_date', fromDate);
            if (toDate) query = query.lte('attendance_date', toDate);
            
            // Apply distributor filter
            const distributorId = document.getElementById('distributorFilter').value;
            if (distributorId) query = query.eq('distributor_id', distributorId);
            
            // Apply status filter
            const status = document.getElementById('statusFilter').value;
            if (status) query = query.eq('status', status);
            
            // Apply area type filter
            const areaType = document.getElementById('areaTypeFilter').value;
            if (areaType) query = query.eq('area_type', areaType);
            
            const { data, error } = await query;
            
            if (error) throw error;
            
            this.attendanceData = data || [];
            
            // Apply day filter (client-side filtering)
            const dayFilter = document.getElementById('dayFilter').value;
            if (dayFilter !== '') {
                this.attendanceData = this.attendanceData.filter(record => {
                    const date = new Date(record.attendance_date);
                    return date.getDay().toString() === dayFilter;
                });
            }
            
            // Update summary cards
            this.updateSummaryCards();
            
            // Load holidays
            await this.loadHolidays();
            
            // Render table
            this.renderTable();
            
        } catch (error) {
            console.error('Error loading attendance data:', error);
            alert('Error loading data: ' + error.message);
        }
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

    renderTable() {
        if (this.dataTable) {
            this.dataTable.destroy();
        }
        
        const tbody = document.getElementById('tableBody');
        tbody.innerHTML = '';
        
        this.attendanceData.forEach(record => {
            const row = this.createTableRow(record);
            tbody.appendChild(row);
        });
        
        // Initialize DataTable
        this.dataTable = $('#attendanceTable').DataTable({
            responsive: true,
            pageLength: 25,
            order: [[1, 'desc']], // Sort by date descending
            language: {
                search: "Search:",
                lengthMenu: "Show _MENU_ entries",
                info: "Showing _START_ to _END_ of _TOTAL_ entries",
                paginate: {
                    first: "First",
                    last: "Last",
                    next: "Next",
                    previous: "Previous"
                }
            },
            columnDefs: [
                { targets: 13, orderable: false } // Actions column not sortable
            ]
        });
    }

    createTableRow(record) {
        const row = document.createElement('tr');
        
        const date = new Date(record.attendance_date);
        const dayName = getDayName(record.attendance_date);
        const isSunday = date.getDay() === 0;
        
        const checkInTime = record.check_in_time ? utcToIst(record.check_in_time) : null;
        const checkOutTime = record.check_out_time ? utcToIst(record.check_out_time) : null;
        
        const isLate = checkInTime ? isLateCheckIn(record.check_in_time) : false;
        const isEarly = checkOutTime ? isEarlyCheckOut(record.check_out_time) : false;
        
        const workingHours = calculateWorkingHours(record.check_in_time, record.check_out_time);
        
        const distributorName = record.distributors?.distributor_name || record.distributor_id || '-';
        
        const isHoliday = this.holidays.some(h => h.holiday_date === record.attendance_date);
        
        row.innerHTML = `
            <td>${isSunday ? 'Sunday' : dayName} ${isHoliday ? '<i class="fas fa-gift" style="color: #ffc107;"></i>' : ''}</td>
            <td>${formatDate(date)}</td>
            <td>${distributorName}</td>
            <td><span class="status-badge status-${record.status}">${record.status.replace('_', ' ')}</span></td>
            <td class="${isLate ? 'time-late' : 'time-early'}">${formatTime(checkInTime)}</td>
            <td class="${isEarly ? 'time-late' : 'time-early'}">${formatTime(checkOutTime)}</td>
            <td>${workingHours}</td>
            <td>${record.area_type || '-'}</td>
            <td>${record.beat_route || '-'}</td>
            <td>${record.expected_total_calls || 0}</td>
            <td>${record.expected_productive_calls || 0}</td>
            <td>${record.comments || '-'}</td>
            <td>${record.leave_reason || '-'}</td>
            <td>
                <button class="view-btn" onclick="attendanceReport.viewDetails(${record.id})">
                    <i class="fas fa-eye"></i>
                </button>
            </td>
        `;
        
        return row;
    }

    viewDetails(recordId) {
        const record = this.attendanceData.find(r => r.id === recordId);
        if (!record) return;
        
        const details = `
            <div style="padding: 15px;">
                <h4>Attendance Details - ${formatDate(new Date(record.attendance_date))}</h4>
                <hr>
                <p><strong>User:</strong> ${record.user_email}</p>
                <p><strong>Status:</strong> ${record.status}</p>
                ${record.distributor_id ? `<p><strong>Distributor:</strong> ${record.distributors?.distributor_name || record.distributor_id}</p>` : ''}
                ${record.beat_route ? `<p><strong>Beat Route:</strong> ${record.beat_route}</p>` : ''}
                ${record.area_type ? `<p><strong>Area Type:</strong> ${record.area_type}</p>` : ''}
                ${record.check_in_time ? `<p><strong>Check In:</strong> ${utcToIst(record.check_in_time).toLocaleString('en-IN')}</p>` : ''}
                ${record.check_out_time ? `<p><strong>Check Out:</strong> ${utcToIst(record.check_out_time).toLocaleString('en-IN')}</p>` : ''}
                ${record.check_in_map_url ? `<p><strong>Location:</strong> <a href="${record.check_in_map_url}" target="_blank">View Map</a></p>` : ''}
                ${record.comments ? `<p><strong>Comments:</strong> ${record.comments}</p>` : ''}
                ${record.leave_reason ? `<p><strong>Leave Reason:</strong> ${record.leave_reason}</p>` : ''}
                ${record.check_in_photo_url ? `<p><strong>Photo:</strong> <a href="${record.check_in_photo_url}" target="_blank">View</a></p>` : ''}
                ${record.check_out_photo_url ? `<p><strong>Check Out Photo:</strong> <a href="${record.check_out_photo_url}" target="_blank">View</a></p>` : ''}
            </div>
        `;
        
        // You can use SweetAlert or a modal here
        alert('Check console for details'); // Temporary - replace with modal
        console.log(record);
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
            
            // Clear form
            document.getElementById('holidayDate').value = '';
            document.getElementById('holidayName').value = '';
            document.getElementById('holidayDesc').value = '';
            
            // Reload holidays
            await this.loadHolidays();
            await this.loadAttendanceData(); // Refresh table with holiday indicators
            
        } catch (error) {
            console.error('Error marking holiday:', error);
            alert('Error: ' + error.message);
        }
    }

    async markUserLeave() {
        const userId = document.getElementById('leaveUserSelect').value;
        const date = document.getElementById('leaveUserDate').value;
        const status = document.getElementById('leaveUserStatus').value;
        const notes = document.getElementById('leaveUserNotes').value;
        
        if (!userId || !date) {
            alert('Please select user and date');
            return;
        }
        
        try {
            // Get user email
            const { data: userData } = await supabaseClient
                .from('attendance_records')
                .select('user_email')
                .eq('user_id', userId)
                .limit(1)
                .single();
            
            const attendanceData = {
                user_id: userId,
                user_email: userData?.user_email || 'unknown',
                attendance_date: date,
                status: status,
                leave_from_date: date,
                leave_to_date: date,
                leave_reason: notes || 'Marked by admin',
                is_draft: false,
                submitted_at: new Date().toISOString()
            };
            
            const { error } = await supabaseClient
                .from('attendance_records')
                .insert(attendanceData);
            
            if (error) throw error;
            
            alert('Leave marked successfully!');
            
            // Clear form
            document.getElementById('leaveUserDate').value = '';
            document.getElementById('leaveUserNotes').value = '';
            
            // Reload data
            await this.loadAttendanceData();
            
        } catch (error) {
            console.error('Error marking leave:', error);
            alert('Error: ' + error.message);
        }
    }

    exportToExcel() {
        const data = this.attendanceData.map(record => {
            const checkInTime = record.check_in_time ? utcToIst(record.check_in_time) : null;
            const checkOutTime = record.check_out_time ? utcToIst(record.check_out_time) : null;
            const workingHours = calculateWorkingHours(record.check_in_time, record.check_out_time);
            const date = new Date(record.attendance_date);
            
            return {
                'Day': getDayName(record.attendance_date),
                'Date': formatDate(date),
                'User': record.user_email,
                'Distributor': record.distributors?.distributor_name || record.distributor_id || '-',
                'Status': record.status,
                'Check In': formatTime(checkInTime),
                'Check Out': formatTime(checkOutTime),
                'Hours': workingHours,
                'Area Type': record.area_type || '-',
                'Beat Route': record.beat_route || '-',
                'Expected Calls': record.expected_total_calls || 0,
                'Productive Calls': record.expected_productive_calls || 0,
                'Comments': record.comments || '-',
                'Leave Reason': record.leave_reason || '-',
                'Late Check In': checkInTime ? (isLateCheckIn(record.check_in_time) ? 'Yes' : 'No') : '-',
                'Early Check Out': checkOutTime ? (isEarlyCheckOut(record.check_out_time) ? 'Yes' : 'No') : '-'
            };
        });
        
        // Create worksheet
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
        
        // Generate filename with current date
        const dateStr = new Date().toISOString().split('T')[0];
        XLSX.writeFile(wb, `K95_Attendance_Report_${dateStr}.xlsx`);
        
        alert('✅ Report exported successfully!');
    }

    resetFilters() {
        this.setDefaultDateRange();
        document.getElementById('distributorFilter').value = '';
        document.getElementById('statusFilter').value = '';
        document.getElementById('areaTypeFilter').value = '';
        document.getElementById('dayFilter').value = '';
        
        this.loadAttendanceData();
    }

    applyQuickFilter(days) {
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(toDate.getDate() - days);
        
        document.getElementById('dateFrom').value = fromDate.toISOString().split('T')[0];
        document.getElementById('dateTo').value = toDate.toISOString().split('T')[0];
        
        this.loadAttendanceData();
    }

    applyMonthFilter(monthType) {
        const today = new Date();
        let year = today.getFullYear();
        let month = today.getMonth();
        
        if (monthType === 'last') {
            month = month - 1;
            if (month < 0) {
                month = 11;
                year = year - 1;
            }
        }
        
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        
        document.getElementById('dateFrom').value = firstDay.toISOString().split('T')[0];
        document.getElementById('dateTo').value = lastDay.toISOString().split('T')[0];
        
        this.loadAttendanceData();
    }

    setupEventListeners() {
        // Filter buttons
        document.getElementById('applyFiltersBtn').addEventListener('click', () => {
            this.loadAttendanceData();
        });
        
        document.getElementById('resetFiltersBtn').addEventListener('click', () => {
            this.resetFilters();
        });
        
        document.getElementById('exportExcelBtn').addEventListener('click', () => {
            this.exportToExcel();
        });
        
        // Quick filters
        document.querySelectorAll('.quick-filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const days = e.target.dataset.days;
                const month = e.target.dataset.month;
                
                if (days) {
                    this.applyQuickFilter(parseInt(days));
                } else if (month === 'current') {
                    this.applyMonthFilter('current');
                } else if (month === 'last') {
                    this.applyMonthFilter('last');
                }
            });
        });
        
        // Admin actions
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
        
        // Logout
        document.getElementById('logoutBtn').addEventListener('click', () => {
            supabaseClient.auth.signOut().then(() => {
                window.location.href = '/salesk95/index.html';
            });
        });
    }
}

// ============================================
// INITIALIZE
// ============================================
const attendanceReport = new K95AttendanceReport();
window.attendanceReport = attendanceReport;