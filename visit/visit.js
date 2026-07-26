// ============================================
// K95 FOODS - VISIT FORM (with access_manager)
// ============================================
console.log('Visit Form module loaded');

// Check if Supabase library loaded
let supabaseClient = null;
let supabaseAvailable = false;
if (typeof window.supabase === 'undefined') {
    console.error('Supabase library not loaded. Check network or CSP.');
} else {
    console.log('Supabase library detected');
    supabaseAvailable = true;
}

const SUPABASE_URL = 'https://jaasosewjbrwdklscxrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphYXNvc2V3amJyd2RrbHNjeHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMjAxMDEsImV4cCI6MjA4NTY5NjEwMX0.OE-dD6EN5DR3fvnaAd9jW3cJ7_5sYXNkY5vOQFQ00w0';
const REMEMBER_ME_KEY = 'k95_remember_me';

const authStorage = {
    getItem(key) {
        const remember = localStorage.getItem(REMEMBER_ME_KEY) !== 'false';
        return remember ? localStorage.getItem(key) : sessionStorage.getItem(key);
    },
    setItem(key, value) {
        const remember = localStorage.getItem(REMEMBER_ME_KEY) !== 'false';
        const primary = remember ? localStorage : sessionStorage;
        const secondary = remember ? sessionStorage : localStorage;
        primary.setItem(key, value);
        secondary.removeItem(key);
    },
    removeItem(key) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
    }
};

if (supabaseAvailable) {
    // Create Supabase client with PROPER proxy handling
    supabaseClient = window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storage: authStorage
            },
            global: {
                fetch: async (url, options) => {
                    const parsedUrl = new URL(url);
                    const path = parsedUrl.pathname;
                    
                    // CRITICAL: Bypass proxy for Storage requests
                    if (path.startsWith('/storage/v1/')) {
                        console.log('Storage request bypassing proxy:', path);
                        return fetch(url, options);
                    }
                    
                    // Handle Auth and REST via proxy
                    const isAuth = path.startsWith('/auth/v1/');
                    const type = isAuth ? 'auth' : 'rest';
                    const apiPath = path.replace(isAuth ? '/auth/v1/' : '/rest/v1/', '');
                    
                    const proxyUrl = new URL('/salesk95/proxy.php', window.location.origin);
                    proxyUrl.searchParams.set('type', type);
                    proxyUrl.searchParams.set('path', apiPath);
                    
                    // Copy all query parameters
                    const searchParams = new URLSearchParams(parsedUrl.search);
                    for (let [key, value] of searchParams.entries()) {
                        proxyUrl.searchParams.append(key, value);
                    }
                    
                    console.log(`Proxying ${type} request:`, apiPath);
                    return fetch(proxyUrl.toString(), options);
                }
            }
        }
    );
}

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
        console.error(`Error fetching from ${table}:`, error);
        throw error;
    }
}

async function supabaseInsert(table, data) {
    if (!supabaseClient) throw new Error('Supabase client not initialized');
    try {
        const { data: result, error } = await supabaseClient
            .from(table)
            .insert(Array.isArray(data) ? data : [data])
            .select();
        if (error) throw error;
        return result;
    } catch (error) {
        console.error(`Error inserting into ${table}:`, error);
        throw error;
    }
}

function getCachedOrFetch(key, fetchFn, ttl = 60000) {
    const cached = localStorage.getItem(key);
    if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < ttl) return Promise.resolve(data);
    }
    return fetchFn().then(data => {
        localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
        return data;
    });
}

// ============================================
// MAIN APPLICATION CLASS
// ============================================
class K95VisitApp {
    constructor() {
        this.CACHE = {
            USER: 'k95_user',
            LAST_DISTRIBUTOR: 'k95_last_distributor',
            OUTLETS: 'k95_outlets_',
            PRODUCTS: 'k95_products',
            EMAIL: 'k95_last_email'
        };
        this.currentUser = null;
        this.userRole = null;
        this.allowedDistributorIds = [];
        this.currentDistributor = null;
        this.distributorsList = [];
        this.outletsData = [];
        this.productsData = [];
        this.nonBuyerOutletIds = new Set();
        this.orderedOutletIds = new Set();
        this.currentAccess = null;
        this.isNewOutlet = false;
        this.outletMode = 'all';
        this.selectedProducts = [];
        this.photos = [];
        this.submitting = false;
        this.isLoadingDistributor = false;
        this.init();
    }

    showPageState(text, type = 'loading') {
        const state = document.getElementById('pageState');
        const stateText = document.getElementById('pageStateText');
        if (!state || !stateText) return;
        stateText.textContent = text;
        state.classList.toggle('error', type === 'error');
        state.style.display = 'flex';
    }

    hidePageState() {
        const state = document.getElementById('pageState');
        if (state) state.style.display = 'none';
    }

    getLastDistributorKey() {
        const email = String(this.currentUser?.email || '').trim().toLowerCase();
        return email ? `${this.CACHE.LAST_DISTRIBUTOR}:${email}` : this.CACHE.LAST_DISTRIBUTOR;
    }

    getProfileInitials(name) {
        return String(name || this.currentUser?.email || 'K95')
            .trim()
            .split(/[\s@._-]+/)
            .filter(Boolean)
            .map(part => part[0])
            .join('')
            .toUpperCase()
            .slice(0, 2) || 'K9';
    }

    renderUserAvatar() {
        const avatar = document.getElementById('visitUserAvatar');
        if (!avatar) return;
        const name = this.currentAccess?.full_name || this.currentUser?.email || 'User';
        const initials = this.getProfileInitials(name);
        avatar.textContent = initials;
        avatar.setAttribute('aria-label', `${name} profile photo`);

        const avatarUrl = this.currentAccess?.avatar_url;
        if (!avatarUrl) return;
        try {
            const parsed = new URL(avatarUrl);
            if (parsed.protocol !== 'https:') return;
            const image = document.createElement('img');
            image.src = parsed.toString();
            image.alt = `${name} profile photo`;
            image.referrerPolicy = 'no-referrer';
            image.addEventListener('error', () => {
                avatar.textContent = initials;
            }, { once: true });
            avatar.replaceChildren(image);
        } catch (error) {
            console.warn('Invalid profile photo URL ignored');
        }
    }

    getTodayIST() {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(new Date())
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value]));
        return `${parts.year}-${parts.month}-${parts.day}`;
    }

    async init() {
        console.log('K95 Visit Form - Initializing...');
        this.initializeChecklist();
        try {
            if (!supabaseAvailable || !supabaseClient) throw new Error('Supabase client is unavailable');
            const { data: { session }, error } = await supabaseClient.auth.getSession();
            if (error) throw error;
            if (!session?.user?.email) {
                this.showPageState('Please sign in from the home page to use the Visit Form.', 'error');
                return;
            }

            this.currentUser = session.user;
            const { data: access, error: accessError } = await supabaseClient
                .from('access_manager')
                .select('full_name, avatar_url, role_name, distributor_ids, tile_permissions')
                .ilike('user_email', session.user.email)
                .maybeSingle();
            if (accessError) throw accessError;
            if (!access) {
                this.showPageState('Your application access record could not be found. Please contact an administrator.', 'error');
                return;
            }

            const permission = access.tile_permissions?.visit_form?.access;
            if (!permission || permission === 'none') {
                this.showPageState('You do not have access to the Visit Form.', 'error');
                return;
            }

            this.currentAccess = access;
            this.userRole = String(access.role_name || '').toLowerCase();
            this.allowedDistributorIds = access.distributor_ids || [];
            this.renderUserAvatar();

            const visitDateInput = document.getElementById('visitDate');
            if (visitDateInput) {
                visitDateInput.value = this.getTodayIST();
                visitDateInput.readOnly = true;
            }
            await this.loadUserAccessAndDistributors();

        } catch (error) {
            console.error('Visit Form initialization failed:', error);
            this.showPageState('Unable to load the Visit Form. Please return to the home page and try again.', 'error');
        }
    }

    initializeChecklist() {
        document.querySelectorAll('.checklist-item').forEach(item => {
            const checkbox = item.querySelector('.visit-checkbox');
            if (!checkbox) return;
            checkbox.addEventListener('change', () => {
                item.classList.toggle('checked', checkbox.checked);
            });
        });
    }

    async loadUserAccessAndDistributors() {
        this.showPageState('Loading your distributors...');
        let query = supabaseClient
            .from('distributors')
            .select('distributor_id, distributor_name')
            .eq('status', 'Active')
            .order('distributor_name');

        if (this.userRole !== 'admin' && this.userRole !== 'nsm') {
            if (this.allowedDistributorIds.length === 0) {
                this.showPageState('No distributors are assigned to your account.', 'error');
                return;
            }
            query = query.in('distributor_id', this.allowedDistributorIds);
        }

        const { data: distributors, error } = await query;
        if (error) throw error;
        if (!distributors?.length) {
            this.showPageState('No active distributors are available for your account.', 'error');
            return;
        }

        this.distributorsList = distributors;
        localStorage.setItem(this.CACHE.EMAIL, this.currentUser.email);
        localStorage.setItem(this.CACHE.USER, JSON.stringify({
            email: this.currentUser.email,
            distributors: distributors.map(distributor => distributor.distributor_id)
        }));

        const distributorSelect = document.getElementById('distributorSel');
        distributorSelect.replaceChildren();
        distributors.forEach(distributor => {
            const option = document.createElement('option');
            option.value = distributor.distributor_id;
            option.textContent = distributor.distributor_name;
            distributorSelect.appendChild(option);
        });

        const userSpecificLast = localStorage.getItem(this.getLastDistributorKey());
        const legacyLast = localStorage.getItem(this.CACHE.LAST_DISTRIBUTOR);
        const lastDistributorId = [userSpecificLast, legacyLast]
            .find(id => id && distributors.some(distributor => distributor.distributor_id === id));
        const initialDistributorId = lastDistributorId || distributors[0].distributor_id;
        distributorSelect.value = initialDistributorId;
        await this.onDistributorChange(initialDistributorId);
    }

    async onDistributorChange(distributorId) {
        if (!distributorId || this.isLoadingDistributor) return;
        const selectedDistributor = this.distributorsList.find(distributor => distributor.distributor_id === distributorId);
        if (!selectedDistributor) return;

        this.isLoadingDistributor = true;
        const distributorSelect = document.getElementById('distributorSel');
        if (distributorSelect) distributorSelect.disabled = true;
        this.currentDistributor = selectedDistributor;
        localStorage.setItem(this.getLastDistributorKey(), distributorId);
        localStorage.setItem(this.CACHE.LAST_DISTRIBUTOR, distributorId);
        const userData = JSON.parse(localStorage.getItem(this.CACHE.USER) || '{}');
        userData.distributor_id = distributorId;
        userData.distributor_name = selectedDistributor.distributor_name;
        localStorage.setItem(this.CACHE.USER, JSON.stringify(userData));

        document.getElementById('visitSection').style.display = 'none';
        this.showPageState(`Loading ${selectedDistributor.distributor_name}...`);
        await this.clearForm({ preserveMessage: false, renderOutlets: false, refreshTodayCalls: false });

        try {
            const outletKey = this.CACHE.OUTLETS + distributorId;
            this.outletsData = await getCachedOrFetch(outletKey, async () => {
                const data = await supabaseFetch('outlets', {
                    filters: { distributor_id: distributorId, status: 'Active' }
                });
                return data.sort((a, b) => (a.outlet_name || '').localeCompare(b.outlet_name || ''));
            }, 60000);

            await this.loadOutletStatuses(distributorId);
            await this.renderOutlets();
            await this.loadProducts();
            await this.loadTodayCalls();
            this.hidePageState();
            document.getElementById('visitSection').style.display = 'block';
        } catch (error) {
            console.error('Error loading data:', error);
            this.showPageState('Failed to load this distributor. Please select it again or try another distributor.', 'error');
        } finally {
            if (distributorSelect) distributorSelect.disabled = false;
            this.isLoadingDistributor = false;
        }
    }

    getCurrentMonthBounds() {
        const [yearText, monthText] = this.getTodayIST().split('-');
        const year = Number(yearText);
        const month = Number(monthText);
        const nextYear = month === 12 ? year + 1 : year;
        const nextMonth = month === 12 ? 1 : month + 1;
        const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
        const nextMonthStart = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
        return {
            reportMonth: monthStart,
            startIso: new Date(`${monthStart}T00:00:00+05:30`).toISOString(),
            endIso: new Date(`${nextMonthStart}T00:00:00+05:30`).toISOString()
        };
    }

    async loadOutletStatuses(distributorId) {
        const { reportMonth, startIso, endIso } = this.getCurrentMonthBounds();
        const [nonBuyersResult, ordersResult] = await Promise.all([
            supabaseClient
                .from('non_buyers')
                .select('outlet_id')
                .eq('report_month', reportMonth)
                .eq('distributor_id', distributorId),
            supabaseClient
                .from('orders')
                .select('outlet_id')
                .eq('distributor_id', distributorId)
                .gte('created_at', startIso)
                .lt('created_at', endIso)
                .not('order_status', 'in', '("Draft","Cancelled")')
        ]);
        if (nonBuyersResult.error) throw nonBuyersResult.error;
        if (ordersResult.error) throw ordersResult.error;
        this.nonBuyerOutletIds = new Set((nonBuyersResult.data || []).map(row => row.outlet_id));
        this.orderedOutletIds = new Set((ordersResult.data || []).map(row => row.outlet_id));
    }

    // ========== OUTLET METHODS ==========
    handleOutletNameInput() {
        let v = document.getElementById('newOutletName').value;
        v = v.replace(/\b\w/g, c => c.toUpperCase());
        document.getElementById('newOutletName').value = v;
    }

    async getOutletsByMode() {
        if (!this.currentDistributor) return [];

        if (this.outletMode === 'all') {
            return this.outletsData;
        } else if (this.outletMode === 'nonbuyers') {
            return this.outletsData.filter(outlet => this.nonBuyerOutletIds.has(outlet.outlet_id));
        } else if (this.outletMode === 'beatplan') {
            const todayName = new Intl.DateTimeFormat('en-US', {
                weekday: 'long',
                timeZone: 'Asia/Kolkata'
            }).format(new Date());
            return this.outletsData.filter(o => o.visit_day === todayName);
        }
        return [];
    }

    getOutletStatusClass(outletId) {
        if (this.outletMode === 'nonbuyers') return 'outlet-nonbuyer';
        if (this.outletMode === 'beatplan') return 'outlet-beatplan';
        if (this.nonBuyerOutletIds.has(outletId)) return 'outlet-nonbuyer';
        if (this.orderedOutletIds.has(outletId)) return 'outlet-ordered';
        return '';
    }

    renderOutlets() {
        const select = document.getElementById('outletSel');
        const typeButtons = document.getElementById('outletTypeButtons');

        return this.getOutletsByMode().then(filteredOutlets => {
            filteredOutlets.sort((a, b) => (a.outlet_name || '').toLowerCase().localeCompare(b.outlet_name || ''));

            const types = [...new Set(filteredOutlets.map(o => o.outlet_type || 'UNKNOWN'))];
            typeButtons.innerHTML = '<button type="button" class="outlet-type-btn active" data-type="ALL" onclick="app.filterOutletsByType(\'ALL\')">All</button>' +
                types.map(t => `<button type="button" class="outlet-type-btn" data-type="${t}" onclick="app.filterOutletsByType('${t}')">${t}</button>`).join('');

            select.innerHTML = '<option value="">Choose an outlet...</option>';
            filteredOutlets.forEach(outlet => {
                const option = document.createElement('option');
                option.value = outlet.outlet_id;
                option.dataset.type = outlet.outlet_type;
                const statusClass = this.getOutletStatusClass(outlet.outlet_id);
                if (statusClass) {
                    option.classList.add(statusClass);
                    option.dataset.statusClass = statusClass;
                }
                option.textContent = `${outlet.outlet_name} - ${outlet.outlet_type}`;
                select.appendChild(option);
            });

            const newOption = document.createElement('option');
            newOption.value = 'new';
            newOption.textContent = 'Create New Outlet';
            select.appendChild(newOption);
            this.updateOutletSelectColour();
        }).catch(error => {
            console.error('Error getting outlets by mode:', error);
            this.showMessage('Failed to load outlets', 'error');
        });
    }

    filterOutletsByType(type) {
        const select = document.getElementById('outletSel');
        const buttons = document.querySelectorAll('.outlet-type-btn');
        buttons.forEach(btn => btn.classList.remove('active'));
        buttons.forEach(btn => {
            if (btn.dataset.type === type) btn.classList.add('active');
        });
        if (type === 'ALL') {
            Array.from(select.options).forEach(opt => opt.style.display = '');
        } else {
            Array.from(select.options).forEach(opt => {
                if (opt.value && opt.dataset.type !== type) opt.style.display = 'none';
                else opt.style.display = '';
            });
        }
        if (select.selectedOptions[0]?.style.display === 'none') select.value = '';
        this.updateOutletSelectColour();
    }

    toggleNewOutlet(isNew) {
        this.isNewOutlet = isNew;
        document.getElementById('existingOutletBox').classList.toggle('hidden', isNew);
        document.getElementById('newOutletBox').classList.toggle('hidden', !isNew);
        document.getElementById('existingOutletBtn').classList.toggle('active', !isNew);
        document.getElementById('newOutletBtn').classList.toggle('active', isNew);
        const visitType = document.getElementById('visitType');
        if (isNew) {
            this.handleOutletNameInput();
            if (visitType) visitType.value = 'New Outlet';
            this.resetOutletInsights();
        } else if (visitType?.value === 'New Outlet') {
            visitType.value = 'Regular';
        }
    }

    onOutletChange() {
        const select = document.getElementById('outletSel');
        if (select.value === 'new') {
            this.toggleNewOutlet(true);
            select.value = '';
            this.updateOutletSelectColour();
            return;
        }
        const selected = this.outletsData.find(o => o.outlet_id === select.value);
        document.getElementById('selectedOutletType').value = selected?.outlet_type || '';
        this.updateOutletSelectColour();
        this.loadOutletInfo(selected?.outlet_id);
    }

    updateOutletSelectColour() {
        const select = document.getElementById('outletSel');
        if (!select) return;
        select.classList.remove('outlet-nonbuyer', 'outlet-ordered', 'outlet-beatplan');
        const statusClass = select.selectedOptions[0]?.dataset.statusClass;
        if (statusClass) select.classList.add(statusClass);
    }

    setOutletMode(mode) {
        this.outletMode = mode;
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        const outletSelect = document.getElementById('outletSel');
        if (outletSelect) outletSelect.value = '';
        const selectedType = document.getElementById('selectedOutletType');
        if (selectedType) selectedType.value = '';
        this.resetOutletInsights();
        this.renderOutlets();
    }

    // ========== GEOLOCATION ==========
    async detectLocation() {
        const maxRetries = 5;
        this.showMessage('Detecting your location...', 'success');
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`Location attempt ${attempt}/${maxRetries}`);
                const position = await this.getCurrentPosition(10000);
                const { latitude, longitude } = position.coords;
                console.log(`Got coordinates: ${latitude}, ${longitude}`);
                
                const latInput = document.getElementById('latitude');
                const lngInput = document.getElementById('longitude');
                const locationInput = document.getElementById('newOutletLocation');
                const mapUrlInput = document.getElementById('locationMapUrl');
                
                if (!latInput || !lngInput || !mapUrlInput) {
                    throw new Error('Location input elements not found in DOM');
                }
                
                latInput.value = latitude;
                lngInput.value = longitude;
                
                const googleMapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
                mapUrlInput.value = googleMapsUrl;
                console.log('Map URL set:', googleMapsUrl);
                
                if (this.isNewOutlet && locationInput) {
                    try {
                        const addressUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`;
                        const addressResponse = await fetch(addressUrl);
                        
                        if (addressResponse.ok) {
                            const addressData = await addressResponse.json();
                            const addressParts = [];
                            if (addressData.locality) addressParts.push(addressData.locality);
                            if (addressData.city) addressParts.push(addressData.city);
                            else if (addressData.town) addressParts.push(addressData.town);
                            if (addressData.principalSubdivision) addressParts.push(addressData.principalSubdivision);
                            if (addressData.countryName) addressParts.push(addressData.countryName);
                            if (addressData.postcode && addressParts.length > 1) {
                                addressParts.splice(addressParts.length - 1, 0, addressData.postcode);
                            }
                            if (addressParts.length > 0) {
                                locationInput.value = addressParts.join(', ');
                            } else {
                                locationInput.value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
                            }
                        } else {
                            locationInput.value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
                        }
                    } catch (addressError) {
                        console.warn('Address lookup failed:', addressError);
                        locationInput.value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
                    }
                }
                
                this.showMessage('Location detected.', 'success');
                return;
            } catch (error) {
                console.warn(`Location attempt ${attempt} failed:`, error.message);
                if (attempt < maxRetries) {
                    const delay = 1000 * attempt;
                    this.showMessage(`Retrying... (${attempt}/${maxRetries})`, 'success');
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        this.showMessage('Location detection failed. Please enter the location manually.', 'error');
    }

    applyNotesTemplate(template) {
        const notes = document.getElementById('notes');
        if (!notes || !template) return;
        const currentNotes = notes.value.trim();
        notes.value = currentNotes ? `${currentNotes}\n${template}` : template;
        const templateSelect = document.getElementById('notesTemplate');
        if (templateSelect) templateSelect.value = '';
        notes.focus();
    }

    getCurrentPosition(timeout) {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported'));
                return;
            }
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: timeout,
                maximumAge: 0
            });
        });
    }

    // ========== PRODUCTS (with type filter, no zero‑stock) ==========
    async loadProducts() {
        try {
            this.productsData = await getCachedOrFetch(this.CACHE.PRODUCTS, async () => {
                const data = await supabaseFetch('products', { filters: { status: 'Active' } });
                return data.sort((a, b) => (a.product_name || '').localeCompare(b.product_name || ''));
            }, 60000);

            const productTypes = [...new Set(this.productsData.map(p => p.product_type).filter(Boolean))].sort();
            const typeFilter = document.getElementById('productTypeFilter');
            if (typeFilter) {
                typeFilter.innerHTML = '<option value="all">All Products</option>';
                productTypes.forEach(type => {
                    const option = document.createElement('option');
                    option.value = type;
                    option.textContent = type;
                    typeFilter.appendChild(option);
                });
            }

            const typeTags = document.getElementById('typeFilters');
            if (typeTags) {
                typeTags.innerHTML = '<div class="type-tag active" data-type="all" onclick="app.setActiveType(\'all\')">All Types</div>';
                productTypes.forEach(type => {
                    const tag = document.createElement('div');
                    tag.className = 'type-tag';
                    tag.dataset.type = type;
                    tag.onclick = () => this.setActiveType(type);
                    tag.textContent = type;
                    typeTags.appendChild(tag);
                });
            }

            this.renderProductList();
        } catch (error) {
            console.error('Error loading products:', error);
        }
    }

    renderProductList() {
        const filterType = document.getElementById('productTypeFilter')?.value || 'all';
        const container = document.getElementById('productList');
        if (!container) return;

        let filtered = this.productsData;
        if (filterType !== 'all') {
            filtered = filtered.filter(p => p.product_type === filterType);
        }

        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty-state">No products found</div>';
            return;
        }

        container.innerHTML = '';
        filtered.forEach(product => {
            const existing = this.selectedProducts.find(p => p.product_id === product.product_id);
            const qty = existing ? existing.quantity : '';

            const div = document.createElement('div');
            div.className = 'product-item';
            div.dataset.productId = product.product_id;
            div.innerHTML = `
                <div class="product-info">
                    <div class="product-name">${product.product_name}</div>
                    <div class="product-meta">
                        <span class="product-price">₹${product.case_rate}/case</span>
                        ${product.pack_size ? `<span>${product.pack_size}</span>` : ''}
                    </div>
                </div>
                <div class="product-actions">
                    <div class="qty-controls">
                        <button class="qty-btn" onclick="app.updateQuantity('${product.product_id}', -1)">-</button>
                        <input type="number" id="qty_${product.product_id}" class="qty-input" value="${qty}" min="0" inputmode="numeric" placeholder="" onchange="app.updateQuantityInput('${product.product_id}', this.value)">
                        <button class="qty-btn" onclick="app.updateQuantity('${product.product_id}', 1)">+</button>
                    </div>
                </div>
            `;
            container.appendChild(div);
        });

        this.renderProductSummary();
    }

    updateQuantity(productId, delta) {
        const input = document.getElementById(`qty_${productId}`);
        if (!input) return;
        let value = parseInt(input.value) || 0;
        value = Math.max(0, value + delta);
        input.value = value > 0 ? value : '';
        const product = this.productsData.find(p => p.product_id === productId);
        if (!product) return;
        const existing = this.selectedProducts.find(p => p.product_id === productId);
        if (value > 0) {
            if (existing) {
                existing.quantity = value;
            } else {
                this.selectedProducts.push({
                    product_id: productId,
                    product_name: product.product_name,
                    quantity: value
                });
            }
        } else {
            // Remove if quantity becomes 0
            const index = this.selectedProducts.findIndex(p => p.product_id === productId);
            if (index !== -1) this.selectedProducts.splice(index, 1);
        }
        this.renderProductSummary();
    }

    updateQuantityInput(productId, value) {
        const qty = parseInt(value) || 0;
        const input = document.getElementById(`qty_${productId}`);
        if (input) input.value = qty > 0 ? String(qty) : '';
        const product = this.productsData.find(p => p.product_id === productId);
        if (!product) return;
        const existing = this.selectedProducts.find(p => p.product_id === productId);
        if (qty > 0) {
            if (existing) {
                existing.quantity = qty;
            } else {
                this.selectedProducts.push({
                    product_id: productId,
                    product_name: product.product_name,
                    quantity: qty
                });
            }
        } else {
            const index = this.selectedProducts.findIndex(p => p.product_id === productId);
            if (index !== -1) this.selectedProducts.splice(index, 1);
        }
        this.renderProductSummary();
    }

    renderProductSummary() {
        const tbody = document.getElementById('productSummary');
        if (!tbody) return;
        tbody.innerHTML = '';
        this.selectedProducts.forEach((p, index) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${p.product_name}</td>
                <td style="text-align:center;">${p.quantity}</td>
                <td style="text-align:right;">
                    <button class="qty-btn" onclick="app.removeSelectedProduct(${index})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    removeSelectedProduct(index) {
        const product = this.selectedProducts[index];
        if (product) {
            const qtyInput = document.getElementById(`qty_${product.product_id}`);
            if (qtyInput) qtyInput.value = '';
            this.selectedProducts.splice(index, 1);
        }
        this.renderProductSummary();
    }

    filterProductsByType() {
        this.renderProductList();
    }

    setActiveType(type) {
        document.querySelectorAll('.type-tag').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.type-tag').forEach(t => {
            if (t.dataset.type === type) t.classList.add('active');
        });
        document.getElementById('productTypeFilter').value = type;
        this.renderProductList();
    }

    // ========== PHOTO HANDLING ==========
    handlePhotoSelect() {
        const input = document.getElementById('photoInput');
        const newFiles = Array.from(input.files);
        
        // Check if adding new files would exceed limit of 3
        if (this.photos.length + newFiles.length > 3) {
            alert('Maximum 3 photos allowed. You already have ' + this.photos.length + ' photo(s).');
            input.value = '';
            return;
        }
        
        // Append new files to existing photos (don't replace!)
        this.photos = [...this.photos, ...newFiles];
        
        // Render preview
        this.renderPhotoPreview();
        
        // Clear input so same file can be selected again if needed
        input.value = '';
    }
    
    
renderPhotoPreview() {
    const preview = document.getElementById('photoPreview');
    if (!preview) return;
    preview.innerHTML = '';
    
    this.photos.forEach((file, i) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const container = document.createElement('div');
            container.style.cssText = `
                position: relative;
                display: inline-block;
                margin-right: 8px;
                margin-bottom: 8px;
            `;

            const img = document.createElement('img');
            img.src = e.target.result;
            img.style.cssText = `
                width: 80px;
                height: 80px;
                object-fit: cover;
                border-radius: 8px;
                border: 2px solid #e2e8f0;
            `;

            const removeBtn = document.createElement('button');
            removeBtn.innerHTML = '&times;';
            removeBtn.style.cssText = `
                position: absolute;
                top: -8px;
                right: -8px;
                background: #dc3545;
                color: white;
                border: 2px solid white;
                border-radius: 50%;
                width: 24px;
                height: 24px;
                font-size: 18px;
                line-height: 20px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            `;
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                this.removePhoto(i);
            };

            // Show photo count badge
            const badge = document.createElement('div');
            badge.style.cssText = `
                position: absolute;
                bottom: 4px;
                left: 4px;
                background: rgba(0,0,0,0.6);
                color: white;
                font-size: 11px;
                padding: 2px 6px;
                border-radius: 12px;
            `;
            badge.textContent = `${i + 1}/${this.photos.length}`;

            container.appendChild(img);
            container.appendChild(removeBtn);
            container.appendChild(badge);
            preview.appendChild(container);
        };
        reader.readAsDataURL(file);
    });
    
    // Show count message
    const countMsg = document.createElement('div');
    countMsg.style.cssText = `
        width: 100%;
        margin-top: 8px;
        font-size: 12px;
        color: #64748b;
    `;
    countMsg.textContent = `${this.photos.length}/3 photos selected`;
    preview.appendChild(countMsg);
}

removePhoto(index) {
    // Remove the photo at specified index
    this.photos.splice(index, 1);
    
    // Re-render preview
    this.renderPhotoPreview();
    
    // Clear the file input (since we're managing photos separately)
    const photoInput = document.getElementById('photoInput');
    if (photoInput) photoInput.value = '';
}


clearAllPhotos() {
    this.photos = [];
    this.renderPhotoPreview();
    const photoInput = document.getElementById('photoInput');
    if (photoInput) photoInput.value = '';
}

    async compressImage(file, maxWidth = 1024, quality = 0.7) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (e) => {
                const img = new Image();
                img.src = e.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    canvas.toBlob((blob) => {
                        resolve(new File([blob], file.name, { type: 'image/jpeg' }));
                    }, 'image/jpeg', quality);
                };
                img.onerror = reject;
            };
            reader.onerror = reject;
        });
    }

    async uploadPhotos() {
        if (this.photos.length === 0) return [];
        
        const urls = [];
        for (let file of this.photos) {
            try {
                // Compress image first
                const compressed = await this.compressImage(file);
                
                // Generate unique filename
                const timestamp = Date.now();
                const randomStr = Math.random().toString(36).substring(2, 8);
                const fileName = `${timestamp}_${randomStr}.jpg`;
                
                console.log(`Uploading: ${fileName}`);
                
                // Upload to Supabase Storage
                const { data, error } = await supabaseClient.storage
                    .from('visit-photos')  // Your bucket name
                    .upload(fileName, compressed, {
                        cacheControl: '3600',
                        upsert: false,
                        contentType: 'image/jpeg'
                    });
                
                if (error) {
                    console.error('Upload error:', error);
                    throw new Error(`Upload failed: ${error.message}`);
                }
                
                console.log('Upload success:', data);
                
                // Get public URL
                const { data: { publicUrl } } = supabaseClient.storage
                    .from('visit-photos')
                    .getPublicUrl(fileName);
                
                urls.push(publicUrl);
                
            } catch (err) {
                console.error('Error in uploadPhotos:', err);
                throw new Error(`Failed to upload ${file.name}: ${err.message}`);
            }
        }
        
        console.log(`Uploaded ${urls.length} photo(s)`);
        return urls;
    }

    showProcessing(title = 'Processing visit...', detail = 'Please keep this page open.') {
        const overlay = document.getElementById('processingOverlay');
        if (!overlay) return;
        document.getElementById('processingTitle').textContent = title;
        document.getElementById('processingDetail').textContent = detail;
        overlay.classList.remove('success');
        overlay.classList.add('show');
        overlay.setAttribute('aria-hidden', 'false');
    }

    updateProcessing(title, detail) {
        const titleElement = document.getElementById('processingTitle');
        const detailElement = document.getElementById('processingDetail');
        if (titleElement) titleElement.textContent = title;
        if (detailElement) detailElement.textContent = detail;
    }

    showProcessingSuccess(title, detail) {
        const overlay = document.getElementById('processingOverlay');
        if (!overlay) return;
        overlay.classList.add('success');
        this.updateProcessing(title, detail);
    }

    hideProcessing() {
        const overlay = document.getElementById('processingOverlay');
        if (!overlay) return;
        overlay.classList.remove('show', 'success');
        overlay.setAttribute('aria-hidden', 'true');
    }

    async submitVisit() {
        if (this.submitting) {
            console.warn('Visit submission is already in progress');
            return;
        }
        if (!this.currentUser || !this.currentDistributor) {
            this.showMessage('Your user or distributor session is missing. Please return to the home page and try again.', 'error');
            return;
        }

        const isNew = this.isNewOutlet;
        let outletId = null;
        let newOutletDetails = null;
        if (isNew) {
            const name = document.getElementById('newOutletName').value.trim();
            const contact = document.getElementById('newOutletContact').value.trim();
            const outletType = document.getElementById('newOutletType').value;
            if (!name) {
                this.showMessage('New outlet name is required.', 'error');
                return;
            }
            if (!outletType) {
                this.showMessage('Please select an outlet type.', 'error');
                return;
            }
            if (contact && (!/^\d+$/.test(contact) || contact.length > 10)) {
                this.showMessage('Contact number can contain up to 10 digits.', 'error');
                return;
            }
            newOutletDetails = {
                new_outlet_name: name,
                new_outlet_contact: contact || null,
                new_outlet_email: document.getElementById('newOutletEmail').value.trim() || null,
                new_outlet_type: outletType,
                new_outlet_location: document.getElementById('newOutletLocation').value.trim() || null,
                new_outlet_location_url: document.getElementById('locationMapUrl').value || null
            };
        } else {
            outletId = document.getElementById('outletSel').value;
            if (!outletId || outletId === 'new') {
                this.showMessage('Please select an outlet.', 'error');
                return;
            }
        }

        const visitDate = document.getElementById('visitDate').value;
        const visitType = document.getElementById('visitType').value;
        const notes = document.getElementById('notes').value.trim();
        if (!visitDate) {
            this.showMessage('Please select a visit date.', 'error');
            return;
        }
        if (!visitType) {
            this.showMessage('Please select a visit type.', 'error');
            return;
        }
        if (!notes) {
            this.showMessage('Notes are required. Please add visit observations.', 'error');
            document.getElementById('notes').focus();
            return;
        }

        this.submitting = true;
        const submitBtn = document.getElementById('submitBtn');
        const clearBtn = document.getElementById('clearBtn');
        if (submitBtn) submitBtn.disabled = true;
        if (clearBtn) clearBtn.disabled = true;
        this.showProcessing('Processing visit...', 'Validating and preparing the visit record.');

        try {
            let photoUrls = [];
            if (this.photos.length > 0) {
                this.updateProcessing('Uploading photos...', `Uploading ${this.photos.length} visit photo${this.photos.length === 1 ? '' : 's'}.`);
                photoUrls = await this.uploadPhotos();
            }

            const checklistData = {};
            document.querySelectorAll('.visit-checkbox').forEach(checkbox => {
                if (checkbox.dataset.field) checklistData[checkbox.dataset.field] = checkbox.checked;
            });

            const createdAt = new Date().toISOString();
            const visitData = {
                distributor_id: this.currentDistributor.distributor_id,
                outlet_id: outletId,
                visit_date: visitDate,
                visit_type: visitType,
                notes,
                latitude: document.getElementById('latitude').value || null,
                longitude: document.getElementById('longitude').value || null,
                location_map_url: document.getElementById('locationMapUrl').value || null,
                photo_urls: photoUrls,
                created_by_email: this.currentUser.email,
                created_at: createdAt,
                ...checklistData,
                ...(newOutletDetails || {})
            };

            // New-outlet visits intentionally remain only in visits; no outlets insert occurs here.
            this.updateProcessing('Saving visit...', 'Creating the visit and optional product records.');
            const [visit] = await supabaseInsert('visits', visitData);
            if (this.selectedProducts.length > 0) {
                const productInserts = this.selectedProducts.map(product => ({
                    visit_id: visit.id,
                    product_id: product.product_id,
                    product_name: product.product_name,
                    quantity_on_hand: product.quantity,
                    notes: null,
                    created_at: createdAt
                }));
                await supabaseInsert('visit_products', productInserts);
            }

            await this.clearForm({ preserveMessage: true, refreshTodayCalls: true });
            this.showProcessingSuccess('Visit saved successfully', 'The Visit Form has been cleared.');
            await new Promise(resolve => setTimeout(resolve, 700));
            this.hideProcessing();
            this.showMessage('Visit recorded successfully.', 'success');
        } catch (error) {
            console.error('Error submitting visit:', error);
            this.hideProcessing();
            this.showMessage('Visit could not be saved: ' + error.message, 'error');
        } finally {
            this.submitting = false;
            if (submitBtn) submitBtn.disabled = false;
            if (clearBtn) clearBtn.disabled = false;
        }
    }


    formatVisitDate(dateValue) {
        if (!dateValue) return 'No previous visit';
        const date = new Date(`${dateValue}T00:00:00+05:30`);
        return new Intl.DateTimeFormat('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            timeZone: 'Asia/Kolkata'
        }).format(date);
    }

    resetOutletInsights() {
        const lastVisit = document.getElementById('lastVisitDate');
        const visitCount = document.getElementById('visitCount');
        if (lastVisit) lastVisit.textContent = 'No previous visit';
        if (visitCount) visitCount.textContent = '0';
    }

    async loadOutletInfo(outletId) {
        if (!outletId || this.isNewOutlet) {
            this.resetOutletInsights();
            return;
        }
        const lastVisitElement = document.getElementById('lastVisitDate');
        const visitCountElement = document.getElementById('visitCount');
        if (lastVisitElement) lastVisitElement.textContent = 'Loading...';
        if (visitCountElement) visitCountElement.textContent = '...';

        try {
            const [lastVisitResult, countResult] = await Promise.all([
                supabaseClient
                    .from('visits')
                    .select('visit_date')
                    .eq('outlet_id', outletId)
                    .order('visit_date', { ascending: false })
                    .limit(1)
                    .maybeSingle(),
                supabaseClient
                    .from('visits')
                    .select('id', { count: 'exact' })
                    .eq('outlet_id', outletId)
                    .limit(1)
            ]);
            if (lastVisitResult.error) {
                console.error('Error loading last visit:', lastVisitResult.error);
                if (lastVisitElement) lastVisitElement.textContent = 'Unable to load';
            } else if (lastVisitElement) {
                lastVisitElement.textContent = this.formatVisitDate(lastVisitResult.data?.visit_date);
            }
            if (countResult.error) {
                console.error('Error loading visit count:', countResult.error);
                if (visitCountElement) visitCountElement.textContent = 'Unable to load';
            } else if (visitCountElement) {
                visitCountElement.textContent = String(countResult.count ?? countResult.data?.length ?? 0);
            }
        } catch (error) {
            console.error('Error loading outlet visit information:', error);
            if (lastVisitElement) lastVisitElement.textContent = 'Unable to load';
            if (visitCountElement) visitCountElement.textContent = 'Unable to load';
        }
    }

    async loadTodayCalls() {
        const visitsTodayElement = document.getElementById('visitsToday');
        if (!this.currentUser?.email) {
            if (visitsTodayElement) visitsTodayElement.textContent = '0';
            return;
        }
        if (visitsTodayElement) visitsTodayElement.textContent = '...';
        try {
            const { data, error } = await supabaseClient
                .from('visits')
                .select('id, outlet_id, new_outlet_name')
                .ilike('created_by_email', this.currentUser.email)
                .eq('visit_date', this.getTodayIST());
            if (error) throw error;

            const uniqueCalls = new Set();
            (data || []).forEach(visit => {
                if (visit.outlet_id) {
                    uniqueCalls.add(`outlet:${visit.outlet_id}`);
                } else if (visit.new_outlet_name) {
                    uniqueCalls.add(`new:${visit.new_outlet_name.trim().toLowerCase()}`);
                } else {
                    uniqueCalls.add(`visit:${visit.id}`);
                }
            });
            if (visitsTodayElement) visitsTodayElement.textContent = String(uniqueCalls.size);
        } catch (error) {
            console.error('Error loading today calls:', error);
            if (visitsTodayElement) visitsTodayElement.textContent = 'Unable to load';
        }
    }

    async clearForm(options = {}) {
        const {
            preserveMessage = false,
            renderOutlets = true,
            refreshTodayCalls = true
        } = options;
        this.selectedProducts = [];
        this.photos = [];
        this.isNewOutlet = false;
        this.outletMode = 'all';

        document.querySelectorAll('.qty-input').forEach(input => { input.value = ''; });
        document.querySelectorAll('.visit-checkbox').forEach(checkbox => { checkbox.checked = false; });
        document.querySelectorAll('.checklist-item').forEach(item => item.classList.remove('checked'));
        document.querySelectorAll('.mode-btn').forEach(button => {
            button.classList.toggle('active', button.dataset.mode === 'all');
        });
        document.querySelectorAll('.type-tag').forEach(tag => {
            tag.classList.toggle('active', tag.dataset.type === 'all');
        });

        const valuesToClear = [
            'notes', 'latitude', 'longitude', 'locationMapUrl', 'newOutletName',
            'newOutletContact', 'newOutletEmail', 'newOutletLocation', 'selectedOutletType'
        ];
        valuesToClear.forEach(id => {
            const element = document.getElementById(id);
            if (element) element.value = '';
        });

        const photoInput = document.getElementById('photoInput');
        if (photoInput) photoInput.value = '';
        const photoPreview = document.getElementById('photoPreview');
        if (photoPreview) photoPreview.replaceChildren();
        const newOutletType = document.getElementById('newOutletType');
        if (newOutletType) newOutletType.value = '';
        const notesTemplate = document.getElementById('notesTemplate');
        if (notesTemplate) notesTemplate.value = '';
        const visitDate = document.getElementById('visitDate');
        if (visitDate) visitDate.value = this.getTodayIST();
        const visitType = document.getElementById('visitType');
        if (visitType) visitType.value = 'Regular';
        const productFilter = document.getElementById('productTypeFilter');
        if (productFilter) productFilter.value = 'all';
        const outletSelect = document.getElementById('outletSel');
        if (outletSelect) outletSelect.value = '';

        document.getElementById('existingOutletBox')?.classList.remove('hidden');
        document.getElementById('newOutletBox')?.classList.add('hidden');
        document.getElementById('existingOutletBtn')?.classList.add('active');
        document.getElementById('newOutletBtn')?.classList.remove('active');

        const productSummary = document.getElementById('productSummary');
        if (productSummary) productSummary.replaceChildren();
        if (!preserveMessage) {
            const message = document.getElementById('successMessage');
            if (message) {
                message.textContent = '';
                message.className = 'message';
            }
        }

        this.resetOutletInsights();
        this.updateOutletSelectColour();
        this.renderProductList();
        if (renderOutlets && this.currentDistributor) await this.renderOutlets();
        if (refreshTodayCalls) await this.loadTodayCalls();
    }

    // ========== MESSAGES ==========
    showMessage(text, type, elementId = 'successMessage') {
        // 1. Update the legacy element if it exists
        const msg = document.getElementById(elementId);
        if (msg) {
            msg.textContent = text;
            msg.className = `message ${type} show`;
            setTimeout(() => msg.classList.remove('show'), 5000);
        }

        // 2. Always show a toast popup at the top
        const toast = document.createElement('div');
        toast.className = `toast-message toast-${type}`;
        toast.textContent = text;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#17a2b8'};
            color: white;
            padding: 12px 20px;
            border-radius: 30px;
            font-size: 14px;
            font-weight: 500;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            width: max-content;
            max-width: min(90vw, 520px);
            white-space: normal;
            overflow-wrap: anywhere;
            text-align: center;
            pointer-events: none;
            animation: fadeInOut 3s ease forwards;
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

}

// ============================================
// INITIALIZE
// ============================================
const app = new K95VisitApp();
window.app = app;
