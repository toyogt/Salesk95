import { Toast } from '../../components/Toast';
import { useOrderForm } from './useOrderForm';
import type { Product } from '../../types';
import './OrderFormPage.css';

const VISIT_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Flexible'];
const OUTLET_TYPES = ['HVO', 'GTM', 'HORECA'];

function ProductRow({
  product,
  qty,
  stock,
  reorder,
  onSetQty,
}: {
  product: Product;
  qty: number;
  stock: number;
  reorder: number;
  onSetQty: (product: Product, qty: number) => void;
}) {
  const low = stock <= reorder;
  return (
    <div className="product-item">
      <div className="product-info">
        <div className="product-name">{product.product_name}</div>
        <div className="product-meta">
          <span>₹{product.case_rate}/case</span>
          <span className={low ? 'stock-low' : ''}>Stock: {stock}</span>
          {product.pack_size && <span>{product.pack_size}</span>}
        </div>
      </div>
      <div className="quantity-controls">
        <button type="button" className="qty-btn" onClick={() => onSetQty(product, qty - 1)}>
          −
        </button>
        <input
          type="number"
          className="qty-input"
          min={0}
          value={qty}
          onChange={(e) => onSetQty(product, parseInt(e.target.value, 10) || 0)}
        />
        <button type="button" className="qty-btn" onClick={() => onSetQty(product, qty + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

export function OrderFormPage() {
  const f = useOrderForm();

  if (f.loadingDistributors) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading your account…</p>
      </div>
    );
  }

  return (
    <div className="order-page">
      {f.toast && (
        <Toast message={f.toast.message} type={f.toast.type} onClose={f.clearToast} />
      )}

      <header className="order-header">
        <div className="logo-icon">K</div>
        <div className="order-header-text">
          <h1>K95 Foods — Sales Order</h1>
          <p className="order-header-email">{f.email}</p>
        </div>
      </header>

      <section className="card toolbar-card">
        <label htmlFor="distributorToolbar">Distributor</label>
        <select
          id="distributorToolbar"
          className="toolbar-distributor-select"
          value={f.distributorId}
          onChange={(e) => f.changeDistributor(e.target.value)}
        >
          <option value="">Select distributor to start…</option>
          {f.distributors.map((d) => (
            <option key={d.distributor_id} value={d.distributor_id}>
              {d.distributor_name}
            </option>
          ))}
        </select>
        {f.distributorId && f.loadingCatalog && (
          <p className="toolbar-hint loading-hint">Loading outlets & products…</p>
        )}
        {!f.distributorId && (
          <p className="toolbar-hint">Choose a distributor to load outlets and products.</p>
        )}
      </section>

      {f.catalogReady && (
        <>
          <section className="card">
            <h2 className="card-title">Create sales order</h2>

            <label>Outlet mode</label>
            <div className="mode-buttons">
              {(['all', 'nonbuyers', 'beatplan'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`mode-btn ${f.outletMode === mode ? 'active' : ''}`}
                  onClick={() => f.setOutletMode(mode)}
                >
                  {mode === 'all' ? 'All Outlets' : mode === 'nonbuyers' ? 'Non‑Buyers' : 'Beat Plan'}
                </button>
              ))}
            </div>

            <div className="outlet-toggle">
              <button
                type="button"
                className={`outlet-toggle-btn ${!f.isNewOutlet ? 'active' : ''}`}
                onClick={() => f.setIsNewOutlet(false)}
              >
                Select existing outlet
              </button>
              <button
                type="button"
                className={`outlet-toggle-btn ${f.isNewOutlet ? 'active' : ''}`}
                onClick={() => f.setIsNewOutlet(true)}
              >
                Create new outlet
              </button>
            </div>

            {!f.isNewOutlet ? (
              <>
                <label>Filter by outlet type</label>
                <div className="chip-row">
                  <button
                    type="button"
                    className={`chip ${f.outletTypeFilter === 'ALL' ? 'active' : ''}`}
                    onClick={() => f.setOutletTypeFilter('ALL')}
                  >
                    All
                  </button>
                  {f.outletTypes.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`chip ${f.outletTypeFilter === t ? 'active' : ''}`}
                      onClick={() => f.setOutletTypeFilter(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                <label htmlFor="outletSel">Select outlet</label>
                <select
                  id="outletSel"
                  value={f.selectedOutletId}
                  onChange={(e) => f.setSelectedOutletId(e.target.value)}
                >
                  <option value="">Choose an outlet…</option>
                  {f.filteredOutlets.map((o) => (
                    <option key={o.outlet_id} value={o.outlet_id}>
                      {o.outlet_name} — {o.outlet_type}
                    </option>
                  ))}
                </select>

                <label>Outlet type</label>
                <input
                  readOnly
                  value={f.selectedOutlet?.outlet_type ?? ''}
                  placeholder="Select an outlet"
                />
              </>
            ) : (
              <>
                <label htmlFor="newOutletName">New outlet name *</label>
                <input
                  id="newOutletName"
                  value={f.newOutlet.name}
                  onChange={(e) => f.updateNewOutletName(e.target.value)}
                  placeholder="Enter outlet name with location"
                />
                <div className="outlet-id-preview">
                  Outlet ID: <strong>{f.newOutlet.outletIdPreview || '—'}</strong>
                </div>

                <label htmlFor="newOutletContact">Contact</label>
                <input
                  id="newOutletContact"
                  type="tel"
                  value={f.newOutlet.contact}
                  onChange={(e) => f.setNewOutlet((p) => ({ ...p, contact: e.target.value }))}
                />

                <label htmlFor="newOutletEmail">Email</label>
                <input
                  id="newOutletEmail"
                  type="email"
                  value={f.newOutlet.email}
                  onChange={(e) => f.setNewOutlet((p) => ({ ...p, email: e.target.value }))}
                />

                <label>Location</label>
                <div className="row-input">
                  <input
                    value={f.newOutlet.location}
                    onChange={(e) => f.setNewOutlet((p) => ({ ...p, location: e.target.value }))}
                    placeholder="Address"
                  />
                  <button type="button" className="btn btn-secondary-sm" onClick={f.handleDetectLocation}>
                    Detect
                  </button>
                </div>

                <label>Maps URL</label>
                <input readOnly value={f.newOutlet.mapUrl} placeholder="Auto-filled after detect" />

                <label>Visit day</label>
                <select
                  value={f.newOutlet.visitDay}
                  onChange={(e) => f.setNewOutlet((p) => ({ ...p, visitDay: e.target.value }))}
                >
                  {VISIT_DAYS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>

                <label>Outlet type *</label>
                <select
                  value={f.newOutlet.type}
                  onChange={(e) => f.setNewOutlet((p) => ({ ...p, type: e.target.value }))}
                >
                  {OUTLET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <p className="info-text">Outlet is created when you submit the order.</p>
              </>
            )}

            <label htmlFor="fulfillmentSel">Fulfillment type</label>
            <select
              id="fulfillmentSel"
              value={f.fulfillmentType}
              onChange={(e) => f.setFulfillmentType(e.target.value)}
            >
              <option value="Distributor">Distributor (inventory on delivery)</option>
              <option value="Self Serving">Self serving (no inventory deduction)</option>
            </select>

            <label htmlFor="commentBox">Order comments</label>
            <textarea
              id="commentBox"
              value={f.comment}
              onChange={(e) => f.setComment(e.target.value)}
              placeholder="Special instructions…"
              rows={3}
            />
          </section>

          <section className="card">
            <h2 className="card-title">Products</h2>
            <div className="filter-row">
              <span className="filter-label">Filter by type</span>
              <select
                className="filter-select"
                value={f.productTypeFilter}
                onChange={(e) => f.setProductTypeFilter(e.target.value)}
              >
                <option value="all">All types (grouped)</option>
                {f.productTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="chip-row">
              <button
                type="button"
                className={`chip ${f.productTypeFilter === 'all' ? 'active' : ''}`}
                onClick={() => f.setProductTypeFilter('all')}
              >
                All types
              </button>
              {f.productTypes.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`chip ${f.productTypeFilter === t ? 'active' : ''}`}
                  onClick={() => f.setProductTypeFilter(t)}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="product-list">
              {f.productGroups.length === 0 ? (
                <div className="empty-state">No products found</div>
              ) : (
                f.productGroups.map((group) => (
                  <div key={group.type} className="product-type-group">
                    {f.productTypeFilter === 'all' && (
                      <div className="product-type-heading">{group.type}</div>
                    )}
                    {group.products.map((product) => (
                      <ProductRow
                        key={product.product_id}
                        product={product}
                        qty={f.orderItems[product.product_id]?.qty ?? 0}
                        stock={f.inventory[product.product_id]?.qty ?? 0}
                        reorder={f.inventory[product.product_id]?.reorder ?? 5}
                        onSetQty={f.setQty}
                      />
                    ))}
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="card">
            <h2 className="card-title">Order summary</h2>
            <table className="summary-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {f.sortedLineItems.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="empty-cell">
                      No items added
                    </td>
                  </tr>
                ) : (
                  f.sortedLineItems.map((item) => (
                    <tr key={item.product_id}>
                      <td>{item.product_name}</td>
                      <td className="text-center">{item.qty}</td>
                      <td className="text-right">
                        ₹{(item.qty * Number(item.rate)).toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div className="summary-footer">
              <div className="summary-total-row">
                <span>Total quantity</span>
                <strong>{f.totalQty}</strong>
              </div>
              <div className="summary-total-row summary-total-amount">
                <span>Total amount</span>
                <strong>₹{f.totalAmount.toFixed(2)}</strong>
              </div>
            </div>
            <div className="button-group">
              <button
                type="button"
                className="btn-submit"
                disabled={f.submitting}
                onClick={f.handleSubmit}
              >
                {f.submitting ? 'Submitting…' : 'Submit order (draft)'}
              </button>
              <button type="button" className="btn-clear" onClick={f.clearForm}>
                Clear
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
