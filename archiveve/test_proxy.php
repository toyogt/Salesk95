<?php
$url = 'https://jaasosewjbrwdklscxrn.supabase.co/rest/v1/';
$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ['apikey: ' . $supabase_key]);
$response = curl_exec($ch);
$error = curl_error($ch);
curl_close($ch);
if ($error) {
    echo "cURL error: $error";
} else {
    echo "Success – response length: " . strlen($response);
}
?>