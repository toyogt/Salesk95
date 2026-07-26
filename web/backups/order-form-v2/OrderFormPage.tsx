import { useEffect, useState } from 'react';
import { Toast } from '../../components/Toast';
import { useOrderForm } from './useOrderForm';
import { useSubmitProgress } from './useSubmitProgress';
import type { Product } from '../../types';
import './OrderFormPage.css';

const VISIT_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Flexible'];
const OUTLET_TYPES = ['HVO', 'GTM', 'HORECA'];

const MODE_LABELS: Record<string, string> = {
  all: 'All',
  nonbuyers: 'Non‑Buyers',
  beatplan: 'Beat',
};

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
  const active = qty > 0;
  return (
    <div className={`product-item ${active ? 'product-item--active' : ''}`}>
      <div className="product-glow" aria-hidden />
      <div className="product-info">
        <div className="product-name">{product.product_name}</div>
        <div className="product-meta">
          <span className="meta-pill">₹{product.case_rate}/case</span>
          <span className={`meta-pill ${low ? 'meta-pill--warn' : 'meta-pill--ok'}`}>
            Stock {stock}
          </span>
          {product.pack_size && <span className="meta-pill">{product.pack_size}</span>}
        </div>
      </div>
      <div className="quantity-controls">
        <button
          type="button"
          className="qty-btn"
          aria-label="Decrease quantity"
          onClick={() => onSetQty(product, qty - 1)}
        >
          −
        </button>
        <input
          type="number"
          className="qty-input"
          min={0}
          value={qty}
          aria-label={`Quantity for ${product.product_name}`}
          onChange={(e) => onSetQty(product, parseInt(e.target.value, 10) || 0)}
        />
        <button
          type="button"
          className="qty-btn qty-btn--plus"
          aria-label="Increase quantity"
          onClick={() => onSetQty(product, qty + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}

function SubmitProgressOverlay({
  visible,
  progress,
  secondsLeft,
  phase,
}: {
  visible: boolean;
  progress: number;
  secondsLeft: number;
  phase: string;
}) {
  if (!visible) return null;

  return (
    <div className="submit-overlay" role="dialog" aria-modal="true" aria-labelledby="submit-progress-title">
      <div className="submit-overlay-panel">
        <div className="submit-overlay-spinner" aria-hidden />
        <h2 id="submit-progress-title">Submitting your order</h2>
        <p className="submit-overlay-phase">{phase}</p>
        <div className="submit-progress-wrap">
          <div
            className="submit-progress-bar"
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="submit-progress-meta">
          <span>{Math.round(progress)}% complete</span>
          {secondsLeft > 0 ? (
            <span className="submit-time-left">About {secondsLeft}s remaining</span>
          ) : (
            <span className="submit-time-left">Almost done…</span>
          )}
        </div>
        <p className="submit-overlay-note">Please keep this page open until the draft is saved.</p>
      </div>
    </div>
  );
}

export function OrderFormPage() {
  const f = useOrderForm();
  const submitUi = useSubmitProgress(f.submitting);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);

  if (f.loadingDistributors) {
    return (
      <div className="order-page order-page--loading">
        <div className="ambient-bg" aria-hidden>
          <div className="ambient-orb ambient-orb--1" />
          <div className="ambient-orb ambient-orb--2" />
        </div>
        <div className="page-loading fx-loading">
          <div className="fx-spinner" />
          <p>Initializing workspace…</p>
        </div>
      </div>
    );
  }

  const lineCount = f.sortedLineItems.length;

  return (
    <div className={`order-page ${mounted ? 'order-page--ready' : ''}`}>
      <div className="ambient-bg" aria-hidden>
        <div className="ambient-orb ambient-orb--1" />
        <div className="ambient-orb ambient-orb--2" />
      </div>

      <SubmitProgressOverlay
        visible={submitUi.visible}
        progress={submitUi.progress}
        secondsLeft={submitUi.secondsLeft}
        phase={submitUi.phase}
      />

      {f.toast && (
        <Toast message={f.toast.message} type={f.toast.type} onClose={f.clearToast} />
      )}

      <header className="page-header">
        <div className="logo-icon">K</div>
        <div className="order-header-text">
          <p className="page-eyebrow">
            K95 Sales <span className="version-badge">V2</span>
          </p>
          <h1>New order</h1>
          <p className="order-header-email">{f.email}</p>
        </div>
        <div className={`page-status ${f.catalogReady ? 'page-status--live' : ''}`}>
          <span className="page-status-dot" />
          {f.catalogReady ? 'Ready' : f.distributorId ? 'Loading' : 'Select distributor'}
        </div>
      </header>

      <section className="card toolbar-card">
        <div className="card-accent" aria-hidden />
        <label htmlFor="distributorToolbar" className="field-label">
          Step 0 — Distributor
        </label>
        <div className="select-wrap">
          <select
            id="distributorToolbar"
            className="toolbar-distributor-select fx-input"
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
        </div>
        {f.distributorId && f.loadingCatalog && (
          <p className="toolbar-hint loading-hint">
            <span className="pulse-bar" /> Loading outlets & products…
          </p>
        )}
        {!f.distributorId && (
          <p className="toolbar-hint">Choose a distributor to unlock the order flow.</p>
        )}
      </section>

      {f.catalogReady && (
        <div className="form-sections">
          <section className="card fx-card-enter" style={{ animationDelay: '0.05s' }}>
            <h2 className="card-title">
              <span className="card-title-step">1</span> Order setup
            </h2>

            <label className="fx-label">Outlet mode</label>
            <div className="segmented mode-buttons" role="tablist">
              {(['all', 'nonbuyers', 'beatplan'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={f.outletMode === mode}
                  className={`segmented-btn ${f.outletMode === mode ? 'active' : ''}`}
                  onClick={() => f.setOutletMode(mode)}
                >
                  {MODE_LABELS[mode]}
                </button>
              ))}
            </div>

            <div className="segmented outlet-toggle">
              <button
                type="button"
                className={`segmented-btn ${!f.isNewOutlet ? 'active' : ''}`}
                onClick={() => f.setIsNewOutlet(false)}
              >
                Existing outlet
              </button>
              <button
                type="button"
                className={`segmented-btn ${f.isNewOutlet ? 'active' : ''}`}
                onClick={() => f.setIsNewOutlet(true)}
              >
                New outlet
              </button>
            </div>

            {!f.isNewOutlet ? (
              <div className="fx-field-group">
                <label className="fx-label">Outlet type filter</label>
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

                <label htmlFor="outletSel" className="fx-label">Select outlet</label>
                <div className="select-wrap">
                  <select
                    id="outletSel"
                    className="fx-input"
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
                </div>

                <label className="fx-label">Outlet type</label>
                <input
                  className="fx-input fx-input--readonly"
                  readOnly
                  value={f.selectedOutlet?.outlet_type ?? ''}
                  placeholder="—"
                />
              </div>
            ) : (
              <div className="fx-field-group fx-field-group--grid">
                <div className="fx-field-full">
                  <label htmlFor="newOutletName" className="fx-label">New outlet name *</label>
                  <input
                    id="newOutletName"
                    className="fx-input"
                    value={f.newOutlet.name}
                    onChange={(e) => f.updateNewOutletName(e.target.value)}
                    placeholder="Outlet name with location"
                  />
                  <div className="outlet-id-preview">
                    <span>ID</span>
                    <strong>{f.newOutlet.outletIdPreview || '—'}</strong>
                  </div>
                </div>

                <div>
                  <label className="fx-label">Contact</label>
                  <input
                    className="fx-input"
                    type="tel"
                    value={f.newOutlet.contact}
                    onChange={(e) => f.setNewOutlet((p) => ({ ...p, contact: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="fx-label">Email</label>
                  <input
                    className="fx-input"
                    type="email"
                    value={f.newOutlet.email}
                    onChange={(e) => f.setNewOutlet((p) => ({ ...p, email: e.target.value }))}
                  />
                </div>

                <div className="fx-field-full">
                  <label className="fx-label">Location</label>
                  <div className="row-input">
                    <input
                      className="fx-input"
                      value={f.newOutlet.location}
                      onChange={(e) => f.setNewOutlet((p) => ({ ...p, location: e.target.value }))}
                      placeholder="Address"
                    />
                    <button type="button" className="btn-fx btn-fx--ghost" onClick={f.handleDetectLocation}>
                      Detect GPS
                    </button>
                  </div>
                </div>

                <div className="fx-field-full">
                  <label className="fx-label">Maps URL</label>
                  <input className="fx-input fx-input--readonly" readOnly value={f.newOutlet.mapUrl} />
                </div>

                <div>
                  <label className="fx-label">Visit day</label>
                  <select
                    className="fx-input"
                    value={f.newOutlet.visitDay}
                    onChange={(e) => f.setNewOutlet((p) => ({ ...p, visitDay: e.target.value }))}
                  >
                    {VISIT_DAYS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="fx-label">Outlet type *</label>
                  <select
                    className="fx-input"
                    value={f.newOutlet.type}
                    onChange={(e) => f.setNewOutlet((p) => ({ ...p, type: e.target.value }))}
                  >
                    {OUTLET_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <p className="info-text">Created on submit.</p>
              </div>
            )}

            <label htmlFor="fulfillmentSel" className="fx-label">Fulfillment</label>
            <div className="select-wrap">
              <select
                id="fulfillmentSel"
                className="fx-input"
                value={f.fulfillmentType}
                onChange={(e) => f.setFulfillmentType(e.target.value)}
              >
                <option value="Distributor">Distributor — inventory on delivery</option>
                <option value="Self Serving">Self serving — no deduction</option>
              </select>
            </div>

            <label htmlFor="commentBox" className="fx-label">Comments</label>
            <textarea
              id="commentBox"
              className="fx-input fx-textarea"
              value={f.comment}
              onChange={(e) => f.setComment(e.target.value)}
              placeholder="Special instructions…"
              rows={3}
            />
          </section>

          <section className="card fx-card-enter" style={{ animationDelay: '0.12s' }}>
            <h2 className="card-title">
              <span className="card-title-step">2</span> Products
            </h2>

            <div className="filter-row glass-inset">
              <span className="filter-label">Type</span>
              <select
                className="filter-select fx-input"
                value={f.productTypeFilter}
                onChange={(e) => f.setProductTypeFilter(e.target.value)}
              >
                <option value="all">All types (grouped)</option>
                {f.productTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="chip-row">
              <button
                type="button"
                className={`chip ${f.productTypeFilter === 'all' ? 'active' : ''}`}
                onClick={() => f.setProductTypeFilter('all')}
              >
                All
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
                      <div className="product-type-heading">
                        <span className="heading-line" />
                        {group.type}
                      </div>
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

          <section className="card fx-card-enter summary-card" style={{ animationDelay: '0.2s' }}>
            <h2 className="card-title">
              <span className="card-title-step">3</span> Summary & submit
            </h2>

            <div className="summary-kpi-mini">
              <div><span className="kpi-label">Drop Size</span><strong>{lineCount}</strong></div>
              <div><span className="kpi-label">Qty</span><strong>{f.totalQty}</strong></div>
              <div><span className="kpi-label">Amount</span><strong>₹{f.totalAmount.toFixed(0)}</strong></div>
            </div>

            <div className="summary-panel">
              {f.sortedLineItems.length === 0 ? (
                <p className="empty-state">Add products to see your order summary</p>
              ) : (
                <ul className="summary-lines">
                  {f.sortedLineItems.map((item) => (
                    <li key={item.product_id} className="summary-line">
                      <span className="summary-line-name">{item.product_name}</span>
                      <span className="summary-line-qty">×{item.qty}</span>
                      <span className="summary-line-amt">
                        ₹{(item.qty * Number(item.rate)).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="summary-footer">
              <div className="summary-total-row">
                <span>Total quantity</span>
                <strong className="fx-mono">{f.totalQty}</strong>
              </div>
              <div className="summary-total-row summary-total-amount">
                <span>Total amount</span>
                <strong className="fx-mono">₹{f.totalAmount.toFixed(2)}</strong>
              </div>
            </div>

            <div className="button-group">
              <button
                type="button"
                className="btn-fx btn-fx--primary"
                disabled={f.submitting}
                onClick={f.handleSubmit}
              >
                <span className="btn-shine" aria-hidden />
                {f.submitting ? 'Submitting…' : 'Submit draft order'}
              </button>
              <button type="button" className="btn-fx btn-fx--danger" onClick={f.clearForm}>
                Clear
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
