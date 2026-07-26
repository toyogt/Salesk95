<?php
/**
 * Supabase Proxy with JWT Forwarding
 * 
 * This proxy acts as a middleware between your frontend and Supabase
 * It securely forwards requests and handles authentication headers
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, PATCH');
header('Access-Control-Allow-Headers: Content-Type, apikey, Authorization, Prefer');

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Supabase Configuration
$supabase_url = 'https://jaasosewjbrwdklscxrn.supabase.co';
$supabase_key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphYXNvc2V3amJyd2RrbHNjeHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMjAxMDEsImV4cCI6MjA4NTY5NjEwMX0.OE-dD6EN5DR3fvnaAd9jW3cJ7_5sYXNkY5vOQFQ00w0';

// Get request parameters
$path = $_GET['path'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// Get the Authorization header
$auth_header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';

// Build Supabase URL
$url = $supabase_url . '/rest/v1/' . $path;

// Add query parameters
$query = $_GET;
unset($query['path']);
if (!empty($query)) {
    $url .= '?' . http_build_query($query);
}

// Initialize cURL
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);

// Prepare headers
$headers = [
    'apikey: ' . $supabase_key,
    'Content-Type: application/json',
    'Prefer: return=representation'
];

// Forward the Authorization header if it exists
if (!empty($auth_header)) {
    $headers[] = $auth_header;
}

curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

// Add body for POST/PATCH/PUT requests
if ($method === 'POST' || $method === 'PATCH' || $method === 'PUT') {
    $input = file_get_contents('php://input');
    curl_setopt($ch, CURLOPT_POSTFIELDS, $input);
}

// Execute request
$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

// Handle response
if ($error) {
    http_response_code(500);
    echo json_encode([
        'error' => $error,
        'message' => 'Proxy request failed'
    ]);
} else {
    http_response_code($http_code);
    echo $response;
}
?>