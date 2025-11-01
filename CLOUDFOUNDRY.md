# Cloud Foundry Deployment Guide for STIG Manager

This guide provides instructions for deploying STIG Manager to a Cloud Foundry environment.

## Prerequisites

Before deploying, ensure you have:

1. **Cloud Foundry CLI** installed and configured
   ```bash
   cf --version
   cf login
   ```

2. **Node.js and npm** installed locally (for building client and docs)
   ```bash
   node --version  # Should be >= 18.0.0
   npm --version
   ```

3. **uglify-js** installed globally
   ```bash
   npm install -g uglify-js
   ```

4. **MySQL service** provisioned in Cloud Foundry
   - Service instance name: `mysql-stig-db`
   - MySQL version: 8.0.24+ (8.4+ recommended)

5. **Okta OIDC Provider** configured with:
   - Client ID: `stig-manager` (or update in manifest.yml)
   - Redirect URIs configured for your app route
   - Required scopes configured

## Pre-Deployment Steps

> **⚠️ CRITICAL: OIDC Provider Required**
>
> STIG Manager **requires a valid, reachable OIDC provider** to start. The application will immediately crash on startup if it cannot connect to the OIDC provider specified in `STIGMAN_OIDC_PROVIDER`.
>
> **You MUST update [manifest.yml](manifest.yml) with your real Okta/OIDC provider URL BEFORE deploying.** The placeholder URL `https://your-okta-domain.okta.com/oauth2/default` will cause the app to fail.

### 1. Build the Client

The ExtJS client must be built locally before pushing to Cloud Foundry:

```bash
cd client
./build.sh
```

This will create the `client/dist` directory with minified JavaScript and static assets.

### 2. Build the Documentation

The Sphinx documentation must be built locally:

```bash
cd ../docs
./build.sh
```

This will create the `docs/_build/html` directory with the documentation site.

**Note:** If you don't need the documentation, you can skip this step and set `STIGMAN_DOCS_DISABLED: "true"` in [manifest.yml](manifest.yml).

### 3. Configure the Manifest ⚠️ **REQUIRED**

Edit [manifest.yml](manifest.yml) and update with your **real Okta OIDC provider URL**:

```yaml
env:
  # CRITICAL: Replace with your ACTUAL Okta domain
  # The app will crash if this URL is invalid or unreachable
  STIGMAN_OIDC_PROVIDER: https://your-okta-domain.okta.com/oauth2/default

  # Update client ID if different
  STIGMAN_CLIENT_ID: stig-manager

  # Set classification banner if needed
  STIGMAN_CLASSIFICATION: U
```

If your MySQL service has a different name than `mysql-stig-db`, update:

```yaml
services:
  - your-mysql-service-name
```

### 4. Create MySQL Service

If you haven't already created the MySQL service:

```bash
# List available MySQL plans
cf marketplace -e mysql

# Create MySQL service instance
cf create-service mysql <plan-name> mysql-stig-db

# Wait for service to be ready
cf service mysql-stig-db
```

## Deployment

### Push the Application

From the repository root:

```bash
cf push
```

The deployment will:
1. Upload application files (excluding items in `.cfignore`)
2. Use the Node.js buildpack
3. Install dependencies via `npm install`
4. Bind to the `mysql-stig-db` service
5. Start the application using `start.js` wrapper

### Monitor Deployment

```bash
# View logs during deployment
cf logs stigman --recent

# Check application status
cf app stigman

# View routes
cf routes | grep stigman
```

## Post-Deployment

### 1. Verify Health

Check that the application is running:

```bash
cf app stigman
```

Access the health endpoint:
```bash
curl https://stigman.<your-domain>/api/op/configuration
```

### 2. Configure Okta Redirect URIs

In your Okta application settings, add the redirect URIs:
- `https://stigman.<your-domain>/`
- `https://stigman.<your-domain>/oauth-redirect.html`

### 3. Test the Application

1. Navigate to `https://stigman.<your-domain>/`
2. You should be redirected to Okta for authentication
3. After login, you should see the STIG Manager interface

## Environment Variables

The following environment variables are automatically configured:

### Database (from VCAP_SERVICES)
- `STIGMAN_DB_HOST` - Extracted from MySQL service binding
- `STIGMAN_DB_PORT` - Extracted from MySQL service binding
- `STIGMAN_DB_SCHEMA` - Extracted from MySQL service binding
- `STIGMAN_DB_USER` - Extracted from MySQL service binding
- `STIGMAN_DB_PASSWORD` - Extracted from MySQL service binding

### Application (from manifest.yml)
- `STIGMAN_API_PORT` - Set to Cloud Foundry's `$PORT`
- `STIGMAN_CLIENT_DIRECTORY` - Set to `./client`
- `STIGMAN_DOCS_DIRECTORY` - Set to `./docs`
- `STIGMAN_OIDC_PROVIDER` - Your Okta provider URL
- `STIGMAN_CLIENT_ID` - OAuth client ID

### Optional Configuration

You can add additional environment variables to [manifest.yml](manifest.yml):

```yaml
env:
  # Logging
  STIGMAN_LOG_LEVEL: 3  # 0=error, 1=warn, 2=info, 3=verbose, 4=debug

  # Classification banner
  STIGMAN_CLASSIFICATION: U  # U, C, S, TS, etc.

  # JWT configuration (if needed)
  STIGMAN_JWT_PRIVILEGES_CLAIM: realm_access.roles
  STIGMAN_JWT_USERNAME_CLAIM: preferred_username

  # Connection pooling
  STIGMAN_DB_MAX_CONNECTIONS: 25

  # Feature flags
  STIGMAN_SWAGGER_ENABLED: "false"
  STIGMAN_CLIENT_DISABLED: "false"
  STIGMAN_DOCS_DISABLED: "false"
```

Apply changes:
```bash
cf set-env stigman STIGMAN_LOG_LEVEL 4
cf restage stigman
```

## Scaling

### Horizontal Scaling

Scale the number of instances:

```bash
cf scale stigman -i 3
```

The application is stateless and can scale horizontally. All state is stored in MySQL.

### Vertical Scaling

Increase memory if needed:

```bash
cf scale stigman -m 2G
```

## Troubleshooting

### View Logs

```bash
# Real-time logs
cf logs stigman

# Recent logs
cf logs stigman --recent
```

### Database Connection Issues

Check the MySQL service binding:

```bash
cf env stigman
```

Look for `VCAP_SERVICES` and verify MySQL credentials are present.

### Application Won't Start

1. Check that client and docs were built:
   ```bash
   ls -la client/dist
   ls -la docs/_build/html
   ```

2. Verify the `start.js` script can parse VCAP_SERVICES:
   ```bash
   cf logs stigman --recent | grep "VCAP_SERVICES"
   ```

3. Check environment variables:
   ```bash
   cf env stigman
   ```

### Authentication Issues

1. Verify Okta provider URL is correct:
   ```bash
   cf env stigman | grep STIGMAN_OIDC_PROVIDER
   ```

2. Check Okta redirect URIs include your Cloud Foundry route

3. Verify client ID matches:
   ```bash
   cf env stigman | grep STIGMAN_CLIENT_ID
   ```

## Updating the Application

To deploy updates:

```bash
# Rebuild client and docs if they changed
cd client && ./build.sh && cd ..
cd docs && ./build.sh && cd ..

# Push updates
cf push

# Or for zero-downtime deployment
cf push stigman --strategy rolling
```

## Architecture Notes

### How It Works

1. **Cloud Foundry Buildpack** detects Node.js application via `package.json`
2. **npm install** runs, installing dependencies in `api/source/node_modules`
3. **start.js wrapper** executes:
   - Parses `VCAP_SERVICES` JSON
   - Extracts MySQL credentials
   - Sets `STIGMAN_DB_*` environment variables
   - Spawns `api/source/index.js`
4. **Express application** starts:
   - Connects to MySQL using extracted credentials
   - Serves API at `/api/*`
   - Serves client static files at `/`
   - Serves documentation at `/docs/*`

### File Structure

```
/
├── manifest.yml          # Cloud Foundry deployment config
├── start.js              # VCAP_SERVICES parser and app launcher
├── package.json          # Root package.json for CF buildpack
├── .cfignore             # Files to exclude from upload
├── client/
│   └── dist/             # Pre-built client (MUST BUILD LOCALLY)
├── docs/
│   └── _build/html/      # Pre-built docs (MUST BUILD LOCALLY)
└── api/source/
    ├── package.json      # API dependencies
    ├── index.js          # Main application entry point
    └── ...
```

## Additional Resources

- [Cloud Foundry Documentation](https://docs.cloudfoundry.org/)
- [Node.js Buildpack](https://docs.cloudfoundry.org/buildpacks/node/index.html)
- [STIG Manager Documentation](https://stig-manager.readthedocs.io/)
- [Okta OIDC Configuration](https://developer.okta.com/docs/guides/implement-oauth-for-okta/overview/)

## Support

For issues specific to Cloud Foundry deployment, check:
1. Application logs: `cf logs stigman --recent`
2. Service bindings: `cf env stigman`
3. Health endpoint: `https://stigman.<your-domain>/api/op/configuration`

For STIG Manager application issues, refer to the main repository documentation.
