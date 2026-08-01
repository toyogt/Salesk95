<?php
declare(strict_types=1);

// Same-origin Supabase relay used by the existing application.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    $originHost = parse_url($origin, PHP_URL_HOST);
    $requestHost = strtolower(explode(':', $_SERVER['HTTP_HOST'] ?? '')[0]);
    if (!is_string($originHost) || !hash_equals($requestHost, strtolower($originHost))) {
        http_response_code(403);
        echo json_encode(['error' => 'Origin not allowed']);
        exit;
    }
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}

header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, apikey, Prefer, Range, x-upsert, cache-control');
header('Access-Control-Expose-Headers: Content-Range, Preference-Applied');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (!function_exists('curl_init')) {
    http_response_code(500);
    echo json_encode(['error' => 'The PHP cURL extension is required']);
    exit;
}

$supabaseUrl = rtrim(getenv('SUPABASE_URL') ?: 'https://jaasosewjbrwdklscxrn.supabase.co', '/');
$supabaseKey = getenv('SUPABASE_ANON_KEY') ?: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphYXNvc2V3amJyd2RrbHNjeHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMjAxMDEsImV4cCI6MjA4NTY5NjEwMX0.OE-dD6EN5DR3fvnaAd9jW3cJ7_5sYXNkY5vOQFQ00w0';
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$type = $_GET['type'] ?? '';
$path = ltrim((string)($_GET['path'] ?? ''), '/');

$allowedMethods = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
$allowedTypes = ['auth' => '/auth/v1/', 'rest' => '/rest/v1/', 'storage' => '/storage/v1/'];
$allowedAuthPaths = ['token', 'signup', 'recover', 'verify', 'resend', 'otp', 'logout', 'user', 'reauthenticate'];
$allowedTables = [
    'access_manager', 'activity_log', 'attendance_records', 'calendar',
    'distributor_inventory', 'distributor_stock_requests', 'distributors',
    'inventory_transactions', 'non_buyers', 'order_items', 'orders', 'outlets',
    'products', 'sales_targets', 'users', 'visit_products', 'visits'
];
$allowedFunctions = ['check_inventory'];

if (!in_array($method, $allowedMethods, true) || !array_key_exists($type, $allowedTypes)) {
    http_response_code(405);
    echo json_encode(['error' => 'Unsupported proxy request']);
    exit;
}

if ($path === '' || strlen($path) > 300 || strpos($path, '..') !== false ||
    !preg_match("~^[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$~", $path)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid API path']);
    exit;
}

if ($type === 'auth') {
    $authPath = explode('/', $path, 2)[0];
    if (!in_array($authPath, $allowedAuthPaths, true)) {
        http_response_code(403);
        echo json_encode(['error' => 'Auth endpoint not allowed']);
        exit;
    }
} elseif ($type === 'rest') {
    $parts = explode('/', $path);
    $resource = $parts[0] === 'rpc' ? ($parts[1] ?? '') : $parts[0];
    if ($parts[0] !== 'rpc' && !in_array($resource, $allowedTables, true)) {
        http_response_code(403);
        echo json_encode(['error' => 'Database resource not allowed']);
        exit;
    }
    if ($parts[0] === 'rpc' && !in_array($resource, $allowedFunctions, true)) {
        http_response_code(403);
        echo json_encode(['error' => 'Database function not allowed']);
        exit;
    }
} elseif (!preg_match('~^object/profile-photos(?:/|$)~', $path)) {
    http_response_code(403);
    echo json_encode(['error' => 'Storage resource not allowed']);
    exit;
}

$query = $_GET;
unset($query['type'], $query['path']);
$url = $supabaseUrl . $allowedTypes[$type] . $path;
if ($query !== []) {
    $url .= '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
}

$incomingHeaders = function_exists('getallheaders') ? getallheaders() : [];
$authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? ($incomingHeaders['Authorization'] ?? $incomingHeaders['authorization'] ?? '');
$contentType = $_SERVER['CONTENT_TYPE'] ?? 'application/json';
// PostgREST only accepts JSON for REST mutations. Some older cached clients
// accidentally sent a JSON body as text/plain; normalize it at this boundary.
if ($type === 'rest' && in_array($method, ['POST', 'PATCH', 'PUT', 'DELETE'], true) &&
    stripos($contentType, 'text/plain') === 0) {
    $contentType = 'application/json';
}
$headers = [
    'apikey: ' . $supabaseKey,
    'Authorization: ' . ($authorization !== '' ? preg_replace('/[\r\n]+/', '', $authorization) : 'Bearer ' . $supabaseKey),
    'Content-Type: ' . preg_replace('/[\r\n]+/', '', $contentType),
    'Accept: application/json',
    'Prefer: ' . preg_replace('/[\r\n]+/', '', $incomingHeaders['Prefer'] ?? $incomingHeaders['prefer'] ?? 'return=representation')
];

if (isset($_SERVER['HTTP_RANGE'])) {
    $headers[] = 'Range: ' . preg_replace('/[\r\n]+/', '', $_SERVER['HTTP_RANGE']);
}
if (isset($_SERVER['HTTP_X_UPSERT'])) {
    $headers[] = 'x-upsert: ' . preg_replace('/[\r\n]+/', '', $_SERVER['HTTP_X_UPSERT']);
}
if (isset($_SERVER['HTTP_CACHE_CONTROL'])) {
    $headers[] = 'cache-control: ' . preg_replace('/[\r\n]+/', '', $_SERVER['HTTP_CACHE_CONTROL']);
}

$body = file_get_contents('php://input');
if ($body === false || strlen($body) > 5 * 1024 * 1024) {
    http_response_code(413);
    echo json_encode(['error' => 'Request body is too large']);
    exit;
}

$responseHeaders = [];
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_HEADERFUNCTION => static function ($curl, string $line) use (&$responseHeaders): int {
        $length = strlen($line);
        $parts = explode(':', $line, 2);
        if (count($parts) === 2) {
            $responseHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
        }
        return $length;
    }
]);

if ($body !== '' && in_array($method, ['POST', 'PATCH', 'PUT', 'DELETE'], true)) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$response = curl_exec($ch);
$status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($response === false) {
    http_response_code(502);
    echo json_encode(['error' => 'Unable to reach the authentication service']);
    error_log('Supabase proxy transport error: ' . $curlError);
    exit;
}

foreach (['content-type', 'content-range', 'preference-applied'] as $name) {
    if (isset($responseHeaders[$name])) {
        header($name . ': ' . $responseHeaders[$name]);
    }
}

http_response_code($status > 0 ? $status : 502);
echo $response;
