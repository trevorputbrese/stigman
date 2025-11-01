#!/usr/bin/env node

/**
 * Cloud Foundry Startup Wrapper for STIG Manager
 *
 * This script parses Cloud Foundry's VCAP_SERVICES environment variable
 * to extract MySQL database credentials and sets them as STIGMAN_DB_*
 * environment variables expected by the application.
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('=== STIG Manager Cloud Foundry Startup ===');

// Parse VCAP_SERVICES
const vcapServices = process.env.VCAP_SERVICES;

if (!vcapServices) {
  console.error('ERROR: VCAP_SERVICES environment variable not found');
  console.error('This application requires a MySQL service binding in Cloud Foundry');
  process.exit(1);
}

let services;
try {
  services = JSON.parse(vcapServices);
  console.log('✓ Parsed VCAP_SERVICES');
} catch (error) {
  console.error('ERROR: Failed to parse VCAP_SERVICES JSON:', error.message);
  process.exit(1);
}

// Find MySQL service - look for common Cloud Foundry MySQL service types
const mysqlServiceTypes = ['mysql', 'p.mysql', 'p-mysql', 'cleardb'];
let mysqlService = null;
let serviceType = null;

for (const type of mysqlServiceTypes) {
  if (services[type] && services[type].length > 0) {
    // Look for our specific service instance by name
    mysqlService = services[type].find(s => s.name === 'mysql-stig-db');
    if (mysqlService) {
      serviceType = type;
      break;
    }
    // If not found by name, use the first MySQL service available
    if (!mysqlService) {
      mysqlService = services[type][0];
      serviceType = type;
      console.warn(`⚠ Service 'mysql-stig-db' not found, using first ${type} service: ${mysqlService.name}`);
      break;
    }
  }
}

if (!mysqlService) {
  console.error('ERROR: No MySQL service found in VCAP_SERVICES');
  console.error('Available services:', Object.keys(services));
  console.error('Please bind a MySQL service named "mysql-stig-db" to this application');
  process.exit(1);
}

console.log(`✓ Found MySQL service: ${mysqlService.name} (type: ${serviceType})`);

// Extract credentials
const credentials = mysqlService.credentials;

if (!credentials) {
  console.error('ERROR: MySQL service credentials not found');
  process.exit(1);
}

// Map Cloud Foundry MySQL credentials to STIGMAN environment variables
// Different MySQL service providers may use different credential keys
const hostname = credentials.hostname || credentials.host;
const port = credentials.port || 3306;
const database = credentials.name || credentials.database || credentials.schema;
const username = credentials.username || credentials.user;
const password = credentials.password;

if (!hostname || !database || !username || !password) {
  console.error('ERROR: Incomplete MySQL credentials');
  console.error('Available credential keys:', Object.keys(credentials));
  process.exit(1);
}

// Set STIGMAN database environment variables
process.env.STIGMAN_DB_HOST = hostname;
process.env.STIGMAN_DB_PORT = port.toString();
process.env.STIGMAN_DB_SCHEMA = database;
process.env.STIGMAN_DB_USER = username;
process.env.STIGMAN_DB_PASSWORD = password;

console.log('✓ Database credentials configured:');
console.log(`  Host: ${hostname}`);
console.log(`  Port: ${port}`);
console.log(`  Database: ${database}`);
console.log(`  Username: ${username}`);
console.log(`  Password: ${'*'.repeat(8)}`);

// Check if TLS credentials are provided (some CF MySQL services provide these)
if (credentials.ca_certificate) {
  const fs = require('fs');
  const caPath = '/tmp/mysql-ca.pem';
  fs.writeFileSync(caPath, credentials.ca_certificate);
  process.env.STIGMAN_DB_TLS_CA_FILE = caPath;
  console.log('✓ MySQL TLS CA certificate configured');
}

// Set STIGMAN_API_PORT from Cloud Foundry's PORT environment variable
// Cloud Foundry sets PORT dynamically - this cannot be set in manifest.yml
if (process.env.PORT) {
  process.env.STIGMAN_API_PORT = process.env.PORT;
  console.log(`✓ API port configured from Cloud Foundry: ${process.env.PORT}`);
}

// Log other important environment variables
console.log('\n=== Application Configuration ===');
console.log(`Port: ${process.env.PORT || process.env.STIGMAN_API_PORT || '54000'}`);
console.log(`OIDC Provider: ${process.env.STIGMAN_OIDC_PROVIDER || 'NOT SET'}`);
console.log(`Client Directory: ${process.env.STIGMAN_CLIENT_DIRECTORY || '../../client/dist'}`);
console.log(`Docs Directory: ${process.env.STIGMAN_DOCS_DIRECTORY || '../../docs/_build/html'}`);

// Start the main application
console.log('\n=== Starting STIG Manager ===\n');

const appPath = path.join(__dirname, 'api', 'source', 'index.js');
const app = spawn('node', [appPath], {
  stdio: 'inherit',
  env: process.env
});

app.on('error', (error) => {
  console.error('ERROR: Failed to start application:', error);
  process.exit(1);
});

app.on('exit', (code, signal) => {
  if (signal) {
    console.log(`Application terminated by signal: ${signal}`);
  } else {
    console.log(`Application exited with code: ${code}`);
  }
  process.exit(code || 0);
});

// Handle shutdown signals
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  app.kill('SIGTERM');
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  app.kill('SIGINT');
});
