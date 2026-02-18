// Quick server test script
import http from 'http';

console.log('Testing http://localhost:3000 endpoints...\n');

// Test 1: Main page
http.get('http://localhost:3000/', (res) => {
  console.log('✓ Main page (/)');
  console.log(`  Status: ${res.statusCode}`);
  console.log(`  Content-Type: ${res.headers['content-type']}`);
  
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(`  Page size: ${data.length} bytes`);
    console.log(`  Contains canvas: ${data.includes('canvas') ? 'YES' : 'NO'}`);
    console.log(`  Contains HUD: ${data.includes('id="hud"') ? 'YES' : 'NO'}`);
    console.log(`  Contains THREE.js: ${data.includes('three.module.js') ? 'YES' : 'NO'}`);
    console.log(`  Contains socket.io: ${data.includes('socket.io.js') ? 'YES' : 'NO'}`);
    console.log(`  Contains main.js: ${data.includes('main.js') ? 'YES' : 'NO'}`);
  });
}).on('error', (e) => {
  console.log('✗ Main page failed:', e.message);
});

// Test 2: Socket.io client library
setTimeout(() => {
  http.get('http://localhost:3000/socket.io/socket.io.js', (res) => {
    console.log('\n✓ Socket.io client library');
    console.log(`  Status: ${res.statusCode}`);
    console.log(`  Content-Type: ${res.headers['content-type']}`);
  }).on('error', (e) => {
    console.log('\n✗ Socket.io library failed:', e.message);
  });
}, 100);

// Test 3: Main client script
setTimeout(() => {
  http.get('http://localhost:3000/client/src/main.js', (res) => {
    console.log('\n✓ Client main.js');
    console.log(`  Status: ${res.statusCode}`);
    console.log(`  Content-Type: ${res.headers['content-type']}`);
  }).on('error', (e) => {
    console.log('\n✗ Client main.js failed:', e.message);
  });
}, 200);

console.log('\nNote: Open http://localhost:3000 in your browser to see the actual rendering.');
console.log('Open DevTools (F12) → Console tab to check for JavaScript errors.\n');
