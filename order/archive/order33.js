// ============================================
// K95 FOODS - ENHANCED SALES ORDER SYSTEM (FINAL v2)
// ============================================
console.log('✅ NEW order.js loaded – proxy enabled');

const SUPABASE_URL = 'https://jaasosewjbrwdklscxrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphYXNvc2V3amJyd2RrbHNjeHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMjAxMDEsImV4cCI6MjA4NTY5NjEwMX0.OE-dD6EN5DR3fvnaAd9jW3cJ7_5sYXNkY5vOQFQ00w0';

// Create Supabase client with custom fetch that uses the proxy
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

                // Use absolute path to proxy.php (located in /salesk95/)
                const proxyUrl = new URL('/salesk95/proxy.php', window.location.origin);
                proxyUrl.searchParams.set('type', type);
                proxyUrl.searchParams.set('path', apiPath);

                // Append original query parameters
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

// ============================================
// HELPER FUNCTIONS (supabaseFetch, etc.) – keep them unchanged
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
        console.error(`❌ Error inserting into ${table}:`, error);
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
            INVENTORY: 'k95_inventory_'
        };
        this.currentUser = null;
        this.currentDistributor = null;
        this.distributorsList = [];
        this.outletsData = [];
        this.productsData = [];
        this.inventory = {};
        this.orderItems = {};
        this.isNewOutlet = false;
        this.outletMode = 'all';
        this.submitting = false; // double‑click guard
        this.init();
    }

    async init() {
        console.log('K95 Foods - Initializing...');
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error) {
            console.error('Session check error:', error);
            const savedUser = localStorage.getItem(this.CACHE.USER);
            if (savedUser) {
                try {
                    const userData = JSON.parse(savedUser);
                    document.getElementById('email').value = userData.email;
                    this.currentUser = { email: userData.email };
                    document.getElementById('userEmail').textContent = userData.email;
                    document.getElementById('logoutBtn').style.display = 'block';
                    setTimeout(() => this.handleGetDistributors(), 100);
                } catch (e) {
                    localStorage.removeItem(this.CACHE.USER);
                }
            }
            return;
        }

        if (session) {
            this.currentUser = { email: session.user.email };
            document.getElementById('email').value = session.user.email;
            document.getElementById('userEmail').textContent = session.user.email;
            document.getElementById('logoutBtn').style.display = 'block';

            try {
                const { data: access, error: accessError } = await supabaseClient
                    .from('access_manager')
                    .select('tile_permissions')
                    .eq('user_email', session.user.email)
                    .single();

                if (accessError) throw accessError;

                const perm = access?.tile_permissions?.order_form?.access;
                if (!perm || perm === 'none') {
                    this.showMessage('You do not have access to the Order Form.', 'error');
                    setTimeout(() => { window.location.href = '/salesk95/order/order.html'; }, 2000);
                    return;
                }

                setTimeout(() => this.handleGetDistributors(), 100);
            } catch (err) {
                console.error('Tile access check failed:', err);
                this.showMessage('Permission check failed. Please contact admin.', 'error');
            }
        } else {
    const savedUser = localStorage.getItem(this.CACHE.USER);
    if (savedUser) {
        try {
            const userData = JSON.parse(savedUser);
            document.getElementById('email').value = userData.email;
            this.currentUser = { email: userData.email };
            document.getElementById('userEmail').textContent = userData.email;
            document.getElementById('logoutBtn').style.display = 'block';
            setTimeout(() => this.handleGetDistributors(), 100);
        } catch (e) {
            localStorage.removeItem(this.CACHE.USER);
            // fall through to refresh attempt
        }
    }
    
    // No saved user or it failed – try to refresh the session once
    try {
        const { data, error } = await supabaseClient.auth.refreshSession();
        if (data.session) {
            // Session restored, proceed
            this.currentUser = { email: data.session.user.email };
            document.getElementById('email').value = data.session.user.email;
            document.getElementById('userEmail').textContent = data.session.user.email;
            document.getElementById('logoutBtn').style.display = 'block';
            setTimeout(() => this.handleGetDistributors(), 100);
            return; // prevent redirect
        }
    } catch (e) {
        console.warn('Session refresh failed', e);
    }
    
    // If still no session, redirect to home
    window.location.href = '/salesk95/index.html';
}
    async handleGetDistributors() {
        console.log('handleGetDistributors started');
        const email = document.getElementById('email').value.trim();
        if (!email) return this.showMessage('Please enter your email', 'error', 'loginMessage');
        this.showMessage('Fetching your distributors...', 'success', 'loginMessage');
        try {
            const allDistributors = await supabaseFetch('distributors', { filters: { status: 'Active' } });
            console.log('All distributors fetched:', allDistributors);
            const distributors = allDistributors.filter(dist => {
                if (!dist.allowed_emails) return false;
                const emails = dist.allowed_emails.split(',').map(e => e.trim().toLowerCase());
                return emails.includes(email.toLowerCase());
            });
            console.log('Filtered distributors:', distributors);
            if (!distributors.length) {
                return this.showMessage('No distributors found for this email', 'error', 'loginMessage');
            }
            this.distributorsList = distributors;
            this.currentUser = { email };
            localStorage.setItem(this.CACHE.USER, JSON.stringify({ email, distributors: distributors.map(d => d.distributor_id) }));
            document.getElementById('userEmail').textContent = email;
            document.getElementById('logoutBtn').style.display = 'block';
    
            distributors.sort((a, b) => a.distributor_name.localeCompare(b.distributor_name));
            const distributorSelect = document.getElementById('distributorSel');
            distributorSelect.innerHTML = '<option value="">Select your distributor...</option>';
            distributors.forEach(dist => {
                const option = document.createElement('option');
                option.value = dist.distributor_id;
                option.textContent = dist.distributor_name;
                distributorSelect.appendChild(option);
            });
    
            document.getElementById('distributorSection').style.display = 'block';
            document.getElementById('distributorMessage').textContent = `Found ${distributors.length} distributor(s)`;
    
            const lastDistributorId = localStorage.getItem(this.CACHE.LAST_DISTRIBUTOR);
            if (lastDistributorId && distributors.some(d => d.distributor_id === lastDistributorId)) {
                distributorSelect.value = lastDistributorId;
                await this.onDistributorChange(lastDistributorId);
            }
            this.showMessage(`Found ${distributors.length} distributor(s)`, 'success', 'loginMessage');
        } catch (error) {
            console.error('Error fetching distributors:', error);
            this.showMessage('Error: ' + error.message, 'error', 'loginMessage');
        }
    }
    
    async onDistributorChange(distributorId) {
        console.log('onDistributorChange called for:', distributorId);
        if (!distributorId) return;
        this.currentDistributor = this.distributorsList.find(d => d.distributor_id === distributorId);
        if (!this.currentDistributor) {
            console.error('Distributor not found in list');
            return;
        }
        localStorage.setItem(this.CACHE.LAST_DISTRIBUTOR, distributorId);
        const userData = JSON.parse(localStorage.getItem(this.CACHE.USER) || '{}');
        userData.distributor_id = distributorId;
        userData.distributor_name = this.currentDistributor.distributor_name;
        localStorage.setItem(this.CACHE.USER, JSON.stringify(userData));
    
        document.getElementById('distributorDisplay').textContent = this.currentDistributor.distributor_name;
        document.getElementById('orderSection').style.display = 'block';
        document.getElementById('loginSection').style.display = 'none';
    
        const outletKey = this.CACHE.OUTLETS + distributorId;
        try {
            this.outletsData = await getCachedOrFetch(outletKey, async () => {
                const data = await supabaseFetch('outlets', {
                    filters: { distributor_id: distributorId, status: 'Active' }
                });
                return data.sort((a, b) => (a.outlet_name || '').localeCompare(b.outlet_name || ''));
            }, 60000);
            console.log('Outlets loaded:', this.outletsData.length);
    
            this.renderOutlets();
            await this.loadProducts();
            await this.loadInventory(distributorId);
        } catch (error) {
            console.error('Error loading data:', error);
            this.showMessage('Failed to load data: ' + error.message, 'error', 'loginMessage');
        }
    }

    async loadInventory(distributorId) {
        const invKey = this.CACHE.INVENTORY + distributorId;
        try {
            const inventoryData = await getCachedOrFetch(invKey, async () => {
                const { data, error } = await supabaseClient
                    .from('distributor_inventory')
                    .select('product_id, quantity_on_hand')
                    .eq('distributor_id', distributorId);
                if (error) throw error;
                return data;
            }, 60000);
            this.inventory = {};
            inventoryData.forEach(item => { this.inventory[item.product_id] = item.quantity_on_hand; });
            this.displayProducts();
        } catch (error) {
            console.error('Error loading inventory:', error);
            this.productsData.forEach(p => {
                if (!this.inventory[p.product_id]) this.inventory[p.product_id] = Math.floor(Math.random() * 50) + 20;
            });
        }
    }

    setOutletMode(mode) {
        this.outletMode = mode;
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        this.renderOutlets();
    }

    async getOutletsByMode() {
        if (!this.currentDistributor) return [];
        const distributorId = this.currentDistributor.distributor_id;

        if (this.outletMode === 'all') {
            return this.outletsData;
        } else if (this.outletMode === 'nonbuyers') {
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const monthStart = `${year}-${month}-01`;
            const { data, error } = await supabaseClient
                .from('non_buyers')
                .select('outlet_id')
                .eq('report_month', monthStart)
                .eq('distributor_id', distributorId);
            if (error) throw error;
            const nonBuyerIds = data.map(nb => nb.outlet_id);
            return this.outletsData.filter(o => nonBuyerIds.includes(o.outlet_id));
        } else if (this.outletMode === 'beatplan') {
            const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
            return this.outletsData.filter(o => o.visit_day === todayName);
        }
        return [];
    }

    renderOutlets() {
        const select = document.getElementById('outletSel');
        const typeButtons = document.getElementById('outletTypeButtons');

        this.getOutletsByMode().then(filteredOutlets => {
            filteredOutlets.sort((a, b) => (a.outlet_name || '').toLowerCase().localeCompare(b.outlet_name || ''));

            const types = [...new Set(filteredOutlets.map(o => o.outlet_type || 'UNKNOWN'))];
            typeButtons.innerHTML = '<button type="button" class="outlet-type-btn active" data-type="ALL" onclick="app.filterOutletsByType(\'ALL\')">All</button>' +
                types.map(t => `<button type="button" class="outlet-type-btn" data-type="${t}" onclick="app.filterOutletsByType('${t}')">${t}</button>`).join('');

            select.innerHTML = '<option value="">Choose an outlet...</option>';
            filteredOutlets.forEach(outlet => {
                const option = document.createElement('option');
                option.value = outlet.outlet_id;
                option.dataset.type = outlet.outlet_type;
                option.textContent = `${outlet.outlet_name} - ${outlet.outlet_type}`;
                select.appendChild(option);
            });

            const newOption = document.createElement('option');
            newOption.value = 'new';
            newOption.textContent = '➕ Create New Outlet';
            select.appendChild(newOption);
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
        const selected = this.outletsData.find(o => o.outlet_id === document.getElementById('outletSel').value);
        document.getElementById('selectedOutletType').value = selected?.outlet_type || '';
    }

// FIXED: Simplified detectLocation - uses coordinates only, no reverse geocoding
// Enhanced detectLocation with reverse geocoding via proxy
// Enhanced detectLocation with BigDataCloud API (Free, No CORS issues)
// FIXED: detectLocation using BigDataCloud API (No CORS issues)
// FIXED: detectLocation with proper map URL and address
async detectLocation() {
    // Check if we're in "Create New Outlet" mode
    if (!this.isNewOutlet) {
        this.showMessage('⚠️ Please select "Create New Outlet" first', 'error');
        return;
    }
    
    const maxRetries = 5;
    
    this.showMessage('📍 Detecting your location...', 'success');
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`📍 Location attempt ${attempt}/${maxRetries}`);
            
            // Get position with timeout
            const position = await this.getCurrentPosition(10000);
            const { latitude, longitude } = position.coords;
            
            console.log(`📍 Got coordinates: ${latitude}, ${longitude}`);
            
            // Get all DOM elements
            const latInput = document.getElementById('latitude');
            const lngInput = document.getElementById('longitude');
            const locationInput = document.getElementById('newOutletLocation');
            const mapUrlInput = document.getElementById('newOutletMapUrl');
            
            // Verify elements exist
            if (!latInput || !lngInput || !locationInput || !mapUrlInput) {
                console.error('Missing elements:', {
                    lat: !!latInput,
                    lng: !!lngInput,
                    loc: !!locationInput,
                    map: !!mapUrlInput
                });
                throw new Error('Location input elements not found in DOM');
            }
            
            // Set coordinates in hidden fields
            latInput.value = latitude;
            lngInput.value = longitude;
            
            // FIX 1: Generate Google Maps URL in the EXACT format you want
            const googleMapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
            mapUrlInput.value = googleMapsUrl;
            console.log('✅ Map URL set:', googleMapsUrl);
            
            // FIX 2: Try to get full address using BigDataCloud
            try {
                const addressUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`;
                
                const addressResponse = await fetch(addressUrl);
                
                if (addressResponse.ok) {
                    const addressData = await addressResponse.json();
                    
                    // Build a comprehensive address string
                    const addressParts = [];
                    
                    // Add locality/neighborhood
                    if (addressData.locality) addressParts.push(addressData.locality);
                    
                    // Add city/town
                    if (addressData.city) addressParts.push(addressData.city);
                    else if (addressData.town) addressParts.push(addressData.town);
                    
                    // Add principal subdivision (state)
                    if (addressData.principalSubdivision) addressParts.push(addressData.principalSubdivision);
                    
                    // Add country
                    if (addressData.countryName) addressParts.push(addressData.countryName);
                    
                    // Add postal code if available
                    if (addressData.postcode && addressParts.length > 1) {
                        addressParts.splice(addressParts.length - 1, 0, addressData.postcode);
                    }
                    
                    if (addressParts.length > 0) {
                        locationInput.value = addressParts.join(', ');
                        console.log('✅ Address set:', addressParts.join(', '));
                    } else {
                        // Fallback to coordinates if no address parts
                        locationInput.value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
                        console.log('⚠️ Using coordinates as fallback');
                    }
                } else {
                    // Fallback to coordinates
                    locationInput.value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
                    console.log('⚠️ Address API failed, using coordinates');
                }
            } catch (addressError) {
                console.warn('Address lookup failed:', addressError);
                locationInput.value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            }
            
            this.showMessage('✅ Location detected!', 'success');
            return; // Success
            
        } catch (error) {
            console.warn(`⚠️ Attempt ${attempt} failed:`, error.message);
            
            if (attempt < maxRetries) {
                const delay = 1000 * attempt;
                this.showMessage(`Retrying... (${attempt}/${maxRetries})`, 'success');
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    this.showMessage('❌ Location detection failed. Please enter manually.', 'error');
}

// Helper method to get current position with timeout
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

// Reverse geocoding via proxy to get full address
// Reverse geocoding using BigDataCloud (free, CORS-enabled)
// Reverse geocoding using CORS proxy (temporary)
// Reverse geocoding using BigDataCloud (free, CORS-enabled)
// DELETE THIS ENTIRE FUNCTION - IT'S CAUSING THE ERROR

        
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
            const currentQty = this.orderItems[product.product_id]?.qty || 0;
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
                    <button class="qty-btn" onclick="app.updateQuantity('${product.product_id}', -1)">-</button>
                    <input type="number" id="qty_${product.product_id}" class="qty-input" value="${currentQty}" min="0" onchange="app.updateQuantityInput('${product.product_id}', this.value)">
                    <button class="qty-btn" onclick="app.updateQuantity('${product.product_id}', 1)">+</button>
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
        input.value = value;
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

    async submitOrder(mode) {
        // Prevent multiple submissions
        if (this.submitting) {
            console.warn('⚠️ Submit already in progress – ignoring duplicate click');
            return;
        }
        this.submitting = true;
        
        // Disable buttons immediately
        const draftBtn = document.getElementById('draftBtn');
        const submitBtn = document.getElementById('submitBtn');
        if (draftBtn) draftBtn.disabled = true;
        if (submitBtn) submitBtn.disabled = true;
    
        let outletId;
    
        if (this.isNewOutlet) {
            const name = document.getElementById('newOutletName').value.trim();
            const visitDay = document.getElementById('newOutletVisitDay').value;
            const type = document.getElementById('newOutletType').value;
            const location = document.getElementById('newOutletLocation').value.trim();
            const contact = document.getElementById('newOutletContact').value.trim();
            const email = document.getElementById('newOutletEmail').value.trim();
            const mapUrl = document.getElementById('newOutletMapUrl').value.trim();
            const generatedId = document.getElementById('newOutletId').textContent;
    
            if (!name) {
                this.showMessage('Outlet name is required', 'error');
                this.submitting = false;
                if (draftBtn) draftBtn.disabled = false;
                if (submitBtn) submitBtn.disabled = false;
                return;
            }
    
            outletId = generatedId || `OUT${Date.now().toString().slice(-8)}-${Math.random().toString(36).substring(2,4).toUpperCase()}`;
    
            try {
                const newOutlet = {
                    outlet_id: outletId,
                    outlet_name: name,
                    distributor_id: this.currentDistributor.distributor_id,
                    outlet_type: type,
                    status: 'Active',
                    visit_day: visitDay,
                    location: location || null,
                    Contact: contact || null,
                    "Email ID": email || null,
                    location_url: mapUrl || null,
                    created_at: new Date().toISOString()
                };
                await supabaseInsert('outlets', newOutlet);
                console.log('Outlet created:', outletId);
                localStorage.removeItem(this.CACHE.OUTLETS + this.currentDistributor.distributor_id);
                this.outletsData = await supabaseFetch('outlets', {
                    filters: { distributor_id: this.currentDistributor.distributor_id, status: 'Active' }
                });
                this.outletsData.sort((a, b) => (a.outlet_name || '').localeCompare(b.outlet_name || ''));
                localStorage.setItem(this.CACHE.OUTLETS + this.currentDistributor.distributor_id, JSON.stringify({ data: this.outletsData, timestamp: Date.now() }));
                this.renderOutlets();
                this.toggleNewOutlet(false);
                document.getElementById('outletSel').value = outletId;
                const newOutletObj = this.outletsData.find(o => o.outlet_id === outletId);
                if (newOutletObj) document.getElementById('selectedOutletType').value = newOutletObj.outlet_type;
            } catch (error) {
                console.error('Error creating outlet:', error);
                this.showMessage('Failed to create outlet: ' + error.message, 'error');
                this.submitting = false;
                if (draftBtn) draftBtn.disabled = false;
                if (submitBtn) submitBtn.disabled = false;
                return;
            }
        } else {
            outletId = document.getElementById('outletSel').value;
            if (!outletId) {
                this.showMessage('Please select an outlet', 'error');
                this.submitting = false;
                if (draftBtn) draftBtn.disabled = false;
                if (submitBtn) submitBtn.disabled = false;
                return;
            }
        }
    
        if (Object.keys(this.orderItems).length === 0) {
            this.showMessage('Please add at least one product', 'error');
            this.submitting = false;
            if (draftBtn) draftBtn.disabled = false;
            if (submitBtn) submitBtn.disabled = false;
            return;
        }
    
        // Check inventory and low stock
        const insufficient = [];
        const lowStock = [];
        for (const [prodId, item] of Object.entries(this.orderItems)) {
            const available = this.inventory[prodId] || 0;
            if (item.qty > available) {
                insufficient.push(item.product_name);
            } else if (item.qty < 5 && item.qty > 0) {
                lowStock.push(item.product_name);
            }
        }
    
        if (insufficient.length > 0) {
            this.showMessage(`Insufficient stock for: ${insufficient.join(', ')}. Please reduce quantity or save as draft.`, 'error');
            this.submitting = false;
            if (draftBtn) draftBtn.disabled = false;
            if (submitBtn) submitBtn.disabled = false;
            return;
        }
    
        if (lowStock.length > 0) {
            if (!confirm(`Low stock warning for: ${lowStock.join(', ')}. Do you still want to submit?`)) {
                this.submitting = false;
                if (draftBtn) draftBtn.disabled = false;
                if (submitBtn) submitBtn.disabled = false;
                return;
            }
        }
    
        try {
            let userId = this.currentDistributor.distributor_id;
            try {
                const users = await supabaseFetch('users', { filters: { email_id: this.currentUser.email } });
                if (users && users.length > 0) userId = users[0].employee_id;
            } catch (e) { console.log('User fetch failed'); }
    
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
                comment: document.getElementById('commentBox').value || null,
                fulfillment_type: document.getElementById('fulfillmentSel').value,
                order_status: mode === 'draft' ? 'Draft' : 'Pending',
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
    
            // ===== SINGLE INVENTORY DEDUCTION =====
            // The database trigger will handle the actual deduction
            // We just need to refresh the local inventory display
            if (mode === 'submit' && orderData.fulfillment_type === 'Distributor') {
                console.log('📦 Order submitted - waiting for database trigger to deduct inventory');
                
                // Wait a moment for the database trigger to complete
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Refresh local inventory to show updated stock
                await this.loadInventory(this.currentDistributor.distributor_id);
                console.log('✅ Local inventory refreshed');
            }
            // ===== END OF SINGLE INVENTORY DEDUCTION =====
    
            this.showMessage(`✅ Order ${orderNumber} ${mode === 'draft' ? 'saved as draft' : 'submitted successfully'}!`, 'success');
    
            if (mode === 'submit') {
                this.clearForm();
            }
        } catch (error) {
            console.error('❌ Error submitting order:', error);
            this.showMessage('Error: ' + error.message, 'error');
        } finally {
            // Re-enable buttons
            if (draftBtn) draftBtn.disabled = false;
            if (submitBtn) submitBtn.disabled = false;
            this.submitting = false;
            console.log('🔓 Order submission completed');
        }
    }
    clearForm() {
        this.orderItems = {};
        document.querySelectorAll('.qty-input').forEach(i => i.value = 0);
        document.getElementById('commentBox').value = '';
        this.calculateSummary();
        document.getElementById('newOutletName').value = '';
        document.getElementById('newOutletLocation').value = '';
        document.getElementById('newOutletContact').value = '';
        document.getElementById('newOutletEmail').value = '';
        document.getElementById('newOutletMapUrl').value = '';
        document.getElementById('newOutletId').textContent = '';
        document.getElementById('newOutletVisitDay').value = 'Monday';
        document.getElementById('newOutletType').value = 'HVO';
        this.displayProducts();
    }

    showMessage(text, type, elementId = 'successMessage') {
        const msg = document.getElementById(elementId);
        if (msg) {
            msg.textContent = text;
            msg.className = `message ${type} show`;
            setTimeout(() => msg.classList.remove('show'), 5000);
        } else alert(text);
    }

    showInventoryWarning(message) {
        alert(message);
    }

    handleLogout() {
        localStorage.clear();
        this.currentUser = null;
        this.currentDistributor = null;
        this.distributorsList = [];
        this.orderItems = {};
        document.getElementById('userEmail').textContent = '';
        document.getElementById('logoutBtn').style.display = 'none';
        document.getElementById('orderSection').style.display = 'none';
        document.getElementById('loginSection').style.display = 'block';
        document.getElementById('distributorSection').style.display = 'none';
        document.getElementById('email').value = 'nikhil@toyokombucha.com';
        this.showMessage('Logged out successfully', 'success', 'loginMessage');
    }
}

// ============================================
// INITIALIZE
// ============================================
const app = new K95OrderApp();
window.app = app;