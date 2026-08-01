console.log('Order Form module loaded');

let supabaseClient = null;
let supabaseAvailable = false;

if (typeof window.supabase === 'undefined') {
    console.error('Supabase library not loaded. Check network or CSP.');
    alert('Supabase library failed to load. Please refresh or contact admin.');
} else {
    console.log('Supabase library detected');
    supabaseAvailable = true;
}

const SUPABASE_URL = 'https://jaasosewjbrwdklscxrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphYXNvc2V3amJyd2RrbHNjeHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMjAxMDEsImV4cCI6MjA4NTY5NjEwMX0.OE-dD6EN5DR3fvnaAd9jW3cJ7_5sYXNkY5vOQFQ00w0';
const REMEMBER_ME_KEY = 'k95_remember_me';

// Use the same persistent/session-only authentication choice as the home page.
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
    console.log('Supabase client with proxy initialized');
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
    if (!supabaseAvailable || !supabaseClient) {
        throw new Error('Supabase client not available. Please refresh the page or contact admin.');
    }
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

// Cache with TTL (60 seconds)
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
class K95OrderApp {
    constructor() {
        this.CACHE = {
            USER: 'k95_user',
            LAST_DISTRIBUTOR: 'k95_last_distributor',
            OUTLETS: 'k95_outlets_',
            PRODUCTS: 'k95_products',
            INVENTORY: 'k95_inventory_',
            EMAIL: 'k95_last_email'      // new: store email separately
        };
        this.currentUser = null;
        this.currentDistributor = null;
        this.distributorsList = [];
        this.outletsData = [];
        this.productsData = [];
        this.inventory = {};
        this.reorderLevels = {}; // store reorder levels per product
        this.orderItems = {};
        this.nonBuyerOutletIds = new Set();
        this.orderedOutletIds = new Set();
        this.visitedOutletIds = new Set();
        this.currentAccess = null;
        this.isNewOutlet = false;
        this.outletMode = 'all';
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
        const avatar = document.getElementById('orderUserAvatar');
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

    async init() {
        console.log('K95 Foods - Initializing...');
        try {
            if (!supabaseClient) throw new Error('Supabase client is unavailable');
            const { data: { session }, error } = await supabaseClient.auth.getSession();
            if (error) throw error;
            if (!session?.user?.email) {
                this.showPageState('Please sign in from the home page to use the Order Form.', 'error');
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

            const permission = access.tile_permissions?.order_form?.access;
            if (!permission || permission === 'none') {
                this.showPageState('You do not have access to the Order Form.', 'error');
                return;
            }

            this.currentAccess = access;
            this.renderUserAvatar();
            await this.loadDistributorsForUser();
        } catch (error) {
            console.error('Order Form initialization failed:', error);
            this.showPageState('Unable to load the Order Form. Please return to the home page and try again.', 'error');
        }
    }

    async loadDistributorsForUser() {
        this.showPageState('Loading your distributors...');

        const userRole = this.currentAccess?.role_name || 'user';
        const allowedDistributorIds = this.currentAccess?.distributor_ids || [];
        let query = supabaseClient
            .from('distributors')
            .select('distributor_id, distributor_name')
            .eq('status', 'Active')
            .order('distributor_name');

        if (userRole !== 'admin' && userRole !== 'nsm') {
            if (allowedDistributorIds.length === 0) {
                this.showPageState('No distributors are assigned to your account.', 'error');
                return;
            }
            query = query.in('distributor_id', allowedDistributorIds);
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
        if (!selectedDistributor) {
            console.error('Distributor not found in list');
            return;
        }

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

        document.getElementById('orderSection').style.display = 'none';
        this.showPageState(`Loading ${selectedDistributor.distributor_name}...`);
        this.clearForm({ preserveMessage: false, renderOutlets: false });

        try {
            const outletKey = this.CACHE.OUTLETS + distributorId;
            this.outletsData = await getCachedOrFetch(outletKey, async () => {
                const data = await supabaseFetch('outlets', {
                    filters: { distributor_id: distributorId, status: 'Active' }
                });
                return data.sort((a, b) => (a.outlet_name || '').localeCompare(b.outlet_name || ''));
            }, 60000);
            console.log('Outlets loaded:', this.outletsData.length);

            await this.loadOutletStatuses(distributorId);
            this.renderOutlets();
            await this.loadProducts();
            await this.loadInventory(distributorId);
            this.hidePageState();
            document.getElementById('orderSection').style.display = 'block';
        } catch (error) {
            console.error('Error loading data:', error);
            this.showPageState('Failed to load this distributor. Please select it again or try another distributor.', 'error');
        } finally {
            if (distributorSelect) distributorSelect.disabled = false;
            this.isLoadingDistributor = false;
        }
    }

    getCurrentMonthBounds() {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit'
        });
        const parts = Object.fromEntries(formatter.formatToParts(new Date())
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value]));
        const year = Number(parts.year);
        const month = Number(parts.month);
        const nextYear = month === 12 ? year + 1 : year;
        const nextMonth = month === 12 ? 1 : month + 1;
        const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
        const nextMonthStart = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
        return {
            reportMonth: monthStart,
            nextMonthStart,
            startIso: new Date(`${monthStart}T00:00:00+05:30`).toISOString(),
            endIso: new Date(`${nextMonthStart}T00:00:00+05:30`).toISOString()
        };
    }

    async loadOutletStatuses(distributorId) {
        const { reportMonth, nextMonthStart, startIso, endIso } = this.getCurrentMonthBounds();
        const [nonBuyersResult, ordersResult, visitsResult] = await Promise.all([
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
                .neq('order_status', 'Cancelled'),
            supabaseClient
                .from('visits')
                .select('outlet_id')
                .eq('distributor_id', distributorId)
                .gte('visit_date', reportMonth)
                .lt('visit_date', nextMonthStart)
                .not('outlet_id', 'is', null)
        ]);

        if (nonBuyersResult.error) throw nonBuyersResult.error;
        if (ordersResult.error) throw ordersResult.error;
        if (visitsResult.error) throw visitsResult.error;

        this.nonBuyerOutletIds = new Set((nonBuyersResult.data || []).map(row => row.outlet_id));
        this.orderedOutletIds = new Set((ordersResult.data || []).map(row => row.outlet_id));
        this.visitedOutletIds = new Set((visitsResult.data || []).map(row => row.outlet_id));
    }

    async loadInventory(distributorId) {
        const invKey = this.CACHE.INVENTORY + distributorId;
        try {
            const inventoryData = await getCachedOrFetch(invKey, async () => {
                const { data, error } = await supabaseClient
                    .from('distributor_inventory')
                    .select('product_id, quantity_on_hand, reorder_level')
                    .eq('distributor_id', distributorId);
                if (error) throw error;
                return data;
            }, 60000);
            this.inventory = {};
            this.reorderLevels = {};
            inventoryData.forEach(item => {
                this.inventory[item.product_id] = item.quantity_on_hand;
                this.reorderLevels[item.product_id] = item.reorder_level || 5;
            });
            this.displayProducts();
        } catch (error) {
            console.error('Error loading inventory:', error);
            // Fallback for testing
            this.productsData.forEach(p => {
                if (!this.inventory[p.product_id]) {
                    this.inventory[p.product_id] = Math.floor(Math.random() * 50) + 20;
                    this.reorderLevels[p.product_id] = 5;
                }
            });
        }
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
        this.renderOutlets();
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
        if (this.orderedOutletIds.has(outletId)) return 'outlet-ordered';
        if (this.visitedOutletIds.has(outletId)) return 'outlet-visited';
        return 'outlet-no-activity';
    }

    renderOutlets() {
        const select = document.getElementById('outletSel');
        const typeButtons = document.getElementById('outletTypeButtons');

        return this.getOutletsByMode().then(filteredOutlets => {
            filteredOutlets.sort((a, b) => (a.outlet_name || '').toLowerCase().localeCompare(b.outlet_name || ''));

            const types = [...new Set(filteredOutlets.map(o => o.outlet_type || 'UNKNOWN'))];
            typeButtons.innerHTML = '<button type="button" class="outlet-type-btn active" data-type="ALL" onclick="k95App.filterOutletsByType(\'ALL\')">All</button>' +
                types.map(t => `<button type="button" class="outlet-type-btn" data-type="${t}" onclick="k95App.filterOutletsByType('${t}')">${t}</button>`).join('');

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
        if (isNew) this.handleOutletNameInput();
    }

    handleOutletNameInput() {
        let v = document.getElementById('newOutletName').value;
        v = v.replace(/\b\w/g, c => c.toUpperCase());
        document.getElementById('newOutletName').value = v;
        const clean = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const outletId = clean ? `${clean.slice(0,6)}-${Math.random().toString(36).substring(2,6).toUpperCase()}` : '';
        document.getElementById('newOutletId').textContent = outletId;
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
    }

    updateOutletSelectColour() {
        const select = document.getElementById('outletSel');
        if (!select) return;
        select.classList.remove('outlet-nonbuyer', 'outlet-ordered', 'outlet-beatplan', 'outlet-visited', 'outlet-no-activity');
        const statusClass = select.selectedOptions[0]?.dataset.statusClass;
        if (statusClass) select.classList.add(statusClass);
    }

    async detectLocation() {
        if (!this.isNewOutlet) {
            this.showMessage('Please select "Create New Outlet" first.', 'error');
            return;
        }
        
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
                const mapUrlInput = document.getElementById('newOutletMapUrl');
                
                if (!latInput || !lngInput || !locationInput || !mapUrlInput) {
                    throw new Error('Location input elements not found in DOM');
                }
                
                latInput.value = latitude;
                lngInput.value = longitude;
                
                const googleMapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
                mapUrlInput.value = googleMapsUrl;
                console.log('Map URL set:', googleMapsUrl);
                
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

    applyCommentTemplate(template) {
        const commentBox = document.getElementById('commentBox');
        if (!commentBox || !template) return;
        commentBox.value = template;
        commentBox.focus();
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

    async loadProducts() {
        const container = document.getElementById('productList');
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
                typeTags.innerHTML = '<div class="type-tag active" data-type="all" onclick="k95App.setActiveType(\'all\')">All Types</div>';
                productTypes.forEach(type => {
                    const tag = document.createElement('div');
                    tag.className = 'type-tag';
                    tag.dataset.type = type;
                    tag.onclick = () => this.setActiveType(type);
                    tag.textContent = type;
                    typeTags.appendChild(tag);
                });
            }

            this.displayProducts();
        } catch (error) {
            console.error('Error loading products:', error);
            if (container) container.innerHTML = '<div class="empty-state">Error loading products</div>';
        }
    }

    displayProducts() {
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
            const currentQty = this.orderItems[product.product_id]?.qty ?? '';
            const stock = this.inventory[product.product_id] || 0;

            const div = document.createElement('div');
            div.className = 'product-item';
            div.innerHTML = `
                <div class="product-info">
                    <div class="product-name">${product.product_name}</div>
                    <div class="product-meta">
                        <span class="product-price">₹${product.case_rate}/case</span>
                        <span class="product-stock">Stock: ${stock}</span>
                        ${product.pack_size ? `<span>${product.pack_size}</span>` : ''}
                    </div>
                </div>
                <div class="quantity-controls">
                    <button class="qty-btn" onclick="k95App.updateQuantity('${product.product_id}', -1)">-</button>
                    <input type="number" id="qty_${product.product_id}" class="qty-input" value="${currentQty}" min="0" inputmode="numeric" placeholder="" onchange="k95App.updateQuantityInput('${product.product_id}', this.value)">
                    <button class="qty-btn" onclick="k95App.updateQuantity('${product.product_id}', 1)">+</button>
                </div>
            `;
            container.appendChild(div);
        });
    }

    filterProductsByType() {
        this.displayProducts();
        this.calculateSummary();
    }

    setActiveType(type) {
        document.querySelectorAll('.type-tag').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.type-tag').forEach(t => {
            if (t.dataset.type === type) t.classList.add('active');
        });
        document.getElementById('productTypeFilter').value = type;
        this.displayProducts();
    }

    updateQuantity(productId, delta) {
        const input = document.getElementById(`qty_${productId}`);
        if (!input) return;
        let value = parseInt(input.value) || 0;
        value = Math.max(0, value + delta);
        input.value = value > 0 ? value : '';
        if (value > 0) {
            const product = this.productsData.find(p => p.product_id === productId);
            if (product) {
                this.orderItems[productId] = {
                    product_id: productId,
                    product_name: product.product_name,
                    qty: value,
                    rate: product.case_rate
                };
            }
        } else {
            delete this.orderItems[productId];
        }
        this.calculateSummary();
    }

    updateQuantityInput(productId, value) {
        const qty = parseInt(value) || 0;
        if (qty >= 0) {
            if (qty > 0) {
                const product = this.productsData.find(p => p.product_id === productId);
                if (product) {
                    this.orderItems[productId] = {
                        product_id: productId,
                        product_name: product.product_name,
                        qty: qty,
                        rate: product.case_rate
                    };
                }
            } else {
                delete this.orderItems[productId];
            }
            this.calculateSummary();
        }
    }

    calculateSummary() {
        let totalAmount = 0;
        const previewBody = document.getElementById('previewBody');
        if (Object.keys(this.orderItems).length === 0) {
            previewBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:30px; color:#999;">No items added</td></tr>';
            document.getElementById('totalAmount').textContent = '₹0.00';
            return;
        }
        let rows = '';
        Object.values(this.orderItems).forEach(item => {
            const lineTotal = item.qty * parseFloat(item.rate);
            totalAmount += lineTotal;
            rows += `<tr><td>${item.product_name}</td><td style="text-align:center;">${item.qty}</td><td style="text-align:right;">₹${lineTotal.toFixed(2)}</td></tr>`;
        });
        previewBody.innerHTML = rows;
        document.getElementById('totalAmount').textContent = `₹${totalAmount.toFixed(2)}`;
    }

    showProcessing(title = 'Processing order...', detail = 'Please keep this page open.') {
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

    async submitOrder() {
        if (this.submitting) {
            console.warn('Order submission is already in progress');
            return;
        }

        if (!this.currentUser || !this.currentDistributor) {
            this.showMessage('Your user or distributor session is missing. Please return to the home page and try again.', 'error');
            return;
        }

        if (Object.keys(this.orderItems).length === 0) {
            this.showMessage('Please add at least one product.', 'error');
            return;
        }

        let outletId = '';
        let newOutlet = null;

        if (this.isNewOutlet) {
            const name = document.getElementById('newOutletName').value.trim();
            const visitDay = document.getElementById('newOutletVisitDay').value;
            const type = document.getElementById('newOutletType').value;
            const contact = document.getElementById('newOutletContact').value.trim();

            if (!name) {
                this.showMessage('Outlet name is required.', 'error');
                return;
            }
            if (!visitDay) {
                this.showMessage('Please select a visit day.', 'error');
                return;
            }
            if (!type) {
                this.showMessage('Please select an outlet type.', 'error');
                return;
            }
            if (contact && (!/^\d+$/.test(contact) || contact.length > 10)) {
                this.showMessage('Contact number can contain up to 10 digits.', 'error');
                return;
            }

            outletId = document.getElementById('newOutletId').textContent ||
                `OUT${Date.now().toString().slice(-8)}-${Math.random().toString(36).substring(2, 4).toUpperCase()}`;
            newOutlet = {
                outlet_id: outletId,
                outlet_name: name,
                distributor_id: this.currentDistributor.distributor_id,
                outlet_type: type,
                status: 'Active',
                visit_day: visitDay,
                location: document.getElementById('newOutletLocation').value.trim() || null,
                Contact: contact || null,
                "Email ID": document.getElementById('newOutletEmail').value.trim() || null,
                location_url: document.getElementById('newOutletMapUrl').value.trim() || null,
                created_at: new Date().toISOString()
            };
        } else {
            outletId = document.getElementById('outletSel').value;
            if (!outletId) {
                this.showMessage('Please select an outlet.', 'error');
                return;
            }
        }

        this.submitting = true;
        const submitBtn = document.getElementById('submitBtn');
        const clearBtn = document.getElementById('clearBtn');
        if (submitBtn) submitBtn.disabled = true;
        if (clearBtn) clearBtn.disabled = true;
        this.showProcessing('Processing order...', 'Validating and preparing your order.');

        try {
            if (newOutlet) {
                this.updateProcessing('Creating outlet...', 'Saving the new outlet details.');
                await supabaseInsert('outlets', newOutlet);
                localStorage.removeItem(this.CACHE.OUTLETS + this.currentDistributor.distributor_id);
                this.outletsData = await supabaseFetch('outlets', {
                    filters: { distributor_id: this.currentDistributor.distributor_id, status: 'Active' }
                });
                this.outletsData.sort((a, b) => (a.outlet_name || '').localeCompare(b.outlet_name || ''));
                localStorage.setItem(
                    this.CACHE.OUTLETS + this.currentDistributor.distributor_id,
                    JSON.stringify({ data: this.outletsData, timestamp: Date.now() })
                );
                this.toggleNewOutlet(false);
                await this.renderOutlets();
                document.getElementById('outletSel').value = outletId;
                document.getElementById('selectedOutletType').value = newOutlet.outlet_type;
                this.updateOutletSelectColour();
            }

            this.updateProcessing('Saving order...', 'Creating the Draft order and its product lines.');
            let userId = this.currentDistributor.distributor_id;
            try {
                const users = await supabaseFetch('users', { filters: { email_id: this.currentUser.email } });
                if (users?.length) userId = users[0].employee_id;
            } catch (error) {
                console.warn('Employee record lookup failed; using distributor identifier');
            }

            const orderNumber = `ORD-${Date.now()}`;
            const itemsArray = Object.values(this.orderItems).map(item => ({
                product_id: item.product_id,
                product_name: item.product_name,
                qty: item.qty,
                rate: item.rate
            }));
            const orderData = {
                order_number: orderNumber,
                user_id: userId,
                distributor_id: this.currentDistributor.distributor_id,
                outlet_id: outletId,
                comment: document.getElementById('commentBox').value.trim() || null,
                fulfillment_type: document.getElementById('fulfillmentSel').value,
                order_status: 'Draft',
                created_by_email: this.currentUser.email,
                items: itemsArray
            };

            const orders = await supabaseInsert('orders', orderData);
            const order = orders[0];
            for (const item of Object.values(this.orderItems)) {
                await supabaseInsert('order_items', {
                    order_id: order.id,
                    product_id: item.product_id,
                    qty: item.qty,
                    rate: item.rate
                });
            }

            this.orderedOutletIds.add(outletId);
            this.clearForm({ preserveMessage: true });
            this.showProcessingSuccess('Order saved successfully', `${orderNumber} was saved as Draft.`);
            await new Promise(resolve => setTimeout(resolve, 700));
            this.hideProcessing();
            this.showMessage(`Order ${orderNumber} was saved successfully as Draft.`, 'success');
        } catch (error) {
            console.error('Error submitting order:', error);
            this.hideProcessing();
            this.showMessage('Order could not be saved: ' + error.message, 'error');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
            if (clearBtn) clearBtn.disabled = false;
            this.submitting = false;
            console.log('Order submission completed');
        }
    }

    clearForm(options = {}) {
        const { preserveMessage = false, renderOutlets = true } = options;
        this.orderItems = {};
        this.isNewOutlet = false;
        this.outletMode = 'all';

        document.querySelectorAll('.qty-input').forEach(input => { input.value = ''; });
        document.querySelectorAll('.mode-btn').forEach(button => {
            button.classList.toggle('active', button.dataset.mode === 'all');
        });
        document.querySelectorAll('.type-tag').forEach(tag => {
            tag.classList.toggle('active', tag.dataset.type === 'all');
        });

        const valuesToClear = [
            'commentBox', 'newOutletName', 'newOutletLocation', 'newOutletContact',
            'newOutletEmail', 'newOutletMapUrl', 'latitude', 'longitude', 'locationMapUrl',
            'selectedOutletType'
        ];
        valuesToClear.forEach(id => {
            const element = document.getElementById(id);
            if (element) element.value = '';
        });

        const outletId = document.getElementById('newOutletId');
        if (outletId) outletId.textContent = '';
        const visitDay = document.getElementById('newOutletVisitDay');
        if (visitDay) visitDay.value = '';
        const outletType = document.getElementById('newOutletType');
        if (outletType) outletType.value = '';
        const fulfillment = document.getElementById('fulfillmentSel');
        if (fulfillment) fulfillment.value = 'Distributor';
        const commentTemplate = document.getElementById('commentTemplate');
        if (commentTemplate) commentTemplate.value = '';
        const productFilter = document.getElementById('productTypeFilter');
        if (productFilter) productFilter.value = 'all';
        const outletSelect = document.getElementById('outletSel');
        if (outletSelect) outletSelect.value = '';

        document.getElementById('existingOutletBox')?.classList.remove('hidden');
        document.getElementById('newOutletBox')?.classList.add('hidden');
        document.getElementById('existingOutletBtn')?.classList.add('active');
        document.getElementById('newOutletBtn')?.classList.remove('active');

        if (!preserveMessage) {
            const message = document.getElementById('successMessage');
            if (message) {
                message.textContent = '';
                message.className = 'message';
            }
        }

        this.updateOutletSelectColour();
        this.displayProducts();
        this.calculateSummary();
        if (renderOutlets && this.currentDistributor) this.renderOutlets();
    }

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
        max-width: calc(100vw - 32px);
        white-space: normal;
        line-height: 1.35;
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
const k95App = new K95OrderApp();
window.k95App = k95App;
