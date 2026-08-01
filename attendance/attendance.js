// ============================================================
//  K95 FOODS – ATTENDANCE SYSTEM v3.2
//  Fixed: IST timestamps with +05:30 offset, no calls fields,
//         robust state resolution after reload,
//         cache-resilient fallback query
// ============================================================
'use strict';
console.log('✅ attendance.js v3.2 loaded');

/* ─────────────────────────────────────────────────────────
   CONFIGURATION
───────────────────────────────────────────────────────── */
const CONFIG = {
    SUPABASE_URL:      'https://jaasosewjbrwdklscxrn.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphYXNvc2V3amJyd2RrbHNjeHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMjAxMDEsImV4cCI6MjA4NTY5NjEwMX0.OE-dD6EN5DR3fvnaAd9jW3cJ7_5sYXNkY5vOQFQ00w0',
    WA_PHONE_NUMBER_ID: '',
    WA_ACCESS_TOKEN:    '',
    WA_GROUP_NUMBERS:   [],
};

const STATE = {
    LOADING:    'LOADING',
    CHECK_IN:   'CHECK_IN',
    CHECKED_IN: 'CHECKED_IN',
    COMPLETED:  'COMPLETED',
    LEAVE_FORM: 'LEAVE_FORM',
    LEAVE_DONE: 'LEAVE_DONE',
};

/* ─────────────────────────────────────────────────────────
   SUPABASE BOOTSTRAP (with proxy)
───────────────────────────────────────────────────────── */
let supabaseClient = null;

(function initSupabase() {
    if (typeof window.supabase === 'undefined') {
        alert('Supabase library failed to load. Please refresh.');
        return;
    }
    supabaseClient = window.supabase.createClient(
        CONFIG.SUPABASE_URL,
        CONFIG.SUPABASE_ANON_KEY,
        {
            auth: { persistSession: true, autoRefreshToken: true },
            global: {
                fetch: async (url, options) => {
                    const parsed  = new URL(url);
                    const isAuth    = parsed.pathname.startsWith('/auth/v1/');
                    const isStorage = parsed.pathname.startsWith('/storage/v1/');
                    const prefix    = isAuth ? '/auth/v1/' : isStorage ? '/storage/v1/' : '/rest/v1/';
                    const apiPath   = parsed.pathname.replace(prefix, '');
                    const proxy   = new URL('/salesk95/proxy.php', window.location.origin);
                    proxy.searchParams.set('type', isAuth ? 'auth' : isStorage ? 'storage' : 'rest');
                    proxy.searchParams.set('path', apiPath);
                    new URLSearchParams(parsed.search).forEach((v, k) => proxy.searchParams.append(k, v));
                    // Force no-cache on proxy requests
                    options.headers = options.headers || {};
                    options.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
                    return fetch(proxy.toString(), options);
                }
            }
        }
    );
    console.log('✅ Supabase client ready');
})();

/* ─────────────────────────────────────────────────────────
   TIME UTILITIES – CORRECT IST (+05:30)
───────────────────────────────────────────────────────── */
function nowIST() {
    const now = new Date();
    const offsetMs = 5.5 * 60 * 60 * 1000; // IST = UTC + 5:30
    const istDate = new Date(now.getTime() + offsetMs);
    const iso = istDate.toISOString().replace('Z', '+05:30');
    const display = now.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
    return { iso, display };
}

function todayIST() {
    const now = new Date();
    const offsetMs = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + offsetMs);
    return istDate.toISOString().slice(0, 10);
}

function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: true, timeZone: 'Asia/Kolkata'
    });
}

function calcDuration(isoIn, isoOut) {
    if (!isoIn || !isoOut) return '—';
    const inDate = new Date(isoIn);
    const outDate = new Date(isoOut);
    if (isNaN(inDate) || isNaN(outDate)) return '—';
    const diff = Math.floor((outDate - inDate) / 1000);
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return `${h}h ${m}m`;
}

/* ─────────────────────────────────────────────────────────
   GEOLOCATION
───────────────────────────────────────────────────────── */
async function getPosition(retries = 4) {
    for (let i = 1; i <= retries; i++) {
        try {
            return await new Promise((res, rej) =>
                navigator.geolocation.getCurrentPosition(res, rej, {
                    enableHighAccuracy: true, timeout: 12000, maximumAge: 0
                })
            );
        } catch (e) {
            if (i === retries) throw e;
            await new Promise(r => setTimeout(r, 1200 * i));
        }
    }
}

async function geocode(lat, lng) {
    try {
        const r = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
        );
        const d = await r.json();
        return [d.locality, d.city || d.town, d.principalSubdivision]
            .filter(Boolean).join(', ')
            || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } catch {
        return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
}

/* ─────────────────────────────────────────────────────────
   DB HELPERS
───────────────────────────────────────────────────────── */
async function dbInsert(table, row) {
    const { data, error } = await supabaseClient.from(table).insert([row]).select();
    if (error) throw error;
    return data[0];
}

async function dbUpdate(table, patch, filters = {}) {
    let q = supabaseClient.from(table).update(patch);
    Object.entries(filters).forEach(([k, v]) => { q = q.eq(k, v); });
    const { data, error } = await q.select();
    if (error) throw error;
    return data[0];
}

/* ─────────────────────────────────────────────────────────
   PHOTO UPLOAD
───────────────────────────────────────────────────────── */
async function uploadPhoto(file) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.access_token) throw new Error('Your session has expired. Please sign in again.');
    const response = await fetch('/salesk95/api/attendance-images', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': file.type || 'image/jpeg'
        },
        body: file
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Unable to save attendance selfie.');
    return result.url;
}

/* ─────────────────────────────────────────────────────────
   WHATSAPP NOTIFICATION (optional)
───────────────────────────────────────────────────────── */
async function sendWhatsAppNotification(type, payload) {
    if (!CONFIG.WA_PHONE_NUMBER_ID || !CONFIG.WA_ACCESS_TOKEN || !CONFIG.WA_GROUP_NUMBERS.length) {
        console.log('WhatsApp not configured — skipping');
        return;
    }
    const messages = {
        check_in:  `✅ *Check-In*\n👤 ${payload.name}\n🕐 ${payload.time}\n📍 ${payload.location}\n🏢 ${payload.distributor}\n🗺 Route: ${payload.route || 'N/A'}`,
        check_out: `🔴 *Check-Out*\n👤 ${payload.name}\n🕐 ${payload.time}\n📍 ${payload.location}\n⏱ Duration: ${payload.duration}`,
        leave:     `📋 *Leave Request*\n👤 ${payload.name}\n📅 ${payload.fromDate} → ${payload.toDate}\n🏷 Type: ${payload.leaveType}\n📝 ${payload.reason || 'No reason given'}`,
        half_day:  `⚠️ *Half-Day*\n👤 ${payload.name}\n📅 ${payload.date}\n📝 ${payload.reason || 'No reason given'}`,
    };
    const body = messages[type];
    if (!body) return;
    const url = `https://graph.facebook.com/v19.0/${CONFIG.WA_PHONE_NUMBER_ID}/messages`;
    await Promise.allSettled(
        CONFIG.WA_GROUP_NUMBERS.map(to =>
            fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${CONFIG.WA_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to: to.replace(/\D/g, ''),
                    type: 'text',
                    text: { body }
                })
            }).catch(e => console.warn('WA failed:', to, e))
        )
    );
}

/* ═══════════════════════════════════════════════════════════
   MAIN APP CLASS
═══════════════════════════════════════════════════════════ */
class AttendanceApp {
    constructor() {
        this.user              = null;
        this.distributors      = [];
        this.currentRecord     = null;
        this.currentState      = STATE.LOADING;
        this.submitting        = false;
        this.clockInterval     = null;
        this._ciTimeFrozen     = false;
        this._coTimeFrozen     = false;
        this.checkInPhotoFile  = null;
        this.checkOutPhotoFile = null;
        this.checkInLatLng     = null;
        this.checkOutLatLng    = null;
        this.checkInRecordId   = null; // fallback cache
    }

    /* ──────────────────────────────────────
       INIT
    ────────────────────────────────────── */
    async init() {
        this.startClock();
        this.bindStaticEvents();

        if (!supabaseClient) {
            this.msg('Supabase unavailable. Refresh the page.', 'error');
            return;
        }

        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) { window.location.href = '/salesk95/index.html'; return; }

        this.user = { id: session.user.id, email: session.user.email };
        document.getElementById('userEmail').textContent = this.user.email;

        await this.loadDistributors();
        this.renderUserAvatar();
        const dailyPermission = this.access?.tile_permissions?.daily_attendance?.access;
        const reportPermission = this.access?.tile_permissions?.attendance_report?.access;
        if ((!dailyPermission || dailyPermission === 'none') && (!reportPermission || reportPermission === 'none')) {
            this.msg('You do not have access to Attendance.', 'error'); return;
        }
        const hasDailyAccess = Boolean(dailyPermission && dailyPermission !== 'none');
        document.querySelectorAll('.tab-pill[data-tab="present"],.tab-pill[data-tab="leave"],.tab-pill[data-tab="history"]')
            .forEach(tab => tab.classList.toggle('hidden', !hasDailyAccess));
        const canReport = ['admin','nsm'].includes(String(this.access?.role_name||'').toLowerCase()) || (reportPermission && reportPermission !== 'none');
        document.getElementById('reportTabBtn')?.classList.toggle('hidden', !canReport);
        await this.resolveState();
        if (!hasDailyAccess && canReport) this.handleTabClick('report');
    }

    /* ──────────────────────────────────────
       CLOCK (live IST)
    ────────────────────────────────────── */
    startClock() {
        const clockEl = document.getElementById('liveClock');
        const dateEl  = document.getElementById('liveDate');

        const tick = () => {
            const now = new Date();
            const timeStr = now.toLocaleTimeString('en-IN', {
                timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
            });
            const dateStr = now.toLocaleDateString('en-IN', {
                timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
            });
            clockEl.textContent = timeStr;
            dateEl.textContent = dateStr;

            if (!this._ciTimeFrozen) {
                const el = document.getElementById('checkInTimeDisplay');
                if (el) el.textContent = timeStr;
            }
            if (!this._coTimeFrozen) {
                const el = document.getElementById('checkOutTimeDisplay');
                if (el) el.textContent = timeStr;
            }
        };
        tick();
        this.clockInterval = setInterval(tick, 1000);
    }

    freezeCheckInTime() {
        this._ciTimeFrozen = true;
        const t = nowIST();
        const d = document.getElementById('checkInTimeDisplay');
        const i = document.getElementById('checkInTimeISO');
        if (d) d.textContent = t.display;
        if (i) i.value = t.iso;
        return t;
    }

    freezeCheckOutTime() {
        this._coTimeFrozen = true;
        const t = nowIST();
        const d = document.getElementById('checkOutTimeDisplay');
        const i = document.getElementById('checkOutTimeISO');
        if (d) d.textContent = t.display;
        if (i) i.value = t.iso;
        return t;
    }

    /* ──────────────────────────────────────
       LOAD DISTRIBUTORS
    ────────────────────────────────────── */
    async loadDistributors() {
        try {
            const { data: access } = await supabaseClient
                .from('access_manager')
                .select('full_name, avatar_url, role_name, distributor_ids, tile_permissions')
                .ilike('user_email', this.user.email)
                .maybeSingle();

            this.access = access || {};
            const isAdmin = ['admin', 'nsm'].includes(String(access?.role_name||'').toLowerCase());
            const allowed = isAdmin ? [] : (access?.distributor_ids || []);
            if (!isAdmin && allowed.length === 0) {
                this.distributors=[];
                document.getElementById('workDistributor').innerHTML='<option value="">No distributors assigned</option>';
                return;
            }

            let q = supabaseClient
                .from('distributors')
                .select('distributor_id, distributor_name')
                .eq('status', 'Active')
                .order('distributor_name');
            if (allowed.length > 0) q = q.in('distributor_id', allowed);

            const { data: list, error } = await q;
            if (error) throw error;

            this.distributors = list || [];
            const sel = document.getElementById('workDistributor');
            sel.innerHTML = '<option value="">Select your distributor…</option>' +
                this.distributors.map(d =>
                    `<option value="${d.distributor_id}">${d.distributor_name}</option>`
                ).join('');
        } catch (e) {
            console.error('loadDistributors:', e);
            this.msg('Could not load distributors.', 'error');
        }
    }

    /* ══════════════════════════════════════════════
       STATE MACHINE – no DB join, fallback, cache-resistant
    ══════════════════════════════════════════════ */
    renderUserAvatar() {
        const avatar = document.getElementById('userAvatar');
        if (!avatar) return;
        const name = String(this.access?.full_name || '').trim() || this.user.email.split('@')[0];
        const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'K9';
        avatar.textContent = initials;
        document.getElementById('userEmailDisplay').title = name;
        if (!this.access?.avatar_url) return;
        try {
            const url = new URL(this.access.avatar_url, window.location.origin);
            if (url.protocol !== 'https:' && url.origin !== window.location.origin) return;
            const image = document.createElement('img');
            image.src = url.href;
            image.alt = `${name} profile photo`;
            image.referrerPolicy = 'no-referrer';
            image.onerror = () => { avatar.textContent = initials; };
            avatar.replaceChildren(image);
        } catch (error) {
            console.warn('Invalid profile photo URL:', error);
        }
    }

    async resolveState() {
        this.currentState = STATE.LOADING;
        this.showPanel('panelLoading');

        const today = todayIST();
        console.log('[resolveState] date=%s user=%s', today, this.user?.email);

        try {
            let { data: rows, error } = await supabaseClient
                .from('attendance_records')
                .select('*')
                .eq('user_email', this.user.email)
                .eq('attendance_date', today)
                .order('created_at', { ascending: false });

            if (error) throw error;
            console.log('[resolveState] rows=', rows);

            let rec = this._pickBestRecord(rows || []);

            // Fallback: if no record but we have a cached ID from earlier session
            if (!rec && this.checkInRecordId) {
                const { data: fallback } = await supabaseClient
                    .from('attendance_records')
                    .select('*')
                    .eq('id', this.checkInRecordId)
                    .single();
                if (fallback && fallback.attendance_date === today) rec = fallback;
            }

            if (rec?.distributor_id) {
                const match = this.distributors.find(d => d.distributor_id === rec.distributor_id);
                rec.distributor_name = match?.distributor_name || rec.distributor_id;
            }

            this.currentRecord = rec;
            console.log('[resolveState] best record=', rec);

            if (!rec) {
                this.renderState(STATE.CHECK_IN);
                return;
            }
            if (['leave', 'absent', 'halfday', 'half_day'].includes(rec.status)) {
                this.renderState(STATE.LEAVE_DONE);
                return;
            }
            if (rec.check_in_time && rec.check_out_time) {
                this.renderState(STATE.COMPLETED);
                return;
            }
            if (rec.check_in_time && !rec.check_out_time) {
                this.renderState(STATE.CHECKED_IN);
                return;
            }
            this.renderState(STATE.CHECK_IN);
        } catch (e) {
            console.error('[resolveState] error:', e);
            this.msg('Failed to load attendance: ' + e.message, 'error');
            this.showPanel('panelLoading');
        }
    }

    _pickBestRecord(rows) {
        if (!rows || rows.length === 0) return null;
        const score = r => {
            if (r.check_in_time && r.check_out_time) return 5;
            if (['leave','absent','halfday','half_day'].includes(r.status)) return 4;
            if (r.check_in_time) return 3;
            return 0;
        };
        return rows.reduce((best, r) => score(r) > score(best) ? r : best, rows[0]);
    }

    /* ──────────────────────────────────────
       RENDER STATE
    ────────────────────────────────────── */
    renderState(state) {
        this.currentState = state;
        const rec = this.currentRecord;
        console.log('[renderState]', state, rec);

        switch (state) {
            case STATE.CHECK_IN:
                this._ciTimeFrozen = false;
                this.updateStatusBadge('pending');
                this._setTabsUI('present', {});
                this.showPanel('panelCheckIn');
                break;
            case STATE.CHECKED_IN:
                this._coTimeFrozen = false;
                this.updateStatusBadge('checkedin');
                this._setTabsUI('present', {});
                document.getElementById('checkInSummaryContent').innerHTML =
                    this._buildCheckInSummaryHTML(rec);
                document.getElementById('btnMarkLeaveAfterCheckIn').style.display = 'none';
                document.querySelector('.tab-pill[data-tab="leave"]')?.classList.add('tab-disabled');
                this.showPanel('panelCheckOut');
                break;
            case STATE.COMPLETED:
                this.updateStatusBadge('done');
                this._setTabsUI('present', { leaveDisabled: true });
                document.getElementById('completedSummaryContent').innerHTML =
                    this._buildFullSummaryHTML(rec);
                this.showPanel('panelCompleted');
                break;
            case STATE.LEAVE_FORM:
                this.updateStatusBadge('leave');
                this._setTabsUI('leave', { presentDisabled: !!rec?.check_in_time });
                this._resetLeaveForm();
                this.showPanel('panelLeave');
                break;
            case STATE.LEAVE_DONE:
                this.updateStatusBadge('leave');
                this._setTabsUI('leave', { presentDisabled: true });
                document.getElementById('leaveSummaryContent').innerHTML =
                    this._buildLeaveSummaryHTML(rec);
                this.showPanel('panelLeaveCompleted');
                break;
            default:
                this.showPanel('panelLoading');
        }
    }

    showPanel(id) {
        const panels = ['panelLoading','panelCheckIn','panelCheckOut','panelCompleted','panelLeave','panelLeaveCompleted','panelHistory','panelReport'];
        panels.forEach(p => {
            const el = document.getElementById(p);
            if (el) el.classList.add('hidden');
        });
        const target = document.getElementById(id);
        if (target) target.classList.remove('hidden');
        else console.warn('[showPanel] panel not found:', id);
    }

    _setTabsUI(activeTab, opts) {
        document.querySelectorAll('.tab-pill').forEach(b => {
            b.classList.remove('active', 'tab-disabled');
            b.classList.toggle('active', b.dataset.tab === activeTab);
        });
        if (opts.leaveDisabled) {
            document.querySelector('.tab-pill[data-tab="leave"]')?.classList.add('tab-disabled');
        }
        if (opts.presentDisabled) {
            document.querySelector('.tab-pill[data-tab="present"]')?.classList.add('tab-disabled');
        }
    }

    handleTabClick(tab) {
        const btn = document.querySelector(`.tab-pill[data-tab="${tab}"]`);
        if (btn?.classList.contains('tab-disabled')) {
            this.msg('This tab is not available right now.', 'error');
            return;
        }
        if (tab === 'history') {
            this._setTabsUI('history', {}); this.showPanel('panelHistory'); this.loadMyHistory(); return;
        }
        if (tab === 'report') {
            if (document.getElementById('reportTabBtn')?.classList.contains('hidden')) return;
            this._setTabsUI('report', {}); this.showPanel('panelReport');
            const frame=document.getElementById('attendanceReportFrame'); if(frame&&!frame.src)frame.src='../attendance_report/attendance_report.html?embedded=1'; return;
        }
        if (tab === 'present') {
            if (this.currentState === STATE.LEAVE_DONE) {
                this.msg('Leave is already submitted for today.', 'error'); return;
            }
            this.resolveState();
        } else {
            if (this.currentState === STATE.COMPLETED) {
                this.msg('Attendance is complete for today.', 'error'); return;
            }
            this.renderState(STATE.LEAVE_FORM);
        }
    }

    updateStatusBadge(state) {
        const el  = document.getElementById('statusBadge');
        const map = {
            pending:   { cls: 'badge-pending',   icon: 'fa-clock',          text: 'Not Marked' },
            checkedin: { cls: 'badge-checkedin',  icon: 'fa-sign-in-alt',    text: 'Checked In' },
            done:      { cls: 'badge-done',        icon: 'fa-circle-check',   text: 'Completed'  },
            leave:     { cls: 'badge-leave',       icon: 'fa-umbrella-beach', text: 'On Leave'   },
        };
        const s = map[state] || map.pending;
        el.className = `status-badge ${s.cls}`;
        el.innerHTML = `<i class="fas ${s.icon}"></i> ${s.text}`;
    }

    /* ──────────────────────────────────────
       LOCATION DETECTION
    ────────────────────────────────────── */
    async detectLocation(type) {
        const capType = type.charAt(0).toUpperCase() + type.slice(1);
        const btn     = document.getElementById(`detect${capType}Location`);
        const input   = document.getElementById(`${type}Location`);
        const hidden  = document.getElementById(`${type}MapUrl`);
        const status  = document.getElementById(`${type}LocationStatus`);

        btn.classList.add('detecting');
        btn.disabled = true;
        if (status) status.textContent = '🔍 Detecting your location…';

        try {
            const pos = await getPosition();
            const { latitude: lat, longitude: lng } = pos.coords;
            const mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
            const addr   = await geocode(lat, lng);

            input.value  = addr;
            hidden.value = mapUrl;
            if (type === 'checkIn') this.checkInLatLng  = { lat, lng };
            else                     this.checkOutLatLng = { lat, lng };

            if (status) status.textContent = `📍 ${addr}`;
            this.msg('Location captured!', 'success');
        } catch (e) {
            console.warn('Location error:', e);
            if (status) status.textContent = '❌ Could not detect. Allow location access and retry.';
            this.msg('Location detection failed. Check browser permissions.', 'error');
        } finally {
            btn.classList.remove('detecting');
            btn.disabled = false;
        }
    }

    /* ──────────────────────────────────────
       PHOTO
    ────────────────────────────────────── */
    setupPhoto(type) {
        const zone        = document.getElementById(`${type}PhotoZone`);
        const fileInput   = document.getElementById(`${type}Photo`);
        const placeholder = document.getElementById(`${type}PhotoPlaceholder`);
        const preview     = document.getElementById(`${type}PhotoPreview`);

        zone.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 8 * 1024 * 1024) {
                this.msg('Photo too large (max 8 MB).', 'error');
                fileInput.value = '';
                return;
            }
            if (type === 'checkIn') this.checkInPhotoFile = file;
            else                     this.checkOutPhotoFile = file;

            const reader = new FileReader();
            reader.onload = ev => {
                placeholder.style.display = 'none';
                preview.classList.remove('hidden');
                preview.innerHTML = `
                    <img src="${ev.target.result}" alt="selfie">
                    <button class="remove-photo" title="Remove"
                        onclick="app.removePhoto('${type}')">×</button>`;
            };
            reader.readAsDataURL(file);
        });
    }

    removePhoto(type) {
        document.getElementById(`${type}Photo`).value = '';
        document.getElementById(`${type}PhotoPreview`).innerHTML = '';
        document.getElementById(`${type}PhotoPreview`).classList.add('hidden');
        document.getElementById(`${type}PhotoPlaceholder`).style.display = '';
        if (type === 'checkIn') this.checkInPhotoFile = null;
        else this.checkOutPhotoFile = null;
    }

    /* ──────────────────────────────────────
       LEAVE HELPERS
    ────────────────────────────────────── */
    _setupLeaveToday() {
        document.getElementById('leaveToday').addEventListener('change', e => {
            const today = todayIST();
            const from  = document.getElementById('leaveFromDate');
            const to    = document.getElementById('leaveToDate');
            if (e.target.checked) {
                from.value = today; to.value = today;
                from.disabled = true; to.disabled = true;
            } else {
                from.value = ''; to.value = '';
                from.disabled = false; to.disabled = false;
            }
        });
    }

    _resetLeaveForm() {
        document.getElementById('leaveFromDate').value    = '';
        document.getElementById('leaveToDate').value      = '';
        document.getElementById('leaveReason').value      = '';
        document.getElementById('leaveToday').checked     = false;
        document.getElementById('leaveFromDate').disabled = false;
        document.getElementById('leaveToDate').disabled   = false;
        document.querySelectorAll('input[name="leaveType"]').forEach(r => {
            r.checked = r.value === 'leave';
        });
        if (this.currentRecord?.check_in_time) this.msg('You already checked in today. Attendance cannot be changed to half day or absent.', 'error');
    }

    /* ──────────────────────────────────────
       SUBMIT CHECK-IN (no calls fields)
    ────────────────────────────────────── */
    async submitCheckIn() {
        if (this.submitting) return;
        if (this.currentState === STATE.CHECKED_IN) {
            this.msg('Already checked in today. Please check out.', 'error'); return;
        }
        if (this.currentState === STATE.COMPLETED) {
            this.msg('Attendance already complete for today.', 'error'); return;
        }
        if (this.currentState === STATE.LEAVE_DONE) {
            this.msg('Leave already submitted for today.', 'error'); return;
        }

        const distributor = document.getElementById('workDistributor').value.trim();
        const beatRoute   = document.getElementById('beatRoute').value.trim();
        const comments    = document.getElementById('checkInComments').value.trim();
        const mapUrl      = document.getElementById('checkInMapUrl').value;
        const locationTxt = document.getElementById('checkInLocation').value;

        if (!distributor) {
            this.msg('Please select a distributor.', 'error');
            document.getElementById('workDistributor').focus(); return;
        }
        if (!this.checkInPhotoFile) {
            this.msg('Please take a selfie before checking in.', 'error'); return;
        }
        if (!mapUrl) {
            this.msg('Please capture your location before checking in.', 'error'); return;
        }

        const ok = await this._confirm(
            'Confirm Check-In',
            `Check in now at ${nowIST().display}?`
        );
        if (!ok) return;

        this.submitting = true;
        const btn = document.getElementById('btnCheckIn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

        try {
            const { data: existing } = await supabaseClient.from('attendance_records').select('id,check_in_time,status').eq('user_email',this.user.email).eq('attendance_date',todayIST()).limit(1).maybeSingle();
            if (existing) throw new Error('Attendance has already been marked for today.');
            const ts = this.freezeCheckInTime();
            const photoUrl = await uploadPhoto(this.checkInPhotoFile);

            const rec = await dbInsert('attendance_records', {
                user_id:            this.user.id,
                user_email:         this.user.email,
                attendance_date:    todayIST(),
                status:             'present',
                distributor_id:     distributor,
                beat_route:         beatRoute || null,
                check_in_time:      ts.iso,
                check_in_map_url:   mapUrl,
                check_in_location:  locationTxt || null,
                check_in_photo_url: photoUrl,
                comments:           comments || null,
                is_draft:           false,
                submitted_at:       new Date().toISOString()
            });

            const match = this.distributors.find(d => d.distributor_id === distributor);
            rec.distributor_name = match?.distributor_name || distributor;
            this.currentRecord = rec;
            this.checkInRecordId = rec.id;

            await sendWhatsAppNotification('check_in', {
                name: this.user.email, time: ts.display,
                location: locationTxt, distributor: rec.distributor_name,
                route: beatRoute
            });

            this.msg('✅ Checked in successfully!', 'success');
            this.renderState(STATE.CHECKED_IN);
        } catch (e) {
            console.error('submitCheckIn error:', e);
            this.msg('Check-in failed: ' + e.message, 'error');
            this._ciTimeFrozen = false;
        } finally {
            this.submitting = false;
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Confirm Check-In';
        }
    }

    /* ──────────────────────────────────────
       SUBMIT CHECK-OUT
    ────────────────────────────────────── */
    async submitCheckOut() {
        if (this.submitting) return;
        if (this.currentState !== STATE.CHECKED_IN) {
            this.msg(this.currentState === STATE.COMPLETED ? 'Already checked out today.' : 'Please check in first.', 'error');
            return;
        }
        if (!this.currentRecord?.id) {
            this.msg('Record not found. Please refresh.', 'error'); return;
        }

        const mapUrl      = document.getElementById('checkOutMapUrl').value;
        const locationTxt = document.getElementById('checkOutLocation').value;
        const comments    = document.getElementById('checkOutComments').value.trim();

        if (!mapUrl) {
            this.msg('Please capture your location before checking out.', 'error'); return;
        }
        if (!this.checkOutPhotoFile) {
            this.msg('Please take a checkout selfie.', 'error'); return;
        }

        const ok = await this._confirm(
            'Confirm Check-Out',
            `Check out now at ${nowIST().display}?`
        );
        if (!ok) return;

        this.submitting = true;
        const btn = document.getElementById('btnCheckOut');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

        try {
            const ts = this.freezeCheckOutTime();
            const photoUrl = await uploadPhoto(this.checkOutPhotoFile);

            const prevComments = this.currentRecord.comments || '';
            const merged = [prevComments, comments].filter(c => c?.trim()).join(' | ');

            const updated = await dbUpdate('attendance_records', {
                check_out_time:      ts.iso,
                check_out_map_url:   mapUrl,
                check_out_location:  locationTxt || null,
                check_out_photo_url: photoUrl,
                comments:            merged || null,
                is_draft:            false
            }, { id: this.currentRecord.id });

            const duration = calcDuration(this.currentRecord.check_in_time, ts.iso);
            this.currentRecord = { ...this.currentRecord, ...updated };

            await sendWhatsAppNotification('check_out', {
                name: this.user.email, time: ts.display,
                location: locationTxt, duration
            });

            this.msg('✅ Checked out successfully!', 'success');
            this.renderState(STATE.COMPLETED);
        } catch (e) {
            console.error('submitCheckOut error:', e);
            this.msg('Check-out failed: ' + e.message, 'error');
            this._coTimeFrozen = false;
        } finally {
            this.submitting = false;
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Confirm Check-Out';
        }
    }

    /* ──────────────────────────────────────
       SUBMIT LEAVE
    ────────────────────────────────────── */
    async submitLeave() {
        if (this.submitting) return;
        if (this.currentState === STATE.COMPLETED) {
            this.msg('Attendance already complete for today.', 'error'); return;
        }
        if (this.currentState === STATE.LEAVE_DONE) {
            this.msg('Leave already submitted.', 'error'); return;
        }

        const leaveType = document.querySelector('input[name="leaveType"]:checked')?.value || 'leave';
        const fromDate  = document.getElementById('leaveFromDate').value;
        const toDate    = document.getElementById('leaveToDate').value;
        const reason    = document.getElementById('leaveReason').value.trim();
        const today     = todayIST();

        if (!fromDate || !toDate) {
            this.msg('Please select leave dates.', 'error'); return;
        }
        if (fromDate > toDate) {
            this.msg('"From" date cannot be after "To" date.', 'error'); return;
        }
        if (fromDate < today) {
            this.msg('Cannot submit leave for past dates.', 'error'); return;
        }

        const hasCheckedIn = !!this.currentRecord?.check_in_time;
        if (hasCheckedIn && fromDate === today) {
            this.msg('You already checked in today. Absent or half-day attendance cannot be marked now.', 'error'); return;
        }

        const typeLabel = { leave: 'Planned Leave', absent: 'Absent', halfday: 'Half Day' };
        const ok = await this._confirm(
            'Confirm Leave Request',
            `Submit ${typeLabel[leaveType]} from ${fromDate} to ${toDate}?`
        );
        if (!ok) return;

        this.submitting = true;
        const btn = document.getElementById('btnSubmitLeave');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting…';

        try {
            let rec;
            {
                rec = await dbInsert('attendance_records', {
                    user_id: this.user.id, user_email: this.user.email,
                    attendance_date: fromDate === today ? today : fromDate,
                    status: leaveType,
                    leave_from_date: fromDate, leave_to_date: toDate,
                    leave_reason: reason || null,
                    is_draft: false, submitted_at: new Date().toISOString()
                });
            }
            this.currentRecord = rec;
            await sendWhatsAppNotification(
                'leave',
                { name: this.user.email, date: today, fromDate, toDate,
                  leaveType: typeLabel[leaveType], reason }
            );
            this.msg('✅ Leave submitted!', 'success');
            this.renderState(STATE.LEAVE_DONE);
        } catch (e) {
            console.error('submitLeave error:', e);
            this.msg('Leave submission failed: ' + e.message, 'error');
        } finally {
            this.submitting = false;
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Leave Request';
        }
    }

    handleMarkLeaveAfterCheckIn() {
        if (this.currentState !== STATE.CHECKED_IN) return;
        this.renderState(STATE.LEAVE_FORM);
    }

    _confirm(title, message) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'confirm-overlay';
            overlay.innerHTML = `
                <div class="confirm-dialog">
                    <h3>${title}</h3>
                    <p>${message}</p>
                    <div class="confirm-actions">
                        <button class="btn-ghost" id="_no">Cancel</button>
                        <button class="btn-primary" id="_yes">Confirm</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            overlay.querySelector('#_yes').onclick = () => { overlay.remove(); resolve(true); };
            overlay.querySelector('#_no').onclick  = () => { overlay.remove(); resolve(false); };
        });
    }

    /* ──────────────────────────────────────
       HTML BUILDERS (no calls fields)
    ────────────────────────────────────── */
    _buildCheckInSummaryHTML(rec) {
        if (!rec) return '';
        return `
            <p><strong>Distributor</strong> ${rec.distributor_name || rec.distributor_id || '—'}</p>
            <p><strong>Beat Route</strong> ${rec.beat_route || '—'}</p>
            <p><strong>Check-In</strong> ${fmtTime(rec.check_in_time)}</p>
            ${rec.check_in_map_url   ? `<p><strong>Location</strong> <a href="${rec.check_in_map_url}" target="_blank">📍 View map</a></p>` : ''}
            ${rec.check_in_photo_url ? `<p><strong>Selfie</strong> <a href="${rec.check_in_photo_url}" target="_blank">🖼 View photo</a></p>` : ''}
            ${rec.comments           ? `<p><strong>Notes</strong> ${rec.comments.split(' | ')[0]}</p>` : ''}
        `;
    }

    _buildFullSummaryHTML(rec) {
        if (!rec) return '';
        const duration = calcDuration(rec.check_in_time, rec.check_out_time);
        const ciNotes  = (rec.comments || '').split(' | ')[0] || '';
        const coNotes  = (rec.comments || '').split(' | ')[1] || '';
        return `
            <h4>Check-In</h4>
            <p><strong>Distributor</strong> ${rec.distributor_name || rec.distributor_id || '—'}</p>
            <p><strong>Beat Route</strong> ${rec.beat_route || '—'}</p>
            <p><strong>Time</strong> ${fmtTime(rec.check_in_time)}</p>
            ${rec.check_in_map_url   ? `<p><strong>Location</strong> <a href="${rec.check_in_map_url}" target="_blank">📍 View</a></p>` : ''}
            ${rec.check_in_photo_url ? `<p><strong>Selfie</strong> <a href="${rec.check_in_photo_url}" target="_blank">🖼 View</a></p>` : ''}
            ${ciNotes                ? `<p><strong>Notes</strong> ${ciNotes}</p>` : ''}
            <hr>
            <h4>Check-Out</h4>
            <p><strong>Time</strong> ${fmtTime(rec.check_out_time)}</p>
            <p><strong>Duration</strong> ${duration}</p>
            ${rec.check_out_map_url   ? `<p><strong>Location</strong> <a href="${rec.check_out_map_url}" target="_blank">📍 View</a></p>` : ''}
            ${rec.check_out_photo_url ? `<p><strong>Selfie</strong> <a href="${rec.check_out_photo_url}" target="_blank">🖼 View</a></p>` : ''}
            ${coNotes                 ? `<p><strong>Notes</strong> ${coNotes}</p>` : ''}
        `;
    }

    _buildLeaveSummaryHTML(rec) {
        if (!rec) return '';
        const typeLabel = { leave: 'Planned Leave', absent: 'Absent', halfday: 'Half Day' };
        return `
            <h4 style="color:var(--navy);margin-bottom:12px;">
                <i class="fas fa-umbrella-beach" style="color:var(--amber)"></i>
                ${typeLabel[rec.status] || rec.status}
            </h4>
            <p><strong>From</strong> ${rec.leave_from_date || '—'}</p>
            <p><strong>To</strong> ${rec.leave_to_date || '—'}</p>
            <p><strong>Reason</strong> ${rec.leave_reason || '—'}</p>
            <p><strong>Submitted</strong> ${fmtTime(rec.submitted_at || rec.created_at)}</p>
            ${rec.check_in_time ? `<hr><p style="font-size:0.8rem;color:#888;">Note: You had checked in at ${fmtTime(rec.check_in_time)} before marking this leave.</p>` : ''}
        `;
    }

    msg(text, type = 'info') {
        const el    = document.getElementById('appMessage');
        const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };
        el.className = `app-message msg-${type}`;
        el.innerHTML = `<i class="fas ${icons[type] || 'fa-circle-info'}"></i> ${text}`;
        el.classList.remove('hidden');
        clearTimeout(this._msgTimer);
        this._msgTimer = setTimeout(() => el.classList.add('hidden'), 6000);
    }

    async handleLogout() {
        const ok = await this._confirm('Sign Out', 'Are you sure you want to sign out?');
        if (!ok) return;
        await supabaseClient.auth.signOut();
        window.location.href = '/salesk95/index.html';
    }

    async loadMyHistory() {
        const host=document.getElementById('myHistoryList'); if(!host)return;
        host.innerHTML='<div class="loader-box"><div class="spinner"></div><p>Loading status…</p></div>';
        try{
            const {data,error}=await supabaseClient.from('attendance_records').select('attendance_date,status,check_in_time,check_out_time,leave_from_date,leave_to_date,leave_reason').eq('user_email',this.user.email).order('attendance_date',{ascending:false}).limit(90);
            if(error)throw error;
            host.innerHTML=(data||[]).map(r=>`<div class="history-item"><div class="history-date">${new Date(`${r.attendance_date}T00:00:00+05:30`).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Kolkata'})}</div><div class="history-times">${r.check_in_time?`In: ${fmtTime(r.check_in_time)}`:''}${r.check_out_time?`<br>Out: ${fmtTime(r.check_out_time)}`:''}${r.leave_reason?`<br>${r.leave_reason}`:''}</div><span class="history-status ${r.status||'present'}">${String(r.status||'present').replace('_',' ')}</span></div>`).join('')||'<div class="summary-card">No attendance or leave records yet.</div>';
        }catch(e){host.innerHTML=`<div class="app-message msg-error">${e.message}</div>`}
    }

    bindStaticEvents() {
        document.querySelectorAll('.tab-pill').forEach(btn => {
            btn.addEventListener('click', () => this.handleTabClick(btn.dataset.tab));
        });
        document.getElementById('detectCheckInLocation')
            .addEventListener('click', () => this.detectLocation('checkIn'));
        document.getElementById('detectCheckOutLocation')
            .addEventListener('click', () => this.detectLocation('checkOut'));
        this.setupPhoto('checkIn');
        this.setupPhoto('checkOut');
        this._setupLeaveToday();
        document.getElementById('btnCheckIn')
            .addEventListener('click', () => this.submitCheckIn());
        document.getElementById('btnCheckOut')
            .addEventListener('click', () => this.submitCheckOut());
        document.getElementById('btnSubmitLeave')
            .addEventListener('click', () => this.submitLeave());
        document.getElementById('btnMarkLeaveAfterCheckIn')
            .addEventListener('click', () => this.handleMarkLeaveAfterCheckIn());
    }
}

/* ─────────────────────────────────────────────────────────
   BOOT
───────────────────────────────────────────────────────── */
const app = new AttendanceApp();
window.app = app;
document.addEventListener('DOMContentLoaded', () => app.init());
