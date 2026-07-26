// stock_report1.js - Complete Inventory Management Logic

// ============================================
// SUPABASE INITIALIZATION - FINAL FIXED VERSION
// ============================================
const SUPABASE_URL = 'https://jaasosewjbrwdklscxrn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphYXNvc2V3amJyd2RrbHNjeHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMjAxMDEsImV4cCI6MjA4NTY5NjEwMX0.OE-dD6EN5DR3fvnaAd9jW3cJ7_5sYXNkY5vOQFQ00w0';

// Create supabase client and attach to window
window.__supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const client = window.__supabase; // Use 'client' instead of 'supabase' to avoid conflicts

console.log('✅ Supabase client created:', !!client);
console.log('✅ client.from is function:', typeof client.from === 'function');

// ============================================
// GLOBAL VARIABLES
// ============================================
let currentUser = null;
let inventoryData = [];
let distributors = [];
let products = [];
let filteredInventory = [];

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async function() {
    console.log('✅ Stock report page loaded');
    console.log('✅ Client available:', typeof client !== 'undefined');
    console.log('✅ Swal available:', typeof Swal !== 'undefined');
    console.log('✅ XLSX available:', typeof XLSX !== 'undefined');
    console.log('✅ bootstrap available:', typeof bootstrap !== 'undefined');
    
    // Set reconcile date
    const reconcileDate = document.getElementById('reconcileDate');
    if (reconcileDate) {
        reconcileDate.value = new Date().toISOString().split('T')[0];
    }
    
    await checkAuth();
    await loadDistributors();
    await loadProducts();
    await loadInventory();
    await loadTransactionFilters();
    setupEventListeners();
});

// ============================================
// AUTHENTICATION & ACCESS CONTROL
// ============================================

async function checkAuth() {
    try {
        console.log('✅ Checking authentication...');
        const { data: { user }, error } = await client.auth.getUser();
        
        console.log('✅ Auth result:', { user, error });
        
        if (error || !user) {
            console.log('❌ No user found, redirecting to login');
            window.location.href = '../index.html';
            return;
        }
        
        currentUser = user;
        const userDisplay = document.getElementById('userDisplay');
        if (userDisplay) {
            userDisplay.textContent = user.email || 'User';
        }
        
        // Check if user has access to inventory management
        const { data: access, error: accessError } = await client
            .from('access_manager')
            .select('role_name, tile_permissions')
            .eq('user_email', user.email)
            .single();
        
        console.log('✅ Access check:', { access, accessError });
        
        if (accessError) {
            console.warn('⚠️ Access check error:', accessError);
        }
        
        if (!access || access.tile_permissions?.stock_report?.access === 'none') {
            console.warn('⚠️ User may not have stock_report permission');
            Swal.fire({
                icon: 'warning',
                title: 'Limited Access',
                text: 'You may not have full permissions for inventory management',
                timer: 3000
            });
        }
    } catch (error) {
        console.error('❌ Auth check error:', error);
        Swal.fire({
            icon: 'error',
            title: 'Auth Error',
            text: error.message
        }).then(() => {
            window.location.href = '../index.html';
        });
    }
}

async function loadDistributors() {
    try {
        console.log('✅ Loading distributors...');
        
        const { data, error } = await client
            .from('distributors')
            .select('distributor_id, distributor_name, GSTIN, status')
            .eq('status', 'Active')
            .order('distributor_name');
        
        console.log('✅ Distributors result:', { data, error });
        
        if (error) throw error;
        
        distributors = data || [];
        console.log(`✅ Loaded ${distributors.length} distributors`);
        
        // Populate distributor dropdowns
        const selects = [
            'filterDistributor', 'stockInDistributor', 'stockOutDistributor', 
            'reconcileDistributor', 'txnDistributor'
        ];
        
        selects.forEach(selectId => {
            const select = document.getElementById(selectId);
            if (select) {
                select.innerHTML = '<option value="">All Distributors</option>';
                distributors.forEach(d => {
                    select.innerHTML += `<option value="${d.distributor_id}">${d.distributor_name} (${d.distributor_id})</option>`;
                });
                console.log(`✅ Populated ${selectId} with ${distributors.length} options`);
            } else {
                console.warn(`⚠️ Select element ${selectId} not found`);
            }
        });
        
        const totalDistributorsEl = document.getElementById('totalDistributors');
        if (totalDistributorsEl) {
            totalDistributorsEl.textContent = distributors.length;
        }
    } catch (error) {
        console.error('❌ Error loading distributors:', error);
    }
}

async function loadProducts() {
    try {
        console.log('✅ Loading products...');
        const { data, error } = await client
            .from('products')
            .select('product_id, product_name, product_type, status, erp_item_id, hsn_code')
            .eq('status', 'Active')
            .order('product_name');
        
        console.log('✅ Products result:', { data, error });
        
        if (error) throw error;
        
        products = data || [];
        console.log(`✅ Loaded ${products.length} products`);
        
        // Populate product dropdowns
        const selects = ['stockInProduct', 'stockOutProduct', 'reconcileProduct'];
        
        selects.forEach(selectId => {
            const select = document.getElementById(selectId);
            if (select) {
                select.innerHTML = '<option value="">Select Product</option>';
                products.forEach(p => {
                    select.innerHTML += `<option value="${p.product_id}">${p.product_name}</option>`;
                });
                console.log(`✅ Populated ${selectId} with ${products.length} options`);
            } else {
                console.warn(`⚠️ Select element ${selectId} not found`);
            }
        });
        
        // Populate product type filter
        const typeSelect = document.getElementById('filterType');
        if (typeSelect) {
            const types = [...new Set(products.map(p => p.product_type).filter(Boolean))];
            typeSelect.innerHTML = '<option value="">All Types</option>';
            types.forEach(type => {
                typeSelect.innerHTML += `<option value="${type}">${type}</option>`;
            });
            console.log(`✅ Populated filterType with ${types.length} types`);
        }
        
        const totalProductsEl = document.getElementById('totalProducts');
        if (totalProductsEl) {
            totalProductsEl.textContent = products.length;
        }
    } catch (error) {
        console.error('❌ Error loading products:', error);
    }
}

// ============================================
// INVENTORY MANAGEMENT
// ============================================

async function loadInventory() {
    try {
        console.log('✅ Loading inventory...');
        const { data, error } = await client
            .from('distributor_inventory')
            .select(`
                *,
                distributors!inner(distributor_name, GSTIN),
                products!inner(product_name, product_type, erp_item_id)
            `);
        
        console.log('✅ Inventory result:', { data, error });
        
        if (error) throw error;
        
        inventoryData = data || [];
        filteredInventory = [...inventoryData];
        console.log(`✅ Loaded ${inventoryData.length} inventory items`);
        
        updateInventoryTable();
        updateStockCounts();
    } catch (error) {
        console.error('❌ Error loading inventory:', error);
        const tbody = document.getElementById('inventoryTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="10" class="text-center text-danger">Error loading inventory</td></tr>';
        }
    }
}

function updateInventoryTable() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;
    
    if (filteredInventory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center">No inventory data found</td></tr>';
        return;
    }
    
    let html = '';
    
    filteredInventory.forEach(item => {
        const stock = item.quantity_on_hand || 0;
        const reorderLevel = item.reorder_level || 5;
        const status = getStockStatus(stock, reorderLevel);
        const statusClass = getStockStatusClass(status);
        const lastUpdated = item.updated_at ? new Date(item.updated_at).toLocaleString() : 'N/A';
        
        // Escape strings for onclick
        const distributorName = (item.distributors?.distributor_name || '').replace(/'/g, "\\'");
        const productName = (item.products?.product_name || '').replace(/'/g, "\\'");
        
        html += `
            <tr class="${statusClass}">
                <td>${item.distributors?.distributor_name || item.distributor_id}</td>
                <td>${item.distributors?.GSTIN || '-'}</td>
                <td>${item.product_id}</td>
                <td>${item.products?.product_name || item.product_id}</td>
                <td>${item.products?.product_type || '-'}</td>
                <td class="text-end fw-bold">${stock}</td>
                <td class="text-end">
                    <span class="badge bg-secondary">${reorderLevel}</span>
                </td>
                <td>
                    ${status === 'LOW' ? '<span class="badge bg-warning">⚠️ Reorder</span>' : ''}
                    ${status === 'CRITICAL' ? '<span class="badge bg-danger">Critical</span>' : ''}
                    ${status === 'OK' ? '<span class="badge bg-success">OK</span>' : ''}
                </td>
                <td>${lastUpdated}</td>
                <td>
                    <button class="btn btn-sm btn-primary action-btn" onclick="showReorderModal('${item.distributor_id}', '${item.product_id}', '${distributorName}', '${productName}', ${stock}, ${reorderLevel})" title="Set Reorder Level">
                        <i class="fas fa-sliders-h"></i>
                    </button>
                    <button class="btn btn-sm btn-success action-btn" onclick="quickStockIn('${item.distributor_id}', '${item.product_id}')" title="Quick Stock In">
                        <i class="fas fa-arrow-down"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

function getStockStatus(stock, reorderLevel) {
    if (stock === 0) return 'CRITICAL';
    if (stock <= reorderLevel) return 'LOW';
    return 'OK';
}

function getStockStatusClass(status) {
    switch(status) {
        case 'CRITICAL': return 'table-danger';
        case 'LOW': return 'table-warning';
        default: return '';
    }
}

function updateStockCounts() {
    let lowStock = 0;
    let criticalStock = 0;
    
    inventoryData.forEach(item => {
        const stock = item.quantity_on_hand || 0;
        const reorderLevel = item.reorder_level || 5;
        
        if (stock === 0) criticalStock++;
        else if (stock <= reorderLevel) lowStock++;
    });
    
    const lowStockEl = document.getElementById('lowStockCount');
    const criticalStockEl = document.getElementById('criticalStockCount');
    
    if (lowStockEl) lowStockEl.textContent = lowStock;
    if (criticalStockEl) criticalStockEl.textContent = criticalStock;
}

// ============================================
// FILTERS
// ============================================

function applyFilters() {
    const distributor = document.getElementById('filterDistributor')?.value;
    const productSearch = document.getElementById('filterProduct')?.value.toLowerCase() || '';
    const productType = document.getElementById('filterType')?.value;
    const stockStatus = document.getElementById('filterStockStatus')?.value;
    
    filteredInventory = inventoryData.filter(item => {
        // Distributor filter
        if (distributor && item.distributor_id !== distributor) return false;
        
        // Product search filter
        if (productSearch) {
            const productName = (item.products?.product_name || '').toLowerCase();
            const productId = item.product_id.toLowerCase();
            if (!productName.includes(productSearch) && !productId.includes(productSearch)) return false;
        }
        
        // Product type filter
        if (productType && item.products?.product_type !== productType) return false;
        
        // Stock status filter
        if (stockStatus) {
            const stock = item.quantity_on_hand || 0;
            const reorderLevel = item.reorder_level || 5;
            const status = getStockStatus(stock, reorderLevel);
            
            if (stockStatus === 'low' && status !== 'LOW') return false;
            if (stockStatus === 'critical' && status !== 'CRITICAL') return false;
            if (stockStatus === 'ok' && status !== 'OK') return false;
        }
        
        return true;
    });
    
    updateInventoryTable();
}

// ============================================
// STOCK OPERATIONS
// ============================================

async function processStockIn() {
    const distributorId = document.getElementById('stockInDistributor')?.value;
    const productId = document.getElementById('stockInProduct')?.value;
    const qty = parseInt(document.getElementById('stockInQty')?.value);
    const reference = document.getElementById('stockInReference')?.value;
    const notes = document.getElementById('stockInNotes')?.value;
    
    if (!distributorId || !productId || !qty || qty < 1) {
        Swal.fire('Error', 'Please fill all required fields', 'error');
        return;
    }
    
    try {
        // Get current stock
        const { data: current, error: fetchError } = await client
            .from('distributor_inventory')
            .select('quantity_on_hand')
            .eq('distributor_id', distributorId)
            .eq('product_id', productId)
            .maybeSingle();
        
        if (fetchError) throw fetchError;
        
        const currentStock = current?.quantity_on_hand || 0;
        const newStock = currentStock + qty;
        
        // Update inventory
        const { error: updateError } = await client
            .from('distributor_inventory')
            .upsert({
                distributor_id: distributorId,
                product_id: productId,
                quantity_on_hand: newStock,
                updated_at: new Date().toISOString()
            }, { onConflict: 'distributor_id, product_id' });
        
        if (updateError) throw updateError;
        
        // Log transaction
        await logTransaction({
            distributor_id: distributorId,
            product_id: productId,
            transaction_type: 'IN',
            quantity: qty,
            previous_balance: currentStock,
            new_balance: newStock,
            reference_type: 'MANUAL',
            reference_id: reference,
            notes: notes
        });
        
        Swal.fire('Success', `Added ${qty} units to inventory`, 'success');
        
        // Reset form
        document.getElementById('stockInForm')?.reset();
        const stockInCurrentStock = document.getElementById('stockInCurrentStock');
        if (stockInCurrentStock) stockInCurrentStock.value = '';
        
        // Reload inventory
        await loadInventory();
        
    } catch (error) {
        console.error('Stock in error:', error);
        Swal.fire('Error', 'Failed to add stock: ' + error.message, 'error');
    }
}

async function processStockOut() {
    const distributorId = document.getElementById('stockOutDistributor')?.value;
    const productId = document.getElementById('stockOutProduct')?.value;
    const qty = parseInt(document.getElementById('stockOutQty')?.value);
    const reason = document.getElementById('stockOutReason')?.value;
    const notes = document.getElementById('stockOutNotes')?.value;
    
    if (!distributorId || !productId || !qty || qty < 1 || !reason) {
        Swal.fire('Error', 'Please fill all required fields', 'error');
        return;
    }
    
    try {
        // Get current stock
        const { data: current, error: fetchError } = await client
            .from('distributor_inventory')
            .select('quantity_on_hand')
            .eq('distributor_id', distributorId)
            .eq('product_id', productId)
            .single();
        
        if (fetchError) throw fetchError;
        
        const currentStock = current?.quantity_on_hand || 0;
        
        if (currentStock < qty) {
            Swal.fire('Error', `Insufficient stock. Available: ${currentStock}`, 'error');
            return;
        }
        
        const newStock = currentStock - qty;
        
        // Update inventory
        const { error: updateError } = await client
            .from('distributor_inventory')
            .update({
                quantity_on_hand: newStock,
                updated_at: new Date().toISOString()
            })
            .eq('distributor_id', distributorId)
            .eq('product_id', productId);
        
        if (updateError) throw updateError;
        
        // Log transaction
        await logTransaction({
            distributor_id: distributorId,
            product_id: productId,
            transaction_type: 'OUT',
            quantity: -qty,
            previous_balance: currentStock,
            new_balance: newStock,
            reference_type: reason,
            reference_id: '',
            notes: notes
        });
        
        Swal.fire('Success', `Removed ${qty} units from inventory`, 'success');
        
        // Reset form
        document.getElementById('stockOutForm')?.reset();
        const stockOutCurrentStock = document.getElementById('stockOutCurrentStock');
        if (stockOutCurrentStock) stockOutCurrentStock.value = '';
        
        // Reload inventory
        await loadInventory();
        
    } catch (error) {
        console.error('Stock out error:', error);
        Swal.fire('Error', 'Failed to remove stock: ' + error.message, 'error');
    }
}

async function processReconciliation() {
    const distributorId = document.getElementById('reconcileDistributor')?.value;
    const productId = document.getElementById('reconcileProduct')?.value;
    const physicalStock = parseInt(document.getElementById('physicalStock')?.value);
    const reason = document.getElementById('reconcileReason')?.value;
    const notes = document.getElementById('reconcileNotes')?.value;
    
    if (!distributorId || !productId || isNaN(physicalStock) || physicalStock < 0) {
        Swal.fire('Error', 'Please enter valid physical count', 'error');
        return;
    }
    
    try {
        // Get current stock
        const { data: current, error: fetchError } = await client
            .from('distributor_inventory')
            .select('quantity_on_hand')
            .eq('distributor_id', distributorId)
            .eq('product_id', productId)
            .single();
        
        if (fetchError) throw fetchError;
        
        const currentStock = current?.quantity_on_hand || 0;
        
        if (currentStock === physicalStock) {
            Swal.fire('Info', 'No difference found. Stock is already accurate.', 'info');
            return;
        }
        
        // Update inventory
        const { error: updateError } = await client
            .from('distributor_inventory')
            .update({
                quantity_on_hand: physicalStock,
                updated_at: new Date().toISOString()
            })
            .eq('distributor_id', distributorId)
            .eq('product_id', productId);
        
        if (updateError) throw updateError;
        
        // Log transaction
        await logTransaction({
            distributor_id: distributorId,
            product_id: productId,
            transaction_type: 'RECONCILE',
            quantity: physicalStock - currentStock,
            previous_balance: currentStock,
            new_balance: physicalStock,
            reference_type: reason,
            reference_id: '',
            notes: notes || `Reconciled from ${currentStock} to ${physicalStock}`
        });
        
        Swal.fire('Success', `Stock reconciled from ${currentStock} to ${physicalStock}`, 'success');
        
        // Reset
        cancelReconciliation();
        await loadInventory();
        
    } catch (error) {
        console.error('Reconciliation error:', error);
        Swal.fire('Error', 'Failed to reconcile: ' + error.message, 'error');
    }
}

async function logTransaction(transaction) {
    try {
        const { error } = await client
            .from('inventory_transactions')
            .insert({
                distributor_id: transaction.distributor_id,
                product_id: transaction.product_id,
                transaction_type: transaction.transaction_type,
                quantity: transaction.quantity,
                previous_balance: transaction.previous_balance,
                new_balance: transaction.new_balance,
                reference_type: transaction.reference_type,
                reference_id: transaction.reference_id,
                notes: transaction.notes,
                created_by_email: currentUser.email,
                created_at: new Date().toISOString()
            });
        
        if (error) throw error;
    } catch (error) {
        console.error('Error logging transaction:', error);
    }
}

// ============================================
// REORDER LEVEL MANAGEMENT
// ============================================

function showReorderModal(distributorId, productId, distributorName, productName, currentStock, currentLevel) {
    const modal = document.getElementById('reorderModal');
    if (!modal) {
        console.error('Reorder modal not found');
        return;
    }
    
    document.getElementById('reorderDistributorId').value = distributorId;
    document.getElementById('reorderProductId').value = productId;
    document.getElementById('reorderDistributorName').value = distributorName;
    document.getElementById('reorderProductName').value = productName;
    document.getElementById('reorderCurrentStock').value = currentStock;
    document.getElementById('reorderLevel').value = currentLevel;
    
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

async function saveReorderLevel() {
    const distributorId = document.getElementById('reorderDistributorId')?.value;
    const productId = document.getElementById('reorderProductId')?.value;
    const newLevel = parseInt(document.getElementById('reorderLevel')?.value);
    
    if (!distributorId || !productId || isNaN(newLevel) || newLevel < 0) {
        Swal.fire('Error', 'Please enter a valid reorder level', 'error');
        return;
    }
    
    try {
        const { error } = await client
            .from('distributor_inventory')
            .update({ reorder_level: newLevel })
            .eq('distributor_id', distributorId)
            .eq('product_id', productId);
        
        if (error) throw error;
        
        Swal.fire('Success', 'Reorder level updated', 'success');
        
        // Close modal
        const modalEl = document.getElementById('reorderModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
        
        // Reload inventory
        await loadInventory();
        
    } catch (error) {
        console.error('Error updating reorder level:', error);
        Swal.fire('Error', 'Failed to update reorder level', 'error');
    }
}

// ============================================
// ERP NEXT INTEGRATION
// ============================================

async function parseInvoice() {
    const jsonText = document.getElementById('invoiceJson')?.value;
    
    if (!jsonText) {
        Swal.fire('Error', 'Please paste invoice JSON', 'error');
        return;
    }
    
    try {
        const invoice = JSON.parse(jsonText);
        
        // Extract distributor from GSTIN
        const gstin = invoice?.billing_address_gstin || invoice?.customer_gstin;
        
        if (!gstin) {
            Swal.fire('Error', 'No GSTIN found in invoice', 'error');
            return;
        }
        
        // Find distributor by GSTIN
        const distributor = distributors.find(d => d.GSTIN === gstin);
        
        if (!distributor) {
            Swal.fire('Warning', `No distributor found with GSTIN: ${gstin}`, 'warning');
        }
        
        // Display mapped data
        const matchedDistributor = document.getElementById('matchedDistributor');
        const invoiceDate = document.getElementById('invoiceDate');
        const invoiceNumber = document.getElementById('invoiceNumber');
        
        if (matchedDistributor) {
            matchedDistributor.textContent = distributor ? `${distributor.distributor_name} (${distributor.distributor_id})` : 'Not Found';
        }
        if (invoiceDate) invoiceDate.textContent = invoice.posting_date || 'N/A';
        if (invoiceNumber) invoiceNumber.textContent = invoice.name || 'N/A';
        
        // Parse items
        const items = invoice.items || [];
        let itemsHtml = '';
        
        items.forEach(item => {
            const itemCode = item.item_code;
            const itemName = item.item_name;
            const qty = item.qty || 0;
            
            // Find product by ERP item ID
            const product = products.find(p => p.erp_item_id === itemCode);
            const matched = !!product;
            
            itemsHtml += `
                <tr class="${matched ? 'table-success' : 'table-warning'}">
                    <td>${itemName}</td>
                    <td>${itemCode}</td>
                    <td>${qty}</td>
                    <td>
                        ${matched ? 
                            '<span class="badge bg-success">Matched to ' + product.product_name + '</span>' : 
                            '<span class="badge bg-danger">No Match</span>'}
                    </td>
                    <td>
                        ${!matched ? 
                            '<button class="btn btn-sm btn-warning" onclick="manualMapProduct(\'' + itemCode + '\', \'' + itemName.replace(/'/g, "\\'") + '\')">Map Manually</button>' : 
                            ''}
                    </td>
                </tr>
            `;
        });
        
        const erpItemsTable = document.getElementById('erpItemsTable');
        const erpResults = document.getElementById('erpResults');
        
        if (erpItemsTable) erpItemsTable.innerHTML = itemsHtml;
        if (erpResults) erpResults.style.display = 'block';
        
        // Store parsed data globally
        window.lastParsedInvoice = {
            invoice: invoice,
            distributor: distributor,
            items: items,
            gstin: gstin
        };
        
    } catch (error) {
        console.error('Parse error:', error);
        Swal.fire('Error', 'Invalid JSON: ' + error.message, 'error');
    }
}

async function updateInventoryFromERP() {
    if (!window.lastParsedInvoice) {
        Swal.fire('Error', 'No invoice parsed', 'error');
        return;
    }
    
    const { distributor, items } = window.lastParsedInvoice;
    
    if (!distributor) {
        Swal.fire('Error', 'No distributor matched', 'error');
        return;
    }
    
    try {
        let updated = 0;
        let skipped = 0;
        
        for (const item of items) {
            const itemCode = item.item_code;
            const qty = item.qty || 0;
            
            // Find product by ERP item ID
            const product = products.find(p => p.erp_item_id === itemCode);
            
            if (!product) {
                skipped++;
                continue;
            }
            
            // Get current stock
            const { data: current } = await client
                .from('distributor_inventory')
                .select('quantity_on_hand')
                .eq('distributor_id', distributor.distributor_id)
                .eq('product_id', product.product_id)
                .maybeSingle();
            
            const currentStock = current?.quantity_on_hand || 0;
            const newStock = currentStock + qty;
            
            // Update inventory
            await client
                .from('distributor_inventory')
                .upsert({
                    distributor_id: distributor.distributor_id,
                    product_id: product.product_id,
                    quantity_on_hand: newStock,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'distributor_id, product_id' });
            
            // Log transaction
            await logTransaction({
                distributor_id: distributor.distributor_id,
                product_id: product.product_id,
                transaction_type: 'IN',
                quantity: qty,
                previous_balance: currentStock,
                new_balance: newStock,
                reference_type: 'ERP_INVOICE',
                reference_id: window.lastParsedInvoice.invoice.name,
                notes: `Auto-updated from ERP invoice`
            });
            
            updated++;
        }
        
        Swal.fire('Success', `Updated ${updated} products, ${skipped} skipped (no product mapping)`, 'success');
        
        // Reload inventory
        await loadInventory();
        
    } catch (error) {
        console.error('ERP update error:', error);
        Swal.fire('Error', 'Failed to update inventory: ' + error.message, 'error');
    }
}

// ============================================
// TRANSACTION LOG
// ============================================

async function loadTransactions() {
    const distributorId = document.getElementById('txnDistributor')?.value;
    const type = document.getElementById('txnType')?.value;
    const fromDate = document.getElementById('txnFrom')?.value;
    const toDate = document.getElementById('txnTo')?.value;
    
    try {
        let query = client
            .from('inventory_transactions')
            .select(`
                *,
                distributors(distributor_name),
                products(product_name)
            `)
            .order('created_at', { ascending: false })
            .limit(500);
        
        if (distributorId) {
            query = query.eq('distributor_id', distributorId);
        }
        
        if (type) {
            query = query.eq('transaction_type', type);
        }
        
        if (fromDate) {
            query = query.gte('created_at', fromDate + 'T00:00:00');
        }
        
        if (toDate) {
            query = query.lte('created_at', toDate + 'T23:59:59');
        }
        
        const { data, error } = await query;
        
        if (error) throw error;
        
        const tbody = document.getElementById('transactionsTableBody');
        if (!tbody) return;
        
        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="text-center">No transactions found</td></tr>';
            return;
        }
        
        let html = '';
        data.forEach(txn => {
            const date = new Date(txn.created_at).toLocaleString();
            const typeClass = txn.transaction_type === 'IN' ? 'text-success' : 
                             txn.transaction_type === 'OUT' ? 'text-danger' : 'text-warning';
            const typeIcon = txn.transaction_type === 'IN' ? '⬆️' : 
                            txn.transaction_type === 'OUT' ? '⬇️' : '🔄';
            
            html += `
                <tr>
                    <td>${date}</td>
                    <td>${txn.distributors?.distributor_name || txn.distributor_id}</td>
                    <td>${txn.products?.product_name || txn.product_id}</td>
                    <td class="${typeClass} fw-bold">${typeIcon} ${txn.transaction_type}</td>
                    <td class="text-end">${Math.abs(txn.quantity)}</td>
                    <td class="text-end">${txn.previous_balance}</td>
                    <td class="text-end">${txn.new_balance}</td>
                    <td>${txn.reference_type || '-'} ${txn.reference_id || ''}</td>
                    <td>${txn.created_by_email || '-'}</td>
                    <td>${txn.notes || '-'}</td>
                </tr>
            `;
        });
        
        tbody.innerHTML = html;
        
    } catch (error) {
        console.error('Error loading transactions:', error);
        const tbody = document.getElementById('transactionsTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="10" class="text-center text-danger">Error loading transactions</td></tr>';
        }
    }
}

// ============================================
// EXPORT TO EXCEL
// ============================================

function exportToExcel() {
    try {
        const data = filteredInventory.map(item => ({
            'Distributor': item.distributors?.distributor_name || item.distributor_id,
            'GSTIN': item.distributors?.GSTIN || '-',
            'Product Code': item.product_id,
            'Product Name': item.products?.product_name || item.product_id,
            'Product Type': item.products?.product_type || '-',
            'Stock': item.quantity_on_hand || 0,
            'Reorder Level': item.reorder_level || 5,
            'Status': getStockStatus(item.quantity_on_hand || 0, item.reorder_level || 5),
            'Last Updated': item.updated_at ? new Date(item.updated_at).toLocaleString() : 'N/A'
        }));
        
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
        XLSX.writeFile(wb, `K95_Inventory_${new Date().toISOString().split('T')[0]}.xlsx`);
        
        Swal.fire('Success', 'Inventory exported to Excel', 'success');
    } catch (error) {
        console.error('Export error:', error);
        Swal.fire('Error', 'Failed to export: ' + error.message, 'error');
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function setupEventListeners() {
    // Product selection for stock in/out
    document.getElementById('stockInDistributor')?.addEventListener('change', updateCurrentStock);
    document.getElementById('stockInProduct')?.addEventListener('change', updateCurrentStock);
    document.getElementById('stockOutDistributor')?.addEventListener('change', updateCurrentStock);
    document.getElementById('stockOutProduct')?.addEventListener('change', updateCurrentStock);
    
    // Real-time difference calculation for reconciliation
    document.getElementById('physicalStock')?.addEventListener('input', calculateDifference);
    
    // Filter button
    document.querySelector('button[onclick="applyFilters()"]')?.addEventListener('click', applyFilters);
    
    // Export button
    document.querySelector('button[onclick="exportToExcel()"]')?.addEventListener('click', exportToExcel);
}

async function updateCurrentStock(event) {
    const prefix = event.target.id.includes('stockIn') ? 'stockIn' : 'stockOut';
    const distributorId = document.getElementById(prefix + 'Distributor')?.value;
    const productId = document.getElementById(prefix + 'Product')?.value;
    
    if (!distributorId || !productId) {
        document.getElementById(prefix + 'CurrentStock').value = '';
        return;
    }
    
    try {
        const { data } = await client
            .from('distributor_inventory')
            .select('quantity_on_hand')
            .eq('distributor_id', distributorId)
            .eq('product_id', productId)
            .maybeSingle();
        
        document.getElementById(prefix + 'CurrentStock').value = data?.quantity_on_hand || 0;
    } catch (error) {
        document.getElementById(prefix + 'CurrentStock').value = 0;
    }
}

async function loadForReconciliation() {
    const distributorId = document.getElementById('reconcileDistributor')?.value;
    const productId = document.getElementById('reconcileProduct')?.value;
    
    if (!distributorId || !productId) {
        Swal.fire('Error', 'Please select distributor and product', 'error');
        return;
    }
    
    try {
        const { data } = await client
            .from('distributor_inventory')
            .select('quantity_on_hand')
            .eq('distributor_id', distributorId)
            .eq('product_id', productId)
            .maybeSingle();
        
        const systemStock = data?.quantity_on_hand || 0;
        
        document.getElementById('systemStock').value = systemStock;
        document.getElementById('physicalStock').value = systemStock;
        document.getElementById('stockDifference').value = '0';
        document.getElementById('reconcileForm').style.display = 'block';
        
    } catch (error) {
        console.error('Error loading for reconciliation:', error);
        Swal.fire('Error', 'Failed to load stock data', 'error');
    }
}

function calculateDifference() {
    const systemStock = parseInt(document.getElementById('systemStock')?.value) || 0;
    const physicalStock = parseInt(document.getElementById('physicalStock')?.value) || 0;
    const difference = physicalStock - systemStock;
    
    const stockDiff = document.getElementById('stockDifference');
    if (stockDiff) {
        stockDiff.value = difference;
        stockDiff.className = difference !== 0 ? 'form-control text-danger fw-bold' : 'form-control';
    }
}

function cancelReconciliation() {
    document.getElementById('reconcileForm').style.display = 'none';
    document.getElementById('reconcileDistributor').value = '';
    document.getElementById('reconcileProduct').value = '';
    document.getElementById('systemStock').value = '';
    document.getElementById('physicalStock').value = '';
    document.getElementById('stockDifference').value = '';
}

function quickStockIn(distributorId, productId) {
    // Switch to Stock In tab
    const stockInTab = document.getElementById('stock-in-tab');
    if (stockInTab) {
        const tab = new bootstrap.Tab(stockInTab);
        tab.show();
    }
    
    // Pre-fill distributor and product
    document.getElementById('stockInDistributor').value = distributorId;
    document.getElementById('stockInProduct').value = productId;
    
    // Trigger change to load current stock
    const event = { target: { id: 'stockInDistributor' } };
    updateCurrentStock(event);
    
    // Focus on quantity
    setTimeout(() => document.getElementById('stockInQty')?.focus(), 500);
}

async function loadTransactionFilters() {
    try {
        const { data } = await client
            .from('distributors')
            .select('distributor_id, distributor_name')
            .eq('status', 'Active');
        
        const select = document.getElementById('txnDistributor');
        if (select && data) {
            select.innerHTML = '<option value="">All Distributors</option>';
            data.forEach(d => {
                select.innerHTML += `<option value="${d.distributor_id}">${d.distributor_name}</option>`;
            });
        }
        
        // Set default dates
        const today = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(today.getDate() - 30);
        
        const txnTo = document.getElementById('txnTo');
        const txnFrom = document.getElementById('txnFrom');
        
        if (txnTo) txnTo.value = today.toISOString().split('T')[0];
        if (txnFrom) txnFrom.value = thirtyDaysAgo.toISOString().split('T')[0];
        
    } catch (error) {
        console.error('Error loading transaction filters:', error);
    }
}

function manualMapProduct(erpItemCode, erpItemName) {
    Swal.fire({
        title: 'Map Product',
        html: `
            <p>Map ERP Item: <strong>${erpItemCode}</strong> (${erpItemName})</p>
            <select id="mapProductSelect" class="swal2-select" style="width: 100%;">
                <option value="">Select Product</option>
                ${products.map(p => `<option value="${p.product_id}">${p.product_name}</option>`).join('')}
            </select>
        `,
        showCancelButton: true,
        confirmButtonText: 'Map',
        preConfirm: () => {
            const productId = document.getElementById('mapProductSelect')?.value;
            if (!productId) {
                Swal.showValidationMessage('Please select a product');
                return false;
            }
            return productId;
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            const productId = result.value;
            
            // Update product with ERP item code
            const { error } = await client
                .from('products')
                .update({ erp_item_id: erpItemCode })
                .eq('product_id', productId);
            
            if (error) {
                Swal.fire('Error', 'Failed to map product: ' + error.message, 'error');
            } else {
                Swal.fire('Success', 'Product mapped successfully', 'success');
                // Reload products and re-parse
                await loadProducts();
                parseInvoice();
            }
        }
    });
}

// Make sure logout function is at the end
function logout() {
    window.__supabase.auth.signOut().then(() => {
        window.location.href = '../index.html';
    });
}