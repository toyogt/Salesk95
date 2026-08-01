require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const appRoot = path.join(__dirname, '..');
const PORT = process.env.PORT || 5000;
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

const allowedMethods = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);
const allowedAuthPaths = new Set(['token', 'signup', 'recover', 'verify', 'resend', 'otp', 'logout', 'user', 'reauthenticate']);
const allowedTables = new Set([
  'access_manager', 'activity_log', 'attendance_records', 'calendar',
  'distributor_inventory', 'distributor_stock_requests', 'distributors',
  'inventory_transactions', 'non_buyers', 'order_items', 'orders', 'outlets',
  'products', 'sales_targets', 'users', 'visit_products', 'visits'
]);
const allowedFunctions = new Set(['check_inventory']);
const attendanceImageDir = path.join(__dirname, 'uploads', 'attendance');
const attendanceImageMaxAgeMs = 60 * 24 * 60 * 60 * 1000;

fs.mkdirSync(attendanceImageDir, { recursive: true });

function cleanupExpiredAttendanceImages() {
  const cutoff = Date.now() - attendanceImageMaxAgeMs;
  for (const entry of fs.readdirSync(attendanceImageDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filePath = path.join(attendanceImageDir, entry.name);
    try {
      if (fs.statSync(filePath).mtimeMs < cutoff) fs.unlinkSync(filePath);
    } catch (error) {
      console.error('Attendance image cleanup error:', error.message);
    }
  }
}

cleanupExpiredAttendanceImages();
const attendanceCleanupTimer = setInterval(cleanupExpiredAttendanceImages, 6 * 60 * 60 * 1000);
attendanceCleanupTimer.unref();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// Local equivalent of proxy.php. Production continues to execute proxy.php in PHP.
app.all('/salesk95/proxy.php', express.raw({ type: '*/*', limit: '5mb' }), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Local Supabase configuration is missing' });
  }

  const type = typeof req.query.type === 'string' ? req.query.type : '';
  const apiPath = typeof req.query.path === 'string' ? req.query.path.replace(/^\/+/, '') : '';
  const basePath = type === 'auth'
    ? '/auth/v1/'
    : type === 'rest'
      ? '/rest/v1/'
      : type === 'storage'
        ? '/storage/v1/'
        : '';

  if (!allowedMethods.has(req.method) || !basePath) {
    return res.status(405).json({ error: 'Unsupported proxy request' });
  }
  if (!apiPath || apiPath.length > 300 || apiPath.includes('..') || !/^[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(apiPath)) {
    return res.status(400).json({ error: 'Invalid API path' });
  }

  if (type === 'auth') {
    if (!allowedAuthPaths.has(apiPath.split('/', 1)[0])) {
      return res.status(403).json({ error: 'Auth endpoint not allowed' });
    }
  } else if (type === 'rest') {
    const parts = apiPath.split('/');
    if (parts[0] !== 'rpc' && !allowedTables.has(parts[0])) {
      return res.status(403).json({ error: 'Database resource not allowed' });
    }
    if (parts[0] === 'rpc' && !allowedFunctions.has(parts[1] || '')) {
      return res.status(403).json({ error: 'Database function not allowed' });
    }
  } else if (!/^object\/(?:public\/)?(?:profile-photos|attendance-photos)(?:\/|$)/.test(apiPath)) {
    return res.status(403).json({ error: 'Storage resource not allowed' });
  }

  const target = new URL(`${supabaseUrl}${basePath}${apiPath}`);
  for (const [name, value] of Object.entries(req.query)) {
    if (name === 'type' || name === 'path') continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === 'string') target.searchParams.append(name, item);
    }
  }

  const authorization = typeof req.headers.authorization === 'string'
    ? req.headers.authorization
    : `Bearer ${supabaseAnonKey}`;
  let contentType = req.headers['content-type'] || 'application/json';
  if (type === 'rest' && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && /^text\/plain/i.test(contentType)) {
    contentType = 'application/json';
  }
  const headers = {
    apikey: supabaseAnonKey,
    authorization,
    accept: 'application/json',
    'content-type': contentType,
    prefer: req.headers.prefer || 'return=representation'
  };
  if (req.headers.range) headers.range = req.headers.range;
  if (req.headers['x-upsert']) headers['x-upsert'] = req.headers['x-upsert'];
  if (req.headers['cache-control']) headers['cache-control'] = req.headers['cache-control'];

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) || !req.body?.length ? undefined : req.body,
      signal: AbortSignal.timeout(30000)
    });

    for (const name of ['content-type', 'content-range', 'preference-applied']) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    return res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error('Supabase proxy transport error:', error.message);
    return res.status(502).json({ error: 'Unable to reach the authentication service' });
  }
});

app.use(express.json());

app.post('/salesk95/api/attendance-images', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }), async (req, res) => {
  const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  if (!authorization.startsWith('Bearer ') || !req.body?.length) {
    return res.status(400).json({ error: 'A signed-in user and selfie image are required.' });
  }
  try {
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseAnonKey, authorization }
    });
    if (!userResponse.ok) return res.status(401).json({ error: 'Your session has expired.' });
    const user = await userResponse.json();
    const extension = { 'image/png': 'png', 'image/webp': 'webp' }[req.headers['content-type']] || 'jpg';
    const safeUserId = String(user.id || 'user').replace(/[^a-zA-Z0-9-]/g, '');
    const fileName = `${safeUserId}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${extension}`;
    fs.writeFileSync(path.join(attendanceImageDir, fileName), req.body);
    return res.status(201).json({ url: `/salesk95/attendance-images/${fileName}`, expiresAfterDays: 60 });
  } catch (error) {
    console.error('Attendance image upload error:', error.message);
    return res.status(500).json({ error: 'Unable to save attendance selfie.' });
  }
});

app.use('/salesk95/attendance-images', express.static(attendanceImageDir, { maxAge: '1d', immutable: false }));
app.use('/salesk95/sales_dashboard', express.static(path.join(appRoot, 'sales_dashboard'), {
  etag: false,
  setHeaders: res => res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
}));
app.use('/salesk95', express.static(appRoot));

app.get('/', (req, res) => {
  res.redirect('/salesk95/index.html');
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}/salesk95/index.html`);
});
