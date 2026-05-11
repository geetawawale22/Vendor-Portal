import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';

const Icon = ({ d, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((path, index) => <path key={index} d={path} />) : <path d={d} />}
  </svg>
);

const Icons = {
  dashboard: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  dispatches: ['M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z', 'M3.27 6.96L12 12.01l8.73-5.05', 'M12 22.08V12'],
  reports: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8', 'M10 9H8'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  plus: 'M12 5v14M5 12h14',
  eye: ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  check: 'M20 6L9 17l-5-5',
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
  chevronRight: 'M9 18l6-6-6-6',
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'],
  search: ['M11 17.25a6.25 6.25 0 1 1 0-12.5 6.25 6.25 0 0 1 0 12.5z', 'M16 16l3.5 3.5'],
  arrowLeft: 'M19 12H5M12 5l-7 7 7 7',
};

const WEIGHT_UNITS = ['KG', 'Ton'];
const ASN_UNITS = ['KG', 'Ton', 'Bag', 'Piece', 'Drum'];
const BILLING_TYPES = ['Rate Per Trip', 'Rate Per Ton'];
const STATUS_LABELS = {
  CREATED: 'Created',
  INTRANSIT: 'In Transit',
  DELIVERED: 'Delivered',
  DELAYED: 'Delayed',
  REJECTED: 'Rejected',
};
const STATUS_COLORS = {
  CREATED: 'badge-orange',
  INTRANSIT: 'badge-purple',
  ARRIVED: 'badge-blue',
  DELIVERED: 'badge-green',
  DELAYED: 'badge-red',
  REJECTED: 'badge-dark',
};
const NEXT_STATUSES = {
  CREATED: ['INTRANSIT'],
  INTRANSIT: ['ARRIVED', 'DELAYED', 'DELIVERED', 'REJECTED'],
  ARRIVED: ['DELIVERED', 'DELAYED', 'REJECTED'],
  DELAYED: ['INTRANSIT', 'ARRIVED', 'DELIVERED', 'REJECTED'],
  DELIVERED: [],
  REJECTED: [],
};

const api = async (path, opts = {}) => {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
};

const fmt = {
  currency: (value) => value == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value),
  number: (value) => value == null ? '—' : new Intl.NumberFormat('en-IN').format(value),
  date: (value) => value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
  datetime: (value) => value ? new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—',
};

function statusBadge(status) {
  return <span className={`badge ${STATUS_COLORS[status] || 'badge-gray'}`}>{STATUS_LABELS[status] || status || 'Unknown'}</span>;
}

function sanitizeWholeNumber(value) {
  if (value === '' || value == null) return '';
  return String(value).replace(/[^\d]/g, '');
}

function toKg(value, unit) {
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed)) return 0;
  return unit === 'Ton' ? parsed * 1000 : parsed;
}

function computeCost(form) {
  const rate = parseFloat(form.rate_amount) || 0;
  if (!rate) return null;
  if (form.billing_type === 'Rate Per Trip') return { total: rate, breakdown: null };
  const emptyKg = toKg(form.empty_vehicle_weight, form.empty_vehicle_weight_unit);
  const loadedKg = toKg(form.loaded_vehicle_weight, form.loaded_vehicle_weight_unit);
  const capacityKg = toKg(form.vehicle_capacity, form.vehicle_capacity_unit);
  const chargeableTons = Math.min(Math.abs(loadedKg - emptyKg), capacityKg) / 1000;
  const tons = Math.max(chargeableTons, 0);
  return { total: rate * tons, breakdown: tons };
}

function defaultAsnRow() {
  return { asn_number: '', invoice_number: '', asn_material_type: '', asn_quantity: '', asn_unit: 'KG', asn_material_weight: '', asn_material_weight_unit: 'KG' };
}

function createEmptyDispatchForm() {
  return {
    vendor_name: '',
    vehicle_number: '',
    vehicle_type: '',
    transporter_name: '',
    driver_name: '',
    driver_mobile: '',
    empty_vehicle_weight: '',
    empty_vehicle_weight_unit: 'KG',
    loaded_vehicle_weight: '',
    loaded_vehicle_weight_unit: 'KG',
    vehicle_capacity: '',
    vehicle_capacity_unit: 'KG',
    billing_type: 'Rate Per Trip',
    rate_amount: '',
    delivered_to: '',
    delivery_date: '',
    receiver_contact_person: '',
    receiver_mobile: '',
    delivery_location: '',
  };
}

function dispatchToFormState(dispatch) {
  return {
    vendor_name: dispatch.vendorName || '',
    vehicle_number: dispatch.vehicleNumber || '',
    vehicle_type: dispatch.vehicleType || '',
    transporter_name: dispatch.transporterName || '',
    driver_name: dispatch.driverName || '',
    driver_mobile: dispatch.driverMobile || '',
    empty_vehicle_weight: dispatch.emptyVehicleWeight != null ? String(dispatch.emptyVehicleWeight) : '',
    empty_vehicle_weight_unit: dispatch.emptyVehicleWeightUnit || 'KG',
    loaded_vehicle_weight: dispatch.loadedVehicleWeight != null ? String(dispatch.loadedVehicleWeight) : '',
    loaded_vehicle_weight_unit: dispatch.loadedVehicleWeightUnit || 'KG',
    vehicle_capacity: dispatch.vehicleCapacity != null ? String(Math.trunc(dispatch.vehicleCapacity)) : '',
    vehicle_capacity_unit: dispatch.vehicleCapacityUnit || 'KG',
    billing_type: dispatch.billingType || 'Rate Per Trip',
    rate_amount: dispatch.rateAmount != null ? String(Math.trunc(dispatch.rateAmount)) : '',
    delivered_to: dispatch.deliveredTo || '',
    delivery_date: dispatch.deliveryDate ? dispatch.deliveryDate.slice(0, 10) : '',
    receiver_contact_person: dispatch.receiverContactPerson || '',
    receiver_mobile: dispatch.receiverMobile || '',
    delivery_location: dispatch.deliveryLocation || '',
  };
}

function dispatchToAsnRows(dispatch) {
  return dispatch?.asnEntries?.length
    ? dispatch.asnEntries.map((entry) => ({
        asn_number: entry.asnNumber || '',
        invoice_number: entry.invoiceNumber || '',
        asn_material_type: entry.materialType || '',
        asn_quantity: entry.quantity != null ? String(entry.quantity) : '',
        asn_unit: entry.unit || 'KG',
        asn_material_weight: entry.materialWeight != null ? String(entry.materialWeight) : '',
        asn_material_weight_unit: entry.materialWeightUnit || 'KG',
      }))
    : [defaultAsnRow()];
}

function appendDispatchFormData(fd, form, asnRows) {
  Object.entries(form).forEach(([key, value]) => fd.append(key, value));
  asnRows.forEach((row) => {
    fd.append('asn_number[]', row.asn_number);
    fd.append('invoice_number[]', row.invoice_number);
    fd.append('asn_material_type[]', row.asn_material_type);
    fd.append('asn_quantity[]', row.asn_quantity);
    fd.append('asn_unit[]', row.asn_unit);
    fd.append('asn_material_weight[]', row.asn_material_weight || '');
    fd.append('asn_material_weight_unit[]', row.asn_material_weight_unit || 'KG');
  });
}

const AuthCtx = createContext(null);
const useAuth = () => useContext(AuthCtx);

function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    api('/api/auth/session').then((response) => setUser(response.ok ? response.data.user : null));
  }, []);
  const login = async (identity, password) => {
    const response = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ identity, password }) });
    if (response.ok) setUser(response.data.user);
    return response;
  };
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    setUser(null);
  };
  if (user === undefined) return <div className="splash"><div className="spinner" /></div>;
  return <AuthCtx.Provider value={{ user, login, logout }}>{children}</AuthCtx.Provider>;
}

function RequireAuth({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

function Sidebar() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const items = [
    { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
    { to: '/dispatches', label: 'Dispatches', icon: 'dispatches' },
    { to: '/reports', label: 'Reports', icon: 'reports' },
  ];
  return (
    <aside className="sidebar">
      <div className="sidebar-logo"><div className="logo-mark">VP</div></div>
      <nav className="sidebar-nav">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} title={item.label}>
            <Icon d={Icons[item.icon]} />
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button className="nav-item" type="button" title="Logout" onClick={async () => { await logout(); navigate('/login'); }}>
          <Icon d={Icons.logout} />
        </button>
      </div>
    </aside>
  );
}

function TopBar({ crumbs = [], actions }) {
  const { user } = useAuth();
  return (
    <header className="topbar">
      <div className="topbar-left">
        <nav className="breadcrumb">
          {crumbs.map((crumb, index) => (
            <span key={`${crumb}-${index}`} className="crumb">
              {index > 0 && <Icon d={Icons.chevronRight} size={14} />}
              <span className={index === crumbs.length - 1 ? 'crumb-current' : 'crumb-link'}>{crumb}</span>
            </span>
          ))}
        </nav>
      </div>
      <div className="topbar-right">
        {actions}
        <div className="topbar-user">
          <div className="user-avatar"><Icon d={Icons.user} size={16} /></div>
          <span className="user-name">{user?.username}</span>
        </div>
      </div>
    </header>
  );
}

function AppLayout({ crumbs, actions, children }) {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-area">
        <TopBar crumbs={crumbs} actions={actions} />
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}

function PageHeader({ title, children }) {
  return (
    <div className="page-header">
      <h1 className="page-title">{title}</h1>
      <div className="page-actions">{children}</div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="stat-card">
      <span className={`stat-value stat-${color}`}>{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function Card({ children, className = '' }) {
  return <div className={`card ${className}`}>{children}</div>;
}

function Btn({ children, variant = 'primary', size = 'md', onClick, type = 'button', icon, disabled }) {
  return (
    <button type={type} className={`btn btn-${variant} btn-${size}`} onClick={onClick} disabled={disabled}>
      {icon && <Icon d={Icons[icon]} size={16} />}
      {children}
    </button>
  );
}

function Field({ label, error, children }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      {children}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

function Notice({ type = 'info', children }) {
  return <div className={`notice notice-${type}`}>{children}</div>;
}

function EmptyState({ message = 'No records found.' }) {
  return <div className="empty-state"><Icon d={Icons.dispatches} size={36} /><p>{message}</p></div>;
}

function DispatchFormBody({ heading, backTo, form, setForm, asnRows, setAsnRows, errors, notice, onSubmit, submitting, submitLabel }) {
  const navigate = useNavigate();
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const cost = useMemo(() => computeCost(form), [form]);

  const updateAsnRow = (index, key, value) => {
    setAsnRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)));
  };

  return (
    <>
      <PageHeader title={heading}>
        <Btn variant="ghost" icon="arrowLeft" onClick={() => navigate(-1)}>Back</Btn>
      </PageHeader>
      {notice && <Notice type="error">{notice}</Notice>}
      <div className="form-grid">
        <Card className="form-card">
          <div className="card-header"><span className="card-title">Transport & Vendor</span></div>
          <div className="form-body">
            <Field label="Vendor Name" error={errors.vendor_name}><input className="input" value={form.vendor_name} onChange={set('vendor_name')} /></Field>
            <Field label="Vehicle No" error={errors.vehicle_number}><input className="input" value={form.vehicle_number} onChange={set('vehicle_number')} placeholder="TN 01 AB 1234" /></Field>
            <div className="form-row">
              <Field label="Vehicle Type" error={errors.vehicle_type}><input className="input" value={form.vehicle_type} onChange={set('vehicle_type')} /></Field>
              <Field label="Transport Name" error={errors.transporter_name}><input className="input" value={form.transporter_name} onChange={set('transporter_name')} /></Field>
            </div>
            <div className="form-row">
              <Field label="Driver Name" error={errors.driver_name}><input className="input" value={form.driver_name} onChange={set('driver_name')} /></Field>
              <Field label="Mobile No" error={errors.driver_mobile}><input className="input" value={form.driver_mobile} onChange={set('driver_mobile')} placeholder="10-digit mobile" /></Field>
            </div>
          </div>
        </Card>

        <Card className="form-card">
          <div className="card-header"><span className="card-title">Weight & Billing</span></div>
          <div className="form-body">
            <div className="form-row">
              <Field label="Empty Vehicle Weight" error={errors.empty_vehicle_weight}>
                <div className="input-pair">
                  <input className="input" type="number" min="0" value={form.empty_vehicle_weight} onChange={set('empty_vehicle_weight')} />
                  <select className="input input-unit" value={form.empty_vehicle_weight_unit} onChange={set('empty_vehicle_weight_unit')}>
                    {WEIGHT_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                </div>
              </Field>
              <Field label="Loaded Weight" error={errors.loaded_vehicle_weight}>
                <div className="input-pair">
                  <input className="input" type="number" min="0" value={form.loaded_vehicle_weight} onChange={set('loaded_vehicle_weight')} />
                  <select className="input input-unit" value={form.loaded_vehicle_weight_unit} onChange={set('loaded_vehicle_weight_unit')}>
                    {WEIGHT_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                </div>
              </Field>
            </div>
            <div className="form-row">
              <Field label="Capacity" error={errors.vehicle_capacity}>
                <div className="input-pair">
                  <input className="input" type="text" inputMode="numeric" pattern="[0-9]*" value={form.vehicle_capacity} onChange={(event) => setForm((current) => ({ ...current, vehicle_capacity: sanitizeWholeNumber(event.target.value) }))} />
                  <select className="input input-unit" value={form.vehicle_capacity_unit} onChange={set('vehicle_capacity_unit')}>
                    {WEIGHT_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                </div>
              </Field>
              <Field label="Rate Type" error={errors.billing_type}>
                <select className="input" value={form.billing_type} onChange={set('billing_type')}>
                  {BILLING_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </Field>
              <Field label="Rate Amount (₹)" error={errors.rate_amount}>
                <input className="input" type="text" inputMode="numeric" pattern="[0-9]*" value={form.rate_amount} onChange={(event) => setForm((current) => ({ ...current, rate_amount: sanitizeWholeNumber(event.target.value) }))} />
              </Field>
            </div>
            {cost != null && (
              <div className="cost-preview">
                <div className="cost-preview-main">
                  <span className="cost-label">Total Cost <span className="cost-billing-type">({form.billing_type})</span></span>
                  <span className="cost-value">{fmt.currency(cost.total)}</span>
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card className="form-card">
          <div className="card-header">
            <span className="card-title">ASN Entries</span>
            <Btn variant="ghost" size="sm" onClick={() => setAsnRows((current) => [...current, defaultAsnRow()])}>Add ASN</Btn>
          </div>
          <div className="form-body">
            {asnRows.map((row, index) => (
              <div key={index} className="asn-row">
                <div className="form-row">
                  <Field label="ASN Number"><input className="input" value={row.asn_number} onChange={(event) => updateAsnRow(index, 'asn_number', event.target.value)} /></Field>
                  <Field label="Invoice Number"><input className="input" value={row.invoice_number} onChange={(event) => updateAsnRow(index, 'invoice_number', event.target.value)} /></Field>
                </div>
                <div className="form-row">
                  <Field label="Material Type"><input className="input" value={row.asn_material_type} onChange={(event) => updateAsnRow(index, 'asn_material_type', event.target.value)} /></Field>
                  <Field label="Quantity">
                    <div className="input-pair">
                      <input className="input" type="number" min="0" value={row.asn_quantity} onChange={(event) => updateAsnRow(index, 'asn_quantity', event.target.value)} />
                      <select className="input input-unit" value={row.asn_unit} onChange={(event) => updateAsnRow(index, 'asn_unit', event.target.value)}>
                        {ASN_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                      </select>
                    </div>
                  </Field>
                </div>
                <div className="form-row">
                  <Field label="Material Weight (optional)">
                    <div className="input-pair">
                      <input className="input" type="number" min="0" step="0.01" placeholder="e.g. 500" value={row.asn_material_weight} onChange={(event) => updateAsnRow(index, 'asn_material_weight', event.target.value)} />
                      <select className="input input-unit" value={row.asn_material_weight_unit} onChange={(event) => updateAsnRow(index, 'asn_material_weight_unit', event.target.value)}>
                        {WEIGHT_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                      </select>
                    </div>
                  </Field>
                  <div className="asn-remove-cell">
                    {asnRows.length > 1 && <Btn variant="ghost" size="sm" onClick={() => setAsnRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remove</Btn>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="form-card">
          <div className="card-header"><span className="card-title">Delivery Details</span></div>
          <div className="form-body">
            <div className="form-row">
              <Field label="Delivered To"><input className="input" placeholder="Company / Person name" value={form.delivered_to} onChange={set('delivered_to')} /></Field>
              <Field label="Delivery Date"><input className="input" type="date" value={form.delivery_date} onChange={set('delivery_date')} /></Field>
            </div>
            <div className="form-row">
              <Field label="Receiver Contact Person"><input className="input" placeholder="Name of receiver" value={form.receiver_contact_person} onChange={set('receiver_contact_person')} /></Field>
              <Field label="Receiver Mobile Number"><input className="input" placeholder="10-digit mobile" value={form.receiver_mobile} onChange={set('receiver_mobile')} /></Field>
            </div>
            <Field label="Delivery Location"><input className="input" placeholder="Full delivery address" value={form.delivery_location} onChange={set('delivery_location')} /></Field>
          </div>
        </Card>
      </div>
      <div className="form-actions">
        <Btn variant="ghost" onClick={() => navigate(-1)}>Cancel</Btn>
        <Btn type="submit" onClick={onSubmit} disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</Btn>
      </div>
    </>
  );
}

function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ identity: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  if (user) return <Navigate to="/" replace />;
  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    const response = await login(form.identity, form.password);
    setLoading(false);
    if (response.ok) navigate('/');
    else setError(response.data?.message || response.data?.error || 'Invalid credentials.');
  };
  return (
    <div className="portal-login-page">
      <div className="portal-shell">
        <header className="portal-header">
          <div className="portal-logo">VP</div>
          <span className="portal-header-link">VENDOR PORTAL</span>
        </header>
        <div className="portal-content">
          <p className="portal-welcome">Welcome to the Vendor Portal</p>
          <div className="portal-box">
            <section className="portal-section">
              <h2 className="portal-section-title">VENDOR PORTAL LOG IN</h2>
              {error && <Notice type="error">{error}</Notice>}
              <form onSubmit={submit} className="portal-form">
                <input
                  className="input"
                  value={form.identity}
                  placeholder="Email"
                  onChange={(event) => setForm((current) => ({ ...current, identity: event.target.value }))}
                  autoFocus
                />
                <input
                  className="input"
                  type="password"
                  value={form.password}
                  placeholder="Password"
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                />
                <button type="submit" className="portal-login-btn" disabled={loading}>
                  {loading ? 'LOGGING IN' : 'LOGIN'}
                </button>
              </form>
              <button type="button" className="portal-link-btn">Forgot Password?</button>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

const QUICK_UPDATE_STATUSES = ['INTRANSIT', 'DELIVERED', 'DELAYED', 'REJECTED'];

function QuickUpdateModal({ dispatch, onClose, onSuccess }) {
  const [status, setStatus] = useState('DELIVERED');
  const [currentLocation, setCurrentLocation] = useState('');
  const [expectedArrival, setExpectedArrival] = useState('');
  const [delayReason, setDelayReason] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [challan, setChallan] = useState(null);
  const [signedInvoice, setSignedInvoice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (status === 'DELAYED' && !delayReason.trim()) {
      setError('Reason for Delay is required.');
      return;
    }
    if (status === 'REJECTED' && !rejectReason.trim()) {
      setError('Reason for Rejection is required.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      if (challan || signedInvoice) {
        const fd = new FormData();
        if (challan) fd.append('delivery_challan', challan);
        if (signedInvoice) fd.append('signed_invoice', signedInvoice);
        const uploadRes = await fetch(`/api/dispatches/${dispatch.id}/delivery-documents`, { method: 'POST', credentials: 'include', body: fd });
        if (!uploadRes.ok) {
          const d = await uploadRes.json().catch(() => ({}));
          setError(d.message || 'Document upload failed.');
          setSubmitting(false);
          return;
        }
      }
      const payload = {
        status,
        current_location: currentLocation,
        estimated_arrival_time: expectedArrival || '',
        delay_reason: status === 'DELAYED' ? delayReason : '',
        driver_remarks: status === 'REJECTED' ? rejectReason : '',
      };
      const statusRes = await api(`/api/dispatches/${dispatch.id}/status`, { method: 'POST', body: JSON.stringify(payload) });
      if (!statusRes.ok) { setError(statusRes.data?.message || 'Status update failed.'); setSubmitting(false); return; }
      onSuccess();
    } catch {
      setError('An unexpected error occurred.');
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-box-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Update Dispatch</span>
          <button className="modal-close" type="button" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="modal-dispatch-ref">{dispatch.shipmentNumber || `Draft #${dispatch.id}`} &mdash; {dispatch.vendorName}</div>
          {error && <Notice type="error">{error}</Notice>}
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="New Status">
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                {QUICK_UPDATE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
            </Field>
            <div className="form-row">
              <Field label="Current Location">
                <input className="input" type="text" value={currentLocation} onChange={(e) => setCurrentLocation(e.target.value)} />
              </Field>
              <Field label="Expected Arrival Date">
                <input className="input" type="datetime-local" value={expectedArrival} onChange={(e) => setExpectedArrival(e.target.value)} />
              </Field>
            </div>
            {status === 'DELAYED' && (
              <Field label="Reason for Delay">
                <textarea className="input" rows={2} placeholder="Describe the reason for delay…" value={delayReason} onChange={(e) => setDelayReason(e.target.value)} />
              </Field>
            )}
            {status === 'REJECTED' && (
              <Field label="Reason for Rejection">
                <textarea className="input" rows={2} placeholder="Describe why this dispatch was rejected…" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
              </Field>
            )}
            <div className="modal-upload-section">
              <div className="modal-upload-label">Upload Documents <span className="text-muted">(optional)</span></div>
              <div className="form-row">
                <Field label="Delivery Challan">
                  <input className="input" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setChallan(e.target.files?.[0] || null)} />
                </Field>
                <Field label="Signed Invoice">
                  <input className="input" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setSignedInvoice(e.target.files?.[0] || null)} />
                </Field>
              </div>
            </div>
            <div className="modal-actions">
              <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
              <Btn type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save Update'}</Btn>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function DashboardPage() {
  const navigate = useNavigate();
  const [dispatches, setDispatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [updateTarget, setUpdateTarget] = useState(null);

  const load = () => {
    api('/api/dispatches').then((response) => {
      setDispatches(response.ok ? (response.data.dispatches || []) : []);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const counts = dispatches.reduce((acc, dispatch) => ({ ...acc, [dispatch.status]: (acc[dispatch.status] || 0) + 1 }), {});
  const filtered = dispatches.filter((dispatch) => {
    const query = search.trim().toLowerCase();
    const matchesStatus = statusFilter ? dispatch.status === statusFilter : true;
    const matchesSearch = !query || [dispatch.shipmentNumber, dispatch.vendorName, dispatch.vehicleNumber, dispatch.driverName].some((value) => String(value || '').toLowerCase().includes(query));
    return matchesStatus && matchesSearch;
  });
  const canEdit = (d) => d.status === 'CREATED';
  const canUpdate = (d) => !['DELIVERED', 'REJECTED', 'CREATED'].includes(d.status);

  if (loading) return <AppLayout crumbs={['Dashboard']}><div className="loading-row"><div className="spinner" /></div></AppLayout>;

  return (
    <AppLayout crumbs={['Dashboard']}>
      {updateTarget && <QuickUpdateModal dispatch={updateTarget} onClose={() => setUpdateTarget(null)} onSuccess={() => { setUpdateTarget(null); setLoading(true); load(); }} />}
      <PageHeader title="Dashboard" />
      <div className="stat-row compact">
        <button className={`stat-card clickable${statusFilter === '' ? '' : ''}`} onClick={() => setStatusFilter('')}>
          <span className="stat-value stat-blue">{dispatches.length}</span>
          <span className="stat-label">All Dispatches</span>
        </button>
        {Object.keys(STATUS_LABELS).map((status) => (
          <button key={status} className={`stat-card clickable${statusFilter === status ? ' active' : ''}`} onClick={() => setStatusFilter((current) => current === status ? '' : status)}>
            <span className={`stat-value stat-${STATUS_COLORS[status]?.replace('badge-', '')}`}>{counts[status] ?? 0}</span>
            <span className="stat-label">{STATUS_LABELS[status]}</span>
          </button>
        ))}
      </div>
      <Card>
        <div className="card-header"><span className="card-title">All Dispatches</span><div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}><div className="search-box"><Icon d={Icons.search} size={16} /><input className="search-input" placeholder="Search…" value={search} onChange={(event) => setSearch(event.target.value)} /></div><NavLink to="/dispatches" className="link-sm">View full list</NavLink></div></div>
        {!filtered.length ? <EmptyState message="No dispatches found." /> : (
          <table className="table">
            <thead><tr><th>Shipment #</th><th>Vendor</th><th>Material</th><th>Delivered To</th><th>Location</th><th>Delivery Date</th><th>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} className="row-clickable" onClick={() => navigate(`/dispatches/${d.id}`)}>
                  <td className="font-medium">{d.shipmentNumber || `Draft #${d.id}`}</td>
                  <td>{d.vendorName || '—'}</td>
                  <td>{d.materialType || '—'}</td>
                  <td>{d.deliveredTo || '—'}</td>
                  <td className="text-muted">{d.deliveryLocation || '—'}</td>
                  <td>{fmt.date(d.deliveryDate) || '—'}</td>
                  <td>{fmt.currency(d.totalCost)}</td>
                  <td>{statusBadge(d.status)}</td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <div className="row-actions">
                      {canUpdate(d) && <button className="btn btn-sm btn-primary" type="button" onClick={() => setUpdateTarget(d)}>Update Status</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </AppLayout>
  );
}

function DispatchListPage() {
  const navigate = useNavigate();
  const [dispatches, setDispatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = () => {
    api('/api/dispatches').then((response) => {
      setDispatches(response.ok ? (response.data.dispatches || []) : []);
      setLoading(false);
    });
  };
  useEffect(() => { load(); }, []);

  const counts = dispatches.reduce((acc, dispatch) => ({ ...acc, [dispatch.status]: (acc[dispatch.status] || 0) + 1 }), {});
  const filtered = dispatches.filter((dispatch) => {
    const query = search.trim().toLowerCase();
    const matchesStatus = statusFilter ? dispatch.status === statusFilter : true;
    const matchesSearch = !query || [dispatch.shipmentNumber, dispatch.vendorName, dispatch.vehicleNumber, dispatch.driverName].some((value) => String(value || '').toLowerCase().includes(query));
    return matchesStatus && matchesSearch;
  });
  const canEdit = (d) => d.status === 'CREATED';

  return (
    <AppLayout crumbs={['Dashboard', 'Dispatches']}>
      <PageHeader title="Dispatches"><Btn icon="plus" onClick={() => navigate('/dispatches/create')}>New Dispatch</Btn></PageHeader>
      <Card>
        <div className="card-header"><span className="card-title">All Dispatches</span><div className="search-box"><Icon d={Icons.search} size={16} /><input className="search-input" placeholder="Search…" value={search} onChange={(event) => setSearch(event.target.value)} /></div></div>
        {loading ? <div className="loading-row"><div className="spinner" /></div> : !filtered.length ? <EmptyState message="No dispatches found." /> : (
          <table className="table">
            <thead><tr><th>Shipment #</th><th>Vendor</th><th>Material</th><th>Delivered To</th><th>Location</th><th>Delivery Date</th><th>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} className="row-clickable" onClick={() => navigate(`/dispatches/${d.id}`)}>
                  <td className="font-medium">{d.shipmentNumber || `Draft #${d.id}`}</td>
                  <td>{d.vendorName || '—'}</td>
                  <td>{d.materialType || '—'}</td>
                  <td>{d.deliveredTo || '—'}</td>
                  <td className="text-muted">{d.deliveryLocation || '—'}</td>
                  <td>{fmt.date(d.deliveryDate) || '—'}</td>
                  <td>{fmt.currency(d.totalCost)}</td>
                  <td>{statusBadge(d.status)}</td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <div className="row-actions">
                      {canEdit(d) && <button className="btn btn-sm btn-primary" type="button" onClick={() => navigate(`/dispatches/${d.id}/edit`)}>Edit</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </AppLayout>
  );
}

function CreateDispatchPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(createEmptyDispatchForm());
  const [asnRows, setAsnRows] = useState([defaultAsnRow()]);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setNotice('');
    const formData = new FormData();
    appendDispatchFormData(formData, form, asnRows);
    const response = await fetch('/api/dispatches', { method: 'POST', credentials: 'include', body: formData });
    const data = await response.json().catch(() => ({}));
    setSubmitting(false);
    if (response.ok) navigate(`/dispatches/${data.dispatch?.id}`);
    else { setErrors(data.errors || {}); setNotice(data.message || 'Failed to create dispatch.'); }
  };
  return <AppLayout crumbs={['Dashboard', 'Dispatches', 'Create']}><DispatchFormBody heading="Create Dispatch" backTo="/dispatches" form={form} setForm={setForm} asnRows={asnRows} setAsnRows={setAsnRows} errors={errors} notice={notice} onSubmit={submit} submitting={submitting} submitLabel="Create Dispatch" /></AppLayout>;
}

function EditDispatchPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(createEmptyDispatchForm());
  const [asnRows, setAsnRows] = useState([defaultAsnRow()]);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    api(`/api/dispatches/${id}`).then((response) => {
      if (!response.ok) {
        setNotice(response.data?.message || 'Failed to load dispatch.');
        setLoading(false);
        return;
      }
      const dispatch = response.data.dispatch;
      if (dispatch.status !== 'CREATED') {
        setNotice('Only CREATED dispatches can be edited.');
        setLoading(false);
        return;
      }
      setForm(dispatchToFormState(dispatch));
      setAsnRows(dispatchToAsnRows(dispatch));
      setLoading(false);
    });
  }, [id]);
  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setNotice('');
    const formData = new FormData();
    appendDispatchFormData(formData, form, asnRows);
    const response = await fetch(`/api/dispatches/${id}`, { method: 'PUT', credentials: 'include', body: formData });
    const data = await response.json().catch(() => ({}));
    setSubmitting(false);
    if (response.ok) navigate(`/dispatches/${id}`, { replace: true });
    else { setErrors(data.errors || {}); setNotice(data.message || 'Failed to update dispatch.'); }
  };
  return <AppLayout crumbs={['Dashboard', 'Dispatches', id, 'Edit']}>{loading ? <div className="loading-row"><div className="spinner" /></div> : <DispatchFormBody heading="Edit Dispatch" backTo={`/dispatches/${id}`} form={form} setForm={setForm} asnRows={asnRows} setAsnRows={setAsnRows} errors={errors} notice={notice} onSubmit={submit} submitting={submitting} submitLabel="Update Dispatch" />}</AppLayout>;
}

function DispatchDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [dispatch, setDispatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = () => api(`/api/dispatches/${id}`).then((response) => {
    if (response.ok) setDispatch(response.data.dispatch);
    else setError(response.data?.message || 'Failed to load dispatch.');
    setLoading(false);
  });
  useEffect(() => { load(); }, [id]);
  if (loading) return <AppLayout crumbs={['Dashboard', 'Dispatches', 'Detail']}><div className="loading-row"><div className="spinner" /></div></AppLayout>;
  if (!dispatch) return <AppLayout crumbs={['Dashboard', 'Dispatches', 'Detail']}><Notice type="error">{error}</Notice></AppLayout>;
  const hasContextFields = Boolean(dispatch.currentLocation || dispatch.driverRemarks || dispatch.delayReason);
  const action = async (path, fallback) => {
    const response = await api(path, { method: 'POST' });
    if (response.ok) load();
    else setError(response.data?.message || fallback);
  };
  return (
    <AppLayout crumbs={['Dashboard', 'Dispatches', dispatch.shipmentNumber || `Draft #${dispatch.id}`]}>
      <PageHeader title={dispatch.shipmentNumber || `Draft #${dispatch.id}`}>
        <Btn variant="ghost" icon="arrowLeft" onClick={() => navigate(-1)}>Back</Btn>
        {dispatch.status === 'CREATED' && <Btn variant="ghost" onClick={() => navigate(`/dispatches/${id}/edit`)}>Edit</Btn>}
        {dispatch.status === 'CREATED' && <Btn variant="success" icon="check" onClick={() => action(`/api/dispatches/${id}/confirm`, 'Failed to confirm dispatch.')}>Confirm</Btn>}
        {['INTRANSIT', 'ARRIVED', 'DELAYED'].includes(dispatch.status) && dispatch.hasDeliveryProof && <Btn variant="success" onClick={() => action(`/api/dispatches/${id}/confirm-delivery`, 'Failed to confirm delivery.')}>Confirm Delivery</Btn>}
      </PageHeader>
      {error && <Notice type="error">{error}</Notice>}
      <div className="detail-grid">
        <div className="detail-main">
          <Card>
            <div className="card-header"><span className="card-title">Dispatch Info</span>{statusBadge(dispatch.status)}</div>
            <div className="info-grid">
              <div className="info-item"><span className="info-label">Vendor</span><span className="info-value">{dispatch.vendorName || '—'}</span></div>
              <div className="info-item"><span className="info-label">Vehicle No</span><span className="info-value">{dispatch.vehicleNumber || '—'}</span></div>
              <div className="info-item"><span className="info-label">Vehicle Type</span><span className="info-value">{dispatch.vehicleType || '—'}</span></div>
              <div className="info-item"><span className="info-label">Transporter</span><span className="info-value">{dispatch.transporterName || '—'}</span></div>
              <div className="info-item"><span className="info-label">Driver</span><span className="info-value">{dispatch.driverName || '—'}</span></div>
              <div className="info-item"><span className="info-label">Mobile</span><span className="info-value">{dispatch.driverMobile || '—'}</span></div>
              <div className="info-item"><span className="info-label">Material Type</span><span className="info-value">{dispatch.materialType || '—'}</span></div>
              <div className="info-item"><span className="info-label">Quantity</span><span className="info-value">{fmt.number(dispatch.quantity)} {dispatch.unit}</span></div>
              <div className="info-item"><span className="info-label">Empty Weight</span><span className="info-value">{fmt.number(dispatch.emptyVehicleWeight)} {dispatch.emptyVehicleWeightUnit}</span></div>
              <div className="info-item"><span className="info-label">Loaded Weight</span><span className="info-value">{fmt.number(dispatch.loadedVehicleWeight)} {dispatch.loadedVehicleWeightUnit}</span></div>
              <div className="info-item"><span className="info-label">Net Material Weight</span><span className="info-value">{fmt.number(dispatch.netMaterialWeight)} KG</span></div>
              <div className="info-item"><span className="info-label">Capacity</span><span className="info-value">{fmt.number(dispatch.vehicleCapacity)} {dispatch.vehicleCapacityUnit}</span></div>
              <div className="info-item"><span className="info-label">Billing Type</span><span className="info-value">{dispatch.billingType || '—'}</span></div>
              <div className="info-item"><span className="info-label">Rate</span><span className="info-value">{fmt.currency(dispatch.rateAmount)}</span></div>
              <div className="info-item"><span className="info-label">Total Cost</span><span className="info-value font-medium">{fmt.currency(dispatch.totalCost)} <span className="cost-billing-type">({dispatch.billingType})</span></span></div>
              <div className="info-item"><span className="info-label">Created</span><span className="info-value">{fmt.datetime(dispatch.createdAt)}</span></div>
              {hasContextFields && <>
                {dispatch.currentLocation && <div className="info-item"><span className="info-label">Current Location</span><span className="info-value">{dispatch.currentLocation}</span></div>}
                {dispatch.driverRemarks && <div className="info-item full"><span className="info-label">Driver Remarks</span><span className="info-value">{dispatch.driverRemarks}</span></div>}
                {dispatch.delayReason && <div className="info-item full"><span className="info-label">Delay Reason</span><span className="info-value">{dispatch.delayReason}</span></div>}
              </>}
              <div className="info-item"><span className="info-label">Delivered To</span><span className="info-value">{dispatch.deliveredTo || '—'}</span></div>
              <div className="info-item"><span className="info-label">Delivery Date</span><span className="info-value">{dispatch.deliveryDate ? fmt.date(dispatch.deliveryDate) : '—'}</span></div>
              <div className="info-item"><span className="info-label">Receiver Person</span><span className="info-value">{dispatch.receiverContactPerson || '—'}</span></div>
              <div className="info-item"><span className="info-label">Receiver Mobile</span><span className="info-value">{dispatch.receiverMobile || '—'}</span></div>
              <div className="info-item full"><span className="info-label">Delivery Location</span><span className="info-value">{dispatch.deliveryLocation || '—'}</span></div>
              {(() => {
                const docs = dispatch.documents || {};
                const entries = [
                  { key: 'invoice', label: 'Invoice' },
                  { key: 'asn', label: 'ASN Document' },
                  { key: 'deliveryChallan', label: 'Delivery Challan' },
                  { key: 'signedInvoice', label: 'Signed Invoice' },
                ].filter(({ key }) => docs[key]);
                if (!entries.length) return null;
                return (
                  <div className="info-item full">
                    <span className="info-label">Documents</span>
                    <div className="docs-grid-inline">
                      {entries.map(({ key, label }) => (
                        <a key={key} className="doc-card" href={docs[key].url} target="_blank" rel="noopener noreferrer">
                          <span className="doc-icon"><Icon d={Icons.upload} size={18} /></span>
                          <span className="doc-info">
                            <span className="doc-label">{label}</span>
                            <span className="doc-filename">{docs[key].filename}</span>
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </Card>
          {!!dispatch.asnEntries?.length && (
            <Card>
              <div className="card-header"><span className="card-title">ASN Entries</span></div>
              <table className="table">
                <thead><tr><th>ASN #</th><th>Invoice #</th><th>Material</th><th>Qty</th><th>Unit</th><th>Weight</th></tr></thead>
                <tbody>{dispatch.asnEntries.map((entry) => <tr key={entry.id}><td>{entry.asnNumber}</td><td>{entry.invoiceNumber}</td><td>{entry.materialType}</td><td>{fmt.number(entry.quantity)}</td><td>{entry.unit}</td><td>{entry.materialWeight != null ? `${fmt.number(entry.materialWeight)} ${entry.materialWeightUnit}` : '—'}</td></tr>)}</tbody>
              </table>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function UpdateStatusPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [dispatch, setDispatch] = useState(null);
  const [form, setForm] = useState({ status: '', current_location: '', driver_remarks: '', delay_reason: '', estimated_arrival_time: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    api(`/api/dispatches/${id}`).then((response) => {
      if (!response.ok) return;
      const current = response.data.dispatch;
      setDispatch(current);
      const next = NEXT_STATUSES[current.status] || [];
      setForm({
        status: next[0] || current.status || '',
        current_location: current.currentLocation || '',
        driver_remarks: current.driverRemarks || '',
        delay_reason: current.delayReason || '',
        estimated_arrival_time: current.estimatedArrivalTime ? current.estimatedArrivalTime.slice(0, 16) : '',
      });
    });
  }, [id]);
  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    const response = await api(`/api/dispatches/${id}/status`, { method: 'POST', body: JSON.stringify(form) });
    setSubmitting(false);
    if (response.ok) navigate(`/dispatches/${id}`);
    else setError(response.data?.message || 'Failed to update status.');
  };
  if (!dispatch) return <AppLayout crumbs={['Dashboard', 'Dispatches', id, 'Update Status']}><div className="loading-row"><div className="spinner" /></div></AppLayout>;
  const allowed = NEXT_STATUSES[dispatch.status] || [];
  return (
    <AppLayout crumbs={['Dashboard', 'Dispatches', id, 'Update Status']}>
      <PageHeader title="Update Status"><Btn variant="ghost" icon="arrowLeft" onClick={() => navigate(`/dispatches/${id}`)}>Back</Btn></PageHeader>
      <div className="narrow-form"><Card><div className="card-header"><span className="card-title">Current Status: {statusBadge(dispatch.status)}</span></div><div className="form-body">{error && <Notice type="error">{error}</Notice>}{!allowed.length ? <Notice type="info">No status transitions available.</Notice> : <form onSubmit={submit}><Field label="New Status"><select className="input" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>{allowed.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></Field><Field label="Current Location"><input className="input" value={form.current_location} onChange={(event) => setForm((current) => ({ ...current, current_location: event.target.value }))} /></Field><Field label="Estimated Arrival Time"><input className="input" type="datetime-local" value={form.estimated_arrival_time} onChange={(event) => setForm((current) => ({ ...current, estimated_arrival_time: event.target.value }))} /></Field><Field label="Driver Remarks"><textarea className="input textarea" rows={3} value={form.driver_remarks} onChange={(event) => setForm((current) => ({ ...current, driver_remarks: event.target.value }))} /></Field><Field label="Delay Reason"><textarea className="input textarea" rows={3} value={form.delay_reason} onChange={(event) => setForm((current) => ({ ...current, delay_reason: event.target.value }))} /></Field><div className="form-actions"><Btn variant="ghost" onClick={() => navigate(`/dispatches/${id}`)}>Cancel</Btn><Btn type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Update Status'}</Btn></div></form>}</div></Card></div>
    </AppLayout>
  );
}

function UploadDeliveryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [dispatch, setDispatch] = useState(null);
  const [deliveryChallan, setDeliveryChallan] = useState(null);
  const [signedInvoice, setSignedInvoice] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    api(`/api/dispatches/${id}`).then((response) => { if (response.ok) setDispatch(response.data.dispatch); });
  }, [id]);
  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    const formData = new FormData();
    if (deliveryChallan) formData.append('delivery_challan', deliveryChallan);
    if (signedInvoice) formData.append('signed_invoice', signedInvoice);
    const response = await fetch(`/api/dispatches/${id}/delivery-documents`, { method: 'POST', credentials: 'include', body: formData });
    const data = await response.json().catch(() => ({}));
    setSubmitting(false);
    if (response.ok) navigate(`/dispatches/${id}`);
    else setError(data.message || 'Upload failed.');
  };
  if (!dispatch) return <AppLayout crumbs={['Dashboard', 'Dispatches', id, 'Upload Docs']}><div className="loading-row"><div className="spinner" /></div></AppLayout>;
  return (
    <AppLayout crumbs={['Dashboard', 'Dispatches', id, 'Upload Docs']}>
      <PageHeader title="Upload Delivery Documents"><Btn variant="ghost" icon="arrowLeft" onClick={() => navigate(`/dispatches/${id}`)}>Back</Btn></PageHeader>
      <div className="narrow-form"><Card><div className="form-body">{error && <Notice type="error">{error}</Notice>}<form onSubmit={submit}><Field label="Delivery Challan"><input className="input" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(event) => setDeliveryChallan(event.target.files?.[0] || null)} /></Field><Field label="Signed Invoice"><input className="input" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(event) => setSignedInvoice(event.target.files?.[0] || null)} /></Field><div className="form-actions"><Btn variant="ghost" onClick={() => navigate(`/dispatches/${id}`)}>Cancel</Btn><Btn type="submit" disabled={submitting || (!deliveryChallan && !signedInvoice)}>{submitting ? 'Uploading…' : 'Upload Documents'}</Btn></div></form></div></Card></div>
    </AppLayout>
  );
}

function ReportsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ date_from: '', date_to: '', status: '', transporter_name: '' });

  useEffect(() => {
    const params = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
    setLoading(true);
    api(`/api/reports?${params}`).then((response) => {
      setData(response.ok ? response.data : null);
      setLoading(false);
    });
  }, [filters]);
  const reportRows = data?.dispatchReport || [];
  const deliveredRows = data?.deliveryReport || [];
  const summary = {
    totalDispatches: reportRows.length,
    totalRevenue: reportRows.reduce((sum, row) => sum + (row.totalCost || 0), 0),
    totalWeight: reportRows.reduce((sum, row) => sum + (row.netMaterialWeight || 0), 0),
    delivered: deliveredRows.length,
    delayed: reportRows.filter((row) => row.status === 'DELAYED').length,
  };

  const materialSummary = (dispatch) => {
    const entries = dispatch.asnEntries || [];
    if (!entries.length) return dispatch.materialType || '—';
    const uniqueMaterials = [...new Set(entries.map((entry) => (entry.materialType || '').trim()).filter(Boolean))];
    return uniqueMaterials.length ? uniqueMaterials.join(', ') : '—';
  };

  const quantitySummary = (dispatch) => {
    const qty = dispatch.quantity;
    if (qty == null) return '—';
    return `${fmt.number(qty)} ${dispatch.unit || ''}`.trim();
  };

  return (
    <AppLayout crumbs={['Dashboard', 'Reports']}>
      <PageHeader title="Reports" />
      <Card>
        <div className="card-header"><span className="card-title">Filters</span></div>
        <div className="form-body">
          <div className="form-row four-col">
            <Field label="From Date">
              <input
                className="input"
                type="date"
                value={filters.date_from}
                onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))}
              />
            </Field>
            <Field label="To Date">
              <input
                className="input"
                type="date"
                value={filters.date_to}
                onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))}
              />
            </Field>
            <Field label="Status">
              <select className="input" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
                <option value="">All</option>
                {Object.keys(STATUS_LABELS).map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
              </select>
            </Field>
            <Field label="Transport Name">
              <input
                className="input"
                type="text"
                placeholder="Search transporter…"
                value={filters.transporter_name}
                onChange={(event) => setFilters((current) => ({ ...current, transporter_name: event.target.value }))}
              />
            </Field>
          </div>
        </div>
      </Card>
      {loading ? (
        <div className="loading-row"><div className="spinner" /></div>
      ) : (
        <>
          <div className="stat-row reports-stats">
            <StatCard label="Total Dispatches" value={summary.totalDispatches} color="blue" />
            <StatCard label="Total Cost" value={fmt.currency(summary.totalRevenue)} color="teal" />
            <StatCard label="Total Weight" value={summary.totalWeight ? `${fmt.number(summary.totalWeight)} kg` : '—'} color="purple" />
            <StatCard label="Delivered" value={summary.delivered} color="green" />
            <StatCard label="Delayed" value={summary.delayed} color="red" />
          </div>

          <Card>
            <div className="card-header"><span className="card-title">Vendor Detailed Report</span></div>
            {!reportRows.length ? (
              <EmptyState message="No records for selected filters." />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Material</th>
                    <th>Quantity</th>
                    <th>Amount</th>
                    <th>Date</th>
                    <th>Transport Name</th>
                    <th>Vehicle</th>
                    <th>Shipment #</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reportRows.map((dispatch) => (
                    <tr key={dispatch.id}>
                      <td className="font-medium">{dispatch.vendorName || '—'}</td>
                      <td>{materialSummary(dispatch)}</td>
                      <td>{quantitySummary(dispatch)}</td>
                      <td>{fmt.currency(dispatch.totalCost)}</td>
                      <td className="text-muted">{fmt.date(dispatch.createdAt)}</td>
                      <td>{dispatch.transporterName || '—'}</td>
                      <td>{dispatch.vehicleNumber || '—'}</td>
                      <td>{dispatch.shipmentNumber || `Draft #${dispatch.id}`}</td>
                      <td>{statusBadge(dispatch.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </AppLayout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<RequireAuth><DashboardPage /></RequireAuth>} />
          <Route path="/dispatches" element={<RequireAuth><DispatchListPage /></RequireAuth>} />
          <Route path="/dispatches/create" element={<RequireAuth><CreateDispatchPage /></RequireAuth>} />
          <Route path="/dispatches/:id/edit" element={<RequireAuth><EditDispatchPage /></RequireAuth>} />
          <Route path="/dispatches/:id" element={<RequireAuth><DispatchDetailPage /></RequireAuth>} />
          <Route path="/dispatches/:id/update" element={<RequireAuth><UpdateStatusPage /></RequireAuth>} />
          <Route path="/dispatches/:id/upload-delivery" element={<RequireAuth><UploadDeliveryPage /></RequireAuth>} />
          <Route path="/reports" element={<RequireAuth><ReportsPage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
