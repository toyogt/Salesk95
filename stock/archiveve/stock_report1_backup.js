// stock_report1.js - TEST VERSION

const SUPABASE_URL = 'https://jaasosewjbrwdklscxrn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphYXNvc2V3amJyd2RrbHNjeHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMjAxMDEsImV4cCI6MjA4NTY5NjEwMX0.OE-dD6EN5DR3fvnaAd9jW3cJ7_5sYXNkY5vOQFQ00w0';

window.__supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const client = window.__supabase;

console.log('✅ TEST: Script loaded');

document.addEventListener('DOMContentLoaded', function() {
    console.log('✅ TEST: DOM loaded');
    document.getElementById('userDisplay').textContent = 'Test Mode';
});