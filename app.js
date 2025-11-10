"use strict";

// ================================================================
// Module Imports
// ================================================================
const POTASpots = require('./modules/pota');
const SOTASpots = require('./modules/sota');
const RBNManager = require('./modules/rbn');
const ModeClassifier = require('./modules/modeclassifier');
const Enrichment = require('./modules/enrichment');
const Analytics = require('./modules/analytics');
const Clusters = require('./modules/clusters');
const APIv1 = require('./modules/apiv1');
const APIv2 = require('./modules/apiv2');
const Metrics = require('./modules/metrics');
const RateLimiter = require('./modules/rate-limiter');
const { toUcWord, qrg2band, getFreshestSpot, getOldestSpot } = require('./lib/utils');
const express = require("express");
const app = express();
const path = require("path");
const cors = require('cors');
const morgan = require('morgan');
const WebSocket = require('ws');
const fs = require('fs');
const os = require('os');

// Load version from package.json
const packageJson = require('./package.json');
const APP_VERSION = packageJson.version;

// Prefer global fetch if available (Node 18+), otherwise fall back to node-fetch
const fetch = (global.fetch ? global.fetch : require('node-fetch'));
if (!global.fetch) { global.fetch = fetch; }

// ================================================================
// Global Variables (must be declared before use)
// ================================================================
// Spot cache and indexes
let spots = [];
const bandIndex = new Map();  // Map<band, Set<spot>>
const frequencyIndex = new Map();  // Map<frequency, spot>
const sourceIndex = new Map();  // Map<source, Set<spot>>
const spotKeyIndex = new Map();  // Map<spotKey, spot> for O(1) duplicate detection

// WebSocket and Cluster Manager (initialized later)
const wsClients = new Set();
let wss = null;  // Will be initialized in startWebSocket()
let clusterManager = null;  // Will be initialized after config is loaded

// ================================================================
// Configuration Loading
// ================================================================
// Load .env file first (if exists), then fallback to config.js
require('dotenv').config();

let config = {};

// Check if running from environment variables (.env or Docker)
if (process.env.WEBPORT !== undefined || process.env.MODE !== undefined) {
    // Load configuration from environment variables
    config = {
        mode: process.env.MODE || 'native',
        webport: parseInt(process.env.WEBPORT) || 3000,
        baseUrl: process.env.BASEURL || '',
        maxcache: parseInt(process.env.MAXCACHE) || 200,
        spotMaxAge: parseInt(process.env.SPOT_MAX_AGE) || 120, // minutes
        
        // Parse cluster configuration
        clusters: JSON.parse(process.env.CLUSTERS || '[]'),
        
        // DXCC lookup
        dxcc_lookup_wavelog_url: process.env.WAVELOG_URL,
        dxcc_lookup_wavelog_key: process.env.WAVELOG_KEY,
        
        // Module configurations
        clusterEnabled: process.env.CLUSTER_ENABLED !== 'false',
        
        // POTA configuration
        includepotaspots: process.env.POTA_ENABLED === 'true',
        potapollinterval: parseInt(process.env.POTA_POLLING_INTERVAL) || 120,
        
        // SOTA configuration
        includesotaspots: process.env.SOTA_ENABLED === 'true',
        sotapollinterval: parseInt(process.env.SOTA_POLLING_INTERVAL) || 120,
        
        // RBN configuration
        rbnEnabled: process.env.RBN_ENABLED === 'true',
        rbnCallsign: process.env.RBN_CALLSIGN || 'N0CALL',
        rbnSpotTimeout: parseInt(process.env.RBN_SPOT_TIMEOUT) || 5, // minutes
        rbnCwRttyEnabled: process.env.RBN_CW_RTTY_ENABLED !== 'false', // default true
        rbnFt8Enabled: process.env.RBN_FT8_ENABLED === 'true', // default false
        
        // Enrichment configuration
        enrichmentEnabled: process.env.ENRICHMENT_ENABLED !== 'false',
        
        // Mode Classifier configuration
        modeClassifierEnabled: process.env.MODE_CLASSIFIER_ENABLED !== 'false',
        
        // Analytics configuration
        analyticsEnabled: process.env.ANALYTICS_ENABLED !== 'false',
        
        // API v1 and v2 configuration
        apiv1Enabled: process.env.API_V1_ENABLED !== 'false',
        apiv2Enabled: process.env.API_V2_ENABLED !== 'false',
        apiv2Key: process.env.API_V2_KEY || '',
        
        // WebSocket configuration
        websocketEnabled: process.env.WEBSOCKET_ENABLED !== 'false',
        
        // Demo page configuration
        demoEnabled: process.env.DEMO_ENABLED !== 'false',
        
        // Logging configuration
        fileLoggingEnabled: process.env.FILE_LOGGING_ENABLED !== 'false',
        logRetentionDays: parseInt(process.env.LOG_RETENTION_DAYS) || 3,
        
        // Proxy configuration
        trustProxy: process.env.TRUST_PROXY !== 'false'  // Default true for reverse proxy compatibility
    };
} else {
    // Fallback to config.js (legacy support)
    try {
        config = require("./config.js");
        config.mode = config.mode || 'native';
        config.clusterEnabled = config.clusterEnabled !== false;
        config.enrichmentEnabled = config.enrichmentEnabled !== false;
        config.analyticsEnabled = config.analyticsEnabled !== false;
        config.apiv1Enabled = config.apiv1Enabled !== false;
        config.apiv2Enabled = config.apiv2Enabled !== false;
        config.apiv2Key = config.apiv2Key || '';
        config.websocketEnabled = config.websocketEnabled !== false;
        config.demoEnabled = config.demoEnabled !== false;
        config.fileLoggingEnabled = config.fileLoggingEnabled !== false;
        config.logRetentionDays = config.logRetentionDays || 3;
        config.spotMaxAge = config.spotMaxAge || 120;
        config.trustProxy = config.trustProxy !== false;  // Default true
    } catch (e) {
        console.error('No .env file or config.js found! Please create one based on .env.sample');
        process.exit(1);
    }
}

// Ensure clusters array is populated
let clusters = config.clusters || [];
if (clusters.length === 0 && config.dxc) {
    // Legacy single cluster support
    clusters = [config.dxc];
}

// Validate configuration
function validateConfig() {
    const warnings = [];
    const errors = [];
    
    // Check clusters
    if (!clusters || clusters.length === 0) {
        warnings.push('No DX clusters configured - cluster spots will not be available');
    }
    
    // Check DXCC lookup
    if (!config.dxcc_lookup_wavelog_url || !config.dxcc_lookup_wavelog_key) {
        warnings.push('DXCC lookup not configured - spots will not have country information');
    }
    
    // Check modules
    if (!config.includepotaspots && !config.includesotaspots && (!clusters || clusters.length === 0)) {
        errors.push('No data sources enabled (no clusters, POTA, or SOTA)');
    }
    
    // Log results
    if (errors.length > 0) {
        console.error('Configuration errors:');
        errors.forEach(err => console.error(`  ❌ ${err}`));
        console.error('\nPlease fix the errors above and restart the application.');
        process.exit(1);
    }
    
    if (warnings.length > 0) {
        console.warn('Configuration warnings:');
        warnings.forEach(warn => console.warn(`  ⚠️  ${warn}`));
    }
}

validateConfig();

// ================================================================
// Logging Setup
// ================================================================
const LOG_DIR = path.join(__dirname, 'logs');
let logStream = null;

if (config.fileLoggingEnabled) {
    try { 
        fs.mkdirSync(LOG_DIR, { recursive: true }); 
    } catch (_) {}

    // Daily filename
    function fmtDate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${y}${m}${dd}`;
    }

    const today = new Date();
    const LOG_FILE = path.join(LOG_DIR, `app-${fmtDate(today)}.log`);

    // Prune old logs
    try {
        const files = fs.readdirSync(LOG_DIR);
        const cutoff = new Date(Date.now() - config.logRetentionDays * 24 * 60 * 60 * 1000);
        files.forEach(f => {
            if (!/^app-\d{8}\.log$/.test(f)) return;
            const stamp = f.slice(4, 12); // YYYYMMDD
            const y = parseInt(stamp.slice(0, 4));
            const m = parseInt(stamp.slice(4, 6)) - 1;
            const d = parseInt(stamp.slice(6, 8));
            const fileDate = new Date(y, m, d);
            if (fileDate < cutoff) {
                try { fs.unlinkSync(path.join(LOG_DIR, f)); } catch (_) {}
            }
        });
    } catch (_) {}

    logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

    function stamp(level, args) {
        const ts = new Date().toISOString();
        const line = `[${ts}] [${level}] ${args.map(a => {
            try { return (typeof a === 'string') ? a : JSON.stringify(a); }
            catch (_) { return String(a); }
        }).join(' ')}${os.EOL}`;
        return line;
    }

    const _log = console.log.bind(console);
    const _err = console.error.bind(console);
    const _warn = console.warn.bind(console);

    console.log = (...args) => { const line = stamp('INFO', args); try { logStream.write(line); } catch (_) {} _log(...args); };
    console.warn = (...args) => { const line = stamp('WARN', args); try { logStream.write(line); } catch (_) {} _warn(...args); };
    console.error = (...args) => { const line = stamp('ERROR', args); try { logStream.write(line); } catch (_) {} _err(...args); };

    console.log('--- App starting --- PID:', process.pid, 'Node:', process.versions.node, 'Mode:', config.mode, 'Log:', LOG_FILE);
} else {
    console.log('--- App starting --- PID:', process.pid, 'Node:', process.versions.node, 'Mode:', config.mode);
}

/**
 * Helper function to log messages to file and console
 * @param {string} message - Message to log
 * @param {string} level - Log level (INFO, WARN, ERROR)
 */
function logToFile(message, level = 'INFO') {
    console.log(message);
}


// ================================================================
// Express Middleware Setup
// ================================================================
morgan.token('remote-addr', function (req, res) {
    var ffHeaderValue = req.headers['x-forwarded-for'];
    return ffHeaderValue || req.connection.remoteAddress;
});

// Morgan stream for file logging
const morganStream = logStream ? {
    write: (message) => {
        try { 
            logStream.write(message.endsWith(os.EOL) ? message : message + os.EOL); 
        } catch (_) {}
    }
} : null;

app.disable('x-powered-by');
app.use(express.json());

// Trust proxy - required when behind reverse proxy (Passenger, nginx, etc.)
// This allows express-rate-limit to correctly identify users via X-Forwarded-For header
if (config.trustProxy) {
    app.set('trust proxy', true);
    console.log('Trust proxy enabled - X-Forwarded-For headers will be respected');
}

// Add API version header to all responses
app.use((req, res, next) => {
    res.setHeader('X-API-Version', APP_VERSION);
    next();
});

// Skip logging for /spots and /health endpoints to reduce noise
morgan.token('skip-logging', (req, res) => {
    return (req.url.startsWith(config.baseUrl + '/spots') || req.url.startsWith(config.baseUrl + '/health')) ? 'skip' : null;
});

if (morganStream) {
    app.use(morgan(':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms', { 
        stream: morganStream,
        skip: (req, res) => req.url.startsWith(config.baseUrl + '/spots') || req.url.startsWith(config.baseUrl + '/health')
    }));
}
app.use(morgan(':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms', {
    skip: (req, res) => req.url.startsWith(config.baseUrl + '/spots') || req.url.startsWith(config.baseUrl + '/health')
}));
app.use(cors({ origin: '*' }));

// ================================================================
// DX Cluster Module
// ================================================================
// Initialize clusterManager FIRST, before other modules that depend on it
clusterManager = new Clusters(config.clusterEnabled, clusters);

// ================================================================
// Rate Limiting Module
// ================================================================
const rateLimiter = new RateLimiter({
    enabled: true,
    trustProxy: config.trustProxy,
    exemptPaths: [config.baseUrl + '/health', config.baseUrl + '/metrics']
});

// Apply general rate limiting to all routes
app.use(rateLimiter.middleware(config.baseUrl));

// ================================================================
// Metrics Module
// ================================================================
const metrics = new Metrics({
    enabled: true,
    getSpotsData: () => spots,
    getClusterStatus: () => clusterManager.getStatus(),
    getWebSocketClients: () => wss ? wss.clients.size : 0
});

// Apply metrics tracking middleware
app.use(metrics.middleware());

// ================================================================
// API Analytics Module
// ================================================================
const analytics = new Analytics({
    enabled: config.analyticsEnabled,
    dataFile: path.join(__dirname, 'data', 'analytics.json'),
    saveInterval: 5 * 60 * 1000, // 5 minutes
    skipPaths: ['/health', '/demo', '/analytics']
});

// Apply analytics tracking middleware
app.use(analytics.middleware());

// ================================================================
// API v1 Module (Legacy)
// ================================================================
const apiv1 = new APIv1(
    config,
    () => spots,
    () => ({ bandIndex, frequencyIndex, sourceIndex })
);

// Mount API v1 router if enabled
if (config.apiv1Enabled) {
    app.use(apiv1.createRouter(rateLimiter.getDataLimiter()));
    console.log('API v1 endpoints enabled with rate limiting');
} else {
    console.log('API v1 endpoints disabled');
}

// ================================================================
// API v2 Module
// ================================================================
const apiv2 = new APIv2({
    enabled: config.apiv2Enabled,
    apiKey: config.apiv2Key,
    version: APP_VERSION,
    getSpotsData: () => spots
});

// Mount API v2 router if enabled
if (config.apiv2Enabled) {
    app.use(config.baseUrl + '/api/v2', apiv2.createRouter(rateLimiter.getDataLimiter()));
    console.log('API v2 enabled at ' + config.baseUrl + '/api/v2' + (apiv2.getStatus().requiresAuth ? ' (authentication required)' : ' (no authentication)') + ' with rate limiting');
} else {
    console.log('API v2 disabled');
}

// ================================================================
// Routes
// ================================================================

// API Information function (shared by / and /info)
function getApiInfo() {
    const endpoints = {};
    
    // API v1 endpoints (if enabled)
    if (config.apiv1Enabled) {
        endpoints.v1 = apiv1.getEndpoints();
    }
    
    // API v2 endpoints (if enabled)
    if (config.apiv2Enabled) {
        endpoints.v2 = apiv2.getEndpoints(config.baseUrl);
    }
    
    // Common endpoints
    endpoints.health = config.baseUrl + '/health';
    if (config.analyticsEnabled) {
        endpoints.analytics = config.baseUrl + '/analytics';
    }
    endpoints.info = config.baseUrl + '/info';
    
    // Only include demo endpoint if enabled
    if (config.demoEnabled) {
        endpoints.demo = config.baseUrl + '/demo';
    }
    
    return {
        name: 'DXClusterAPI',
        version: APP_VERSION,
        description: 'Real-time DX Cluster, POTA, and SOTA spot aggregation API',
        apis: {
            v1: config.apiv1Enabled,
            v2: config.apiv2Enabled
        },
        endpoints: endpoints,
        documentation: 'https://github.com/int2001/DXClusterAPI'
    };
}

// Root endpoint - API information
app.get(config.baseUrl + '/', (req, res) => {
    res.json(getApiInfo());
});

// Info endpoint - Same as root, useful when root is served by web server
app.get(config.baseUrl + '/info', (req, res) => {
    res.json(getApiInfo());
});

// Serve static files (for demo page) - only if enabled
if (config.demoEnabled) {
    // Add middleware to set no-cache and no-index headers for demo page
    app.use(config.baseUrl + '/demo', (req, res, next) => {
        // Prevent caching
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        // Prevent search engine indexing
        res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
        
        next();
    });
    
    app.use(config.baseUrl + '/demo', express.static(path.join(__dirname, 'public')));
    console.log('Demo page enabled at ' + config.baseUrl + '/demo');
} else {
    console.log('Demo page disabled');
}

// API Analytics endpoint - shows who is using the API
app.get(config.baseUrl + '/analytics', (req, res) => {
    res.json(analytics.getSummary());
});

// -----------------------------------
// DXCluster Spot Handling
// -----------------------------------

/**
 * Broadcasts a new spot to all connected WebSocket clients
 */
function broadcastSpot(spot) {
    if (wsClients.size === 0) return;

    const message = JSON.stringify({
        type: 'spot',
        data: spot
    });

    // Clean up dead clients while broadcasting
    const deadClients = [];
    wsClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
            } catch (error) {
                console.error('Error sending to WebSocket client:', error);
                deadClients.push(client);
            }
        } else if (client.readyState === WebSocket.CLOSED || client.readyState === WebSocket.CLOSING) {
            // Mark for removal
            deadClients.push(client);
        }
    });
    
    // Remove dead clients
    if (deadClients.length > 0) {
        deadClients.forEach(client => wsClients.delete(client));
        console.log(`Cleaned up ${deadClients.length} dead WebSocket clients. Active: ${wsClients.size}`);
    }
}

// Hook up cluster spot events to handlespot function
clusterManager.on('spot', async (spot, source) => {
    await handlespot(spot, source);
});

// -----------------------------------
// API Endpoints
// -----------------------------------

/**
 * GET /stats - Retrieve statistics about the cached spots.
 */
/**
 * GET /stats - Retrieve statistics about cached spots.
 */
app.get(config.baseUrl + '/stats', (req, res) => {
    // Build source breakdown from sourceIndex
    const sources = {};
    sourceIndex.forEach((spotSet, sourceName) => {
        sources[sourceName] = spotSet.size;
    });
    
    // Legacy counts (for backward compatibility)
    const clusterSpots = spots.filter(item => 
        item.source !== 'pota' && item.source !== 'sota'
    ).length;
    
    const stats = {
        entries: spots.length,
        cluster: clusterSpots,
        pota: spots.filter(item => item.source === 'pota').length,
        sota: spots.filter(item => item.source === 'sota').length,
        sources: sources,  // Per-source breakdown
        freshest: getFreshestSpot(spots),
        oldest: getOldestSpot(spots)
    };
    res.json(stats);
});

/**
 * GET /health - Health check endpoint for monitoring and load balancers.
 */
app.get(config.baseUrl + '/health', (req, res) => {
    const clusterStatus = clusterManager.getStatus();
    const mem = process.memoryUsage();
    
    const health = {
        status: 'ok',
        version: APP_VERSION,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        mode: config.mode,
        memory: {
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
            rss: Math.round(mem.rss / 1024 / 1024),
            external: Math.round(mem.external / 1024 / 1024),
            arrayBuffers: Math.round((mem.arrayBuffers || 0) / 1024 / 1024)
        },
        cache: {
            spots: spots.length,
            maxcache: config.maxcache,
            dxccCache: dxccCache.size,
            dxccPrefixCache: dxccPrefixCache.size,
            bandIndex: bandIndex.size,
            frequencyIndex: frequencyIndex.size,
            sourceIndex: sourceIndex.size,
            spotKeyIndex: spotKeyIndex.size,
            websocketClients: wsClients.size
        },
        modules: {
            cluster: {
                enabled: config.clusterEnabled,
                totalClusters: clusterStatus.totalClusters,
                activeConnections: clusterStatus.activeConnections
            },
            pota: config.includepotaspots,
            sota: config.includesotaspots,
            rbn: config.rbnEnabled ? {
                enabled: true,
                callsign: config.rbnCallsign,
                stats: typeof rbn !== 'undefined' ? rbn.getStats() : null
            } : false,
            enrichment: config.enrichmentEnabled,
            modeClassifier: config.modeClassifierEnabled ? {
                enabled: true,
                stats: modeClassifier ? modeClassifier.getStats() : null
            } : false,
            analytics: config.analyticsEnabled,
            websocket: config.websocketEnabled,
            demo: config.demoEnabled,
            metrics: metrics.getStatus(),
            rateLimiter: rateLimiter.getStatus(),
            apiv1: {
                enabled: config.apiv1Enabled
            },
            apiv2: {
                enabled: config.apiv2Enabled,
                requiresAuth: config.apiv2Key && config.apiv2Key.length > 0
            }
        }
    };
    res.json(health);
});

/**
 * GET /metrics - Prometheus metrics endpoint
 */
app.get(config.baseUrl + '/metrics', async (req, res) => {
    try {
        const metricsData = await metrics.getMetrics();
        res.set('Content-Type', metrics.getContentType());
        res.end(metricsData);
    } catch (error) {
        console.error('Error generating metrics:', error);
        res.status(500).json({ error: 'Failed to generate metrics' });
    }
});

// -----------------------------------
// Server Start
// -----------------------------------

/**
 * Initializes WebSocket server on an existing HTTP server
 */
function initializeWebSocket(server) {
    if (!config.websocketEnabled) {
        console.log('WebSocket disabled in configuration');
        return null;
    }

    wss = new WebSocket.Server({ 
        server,
        path: '/ws'  // Explicit WebSocket path
    });

    wss.on('connection', (ws, req) => {
        wsClients.add(ws);
        console.log(`WebSocket client connected from ${req.socket.remoteAddress}. Total clients: ${wsClients.size}`);

        // Send initial connection confirmation
        ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected' }));

        ws.on('close', () => {
            wsClients.delete(ws);
            console.log(`WebSocket client disconnected. Total clients: ${wsClients.size}`);
        });

        ws.on('error', (error) => {
            console.error('WebSocket client error:', error.message);
            wsClients.delete(ws);
        });
        
        // Add ping/pong for connection health monitoring
        ws.isAlive = true;
        ws.on('pong', () => {
            ws.isAlive = true;
        });
    });

    wss.on('error', (error) => {
        console.error('WebSocket server error:', error.message);
    });
    
    // Periodic ping to detect dead connections (every 30 seconds)
    const pingInterval = setInterval(() => {
        const deadClients = [];
        wsClients.forEach((ws) => {
            if (ws.isAlive === false) {
                // Connection is dead, terminate it
                deadClients.push(ws);
                ws.terminate();
                return;
            }
            
            // Mark as not alive, will be set to true on pong response
            ws.isAlive = false;
            try {
                ws.ping();
            } catch (e) {
                deadClients.push(ws);
            }
        });
        
        // Clean up dead clients
        if (deadClients.length > 0) {
            deadClients.forEach(client => wsClients.delete(client));
            console.log(`Ping/pong cleanup: removed ${deadClients.length} dead clients. Active: ${wsClients.size}`);
        }
    }, 30000);
    
    // Store interval so we can clear it on shutdown
    wss.pingInterval = pingInterval;

    console.log(`WebSocket server initialized on path /ws`);
    return wss;
}

/**
 * Starts the HTTP server (works in all modes)
 * In Passenger mode, PORT is provided by Passenger
 * In Native/Docker mode, PORT comes from .env
 */
async function startHttpServer() {
    try {
        const PORT = Number(process.env.PORT) || config.webport || 3000;
        const HOST = process.env.HOST || (config.mode === 'docker' ? '0.0.0.0' : '127.0.0.1');
        
        const server = app.listen(PORT, HOST, () => {
            console.log(`HTTP server listening on ${HOST}:${PORT}`);
        });

        // Initialize WebSocket on this server
        initializeWebSocket(server);
        
        // Log enabled modules
        const modules = [];
        if (config.clusterEnabled) modules.push('DX Clusters');
        if (config.includepotaspots) modules.push('POTA');
        if (config.includesotaspots) modules.push('SOTA');
        const moduleStr = modules.length > 0 ? `${modules.join(', ')}` : 'None';
        console.log(`Enabled modules: ${moduleStr}`);
        console.log(`Spot cache: max ${config.maxcache} spots, max age ${config.spotMaxAge} minutes`);
        
        // Initialize DX Cluster connections
        clusterManager.init();
        
        // Start periodic spot cleanup task (every 5 minutes)
        setInterval(() => {
            cleanupOldSpots();
        }, 5 * 60 * 1000);
    } catch (e) {
        console.error("Error starting HTTP server:", e);
        process.exit(99);
    }
}

// Initialize server (works for all modes)
// In Passenger mode, PORT is provided by Passenger
// In Native/Docker mode, PORT comes from .env or defaults to 3000
startHttpServer();

// -----------------------------------
// Graceful Shutdown Handler
// -----------------------------------

let isShuttingDown = false;

function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log(`\n${signal} received, starting graceful shutdown...`);
    
    // Close WebSocket connections
    if (wsClients.size > 0) {
        console.log(`Closing ${wsClients.size} WebSocket connections...`);
        wsClients.forEach(client => {
            try {
                client.close(1001, 'Server shutting down');
            } catch (e) {}
        });
    }
    
    // Stop WebSocket ping interval
    if (wss && wss.pingInterval) {
        clearInterval(wss.pingInterval);
    }
    
    // Shutdown cluster connections
    if (clusterManager) {
        clusterManager.shutdown();
    }
    
    // Close log stream
    if (logStream) {
        try {
            logStream.end();
            console.log('Log stream closed');
        } catch (e) {}
    }
    
    // Save analytics data before shutdown
    if (analytics) {
        analytics.stop();
    }
    
    console.log('Graceful shutdown complete');
    
    // Only exit if NOT in Passenger mode (Passenger manages the process lifecycle)
    if (config.mode !== 'passenger') {
        process.exit(0);
    }
}

// Register shutdown handlers (works in all modes)
// In Passenger mode, these ensure proper cleanup before Passenger restarts the process
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors (works in all modes)
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    if (!isShuttingDown) {
        gracefulShutdown('UNCAUGHT_EXCEPTION');
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

// -----------------------------------
// POTA Spot Handling
// -----------------------------------

// Initialize POTA component if configured
if (config.includepotaspots || false) {
    let potapollinterval = config.potapollinterval || 120;
    var pota = new POTASpots({ potapollinterval: potapollinterval });
    pota.run();

    pota.on('spot', async function (spot) {
        await handlespot(spot, "pota");
    });
}

// -----------------------------------
// SOTA Spot Handling
// -----------------------------------

// Initialize SOTA component if configured
if (config.includesotaspots || false) {
    let sotapollinterval = config.sotapollinterval || 120;
    var sota = new SOTASpots({ sotapollinterval: sotapollinterval });
    sota.run();

    sota.on('spot', async function (spot) {
        await handlespot(spot, "sota");
    });
}

// -----------------------------------
// RBN (Reverse Beacon Network) Spot Handling
// -----------------------------------

// Initialize RBN component if configured
if (config.rbnEnabled || false) {
    let rbnSpotTimeout = (config.rbnSpotTimeout || 5) * 60 * 1000; // Convert minutes to milliseconds
    var rbn = new RBNManager({ 
        enabled: true,
        callsign: config.rbnCallsign || 'N0CALL',
        spotTimeout: rbnSpotTimeout,
        cwRttyEnabled: config.rbnCwRttyEnabled !== false,
        ft8Enabled: config.rbnFt8Enabled === true
    });
    
    rbn.start().catch(err => {
        console.error('[RBN] Failed to start RBN module:', err);
    });

    rbn.on('spot', async function (spot) {
        await handlespot(spot, "rbn");
    });
}

// Initialize ModeClassifier
var modeClassifier = null;
if (config.modeClassifierEnabled) {
    modeClassifier = new ModeClassifier({ enabled: true });
    console.log('[ModeClassifier] Mode classification enabled');
}

// -----------------------------------
// General Spot Handling
// -----------------------------------

/**
 * Processes spots received from different sources and may add additional data points
 */
async function handlespot(spot, spot_source = "cluster") {

	try {
		//construct a clean spot
		let dxSpot = {
			spotter: spot.spotter,
			spotted: spot.spotted,
			frequency: spot.frequency,
			message: spot.message,
			when: spot.when,	
			source: spot_source,	
		}

		//do DXCC lookup (with timeout protection)
		try {
			dxSpot.dxcc_spotter = await dxcc_lookup(spot.spotter);
			dxSpot.dxcc_spotted = await dxcc_lookup(spot.spotted);
		} catch (dxccError) {
			// If DXCC lookup fails, continue with empty DXCC data
			console.warn(`DXCC lookup failed: ${dxccError.message}`);
			dxSpot.dxcc_spotter = {};
			dxSpot.dxcc_spotted = {};
		}
		
		// Apply RBN continent filtering if this is an RBN spot
		if (spot_source === "rbn" && typeof rbn !== 'undefined') {
			const shouldKeep = rbn.shouldKeepSpot(dxSpot);
			if (!shouldKeep) {
				// Filtered out - already have better spot from this continent
				return;
			}
		}
		
		//add pota specific data
		if (spot_source === "pota" && spot.additional_data) {
			dxSpot.dxcc_spotted = dxSpot.dxcc_spotted || {};
			dxSpot.dxcc_spotted["pota_ref"] = spot.additional_data.pota_ref;
			dxSpot.dxcc_spotted["pota_mode"] = spot.additional_data.pota_mode;
		}
		
		//add sota specific data
		if (spot_source === "sota" && spot.additional_data) {
			dxSpot.dxcc_spotted = dxSpot.dxcc_spotted || {};
			dxSpot.dxcc_spotted["sota_ref"] = spot.additional_data.sota_ref;
			dxSpot.dxcc_spotted["sota_mode"] = spot.additional_data.sota_mode;
		}
		
		// Apply enrichment if enabled
		if (config.enrichmentEnabled) {
			Enrichment.applyEnrichment(dxSpot, spot_source);
		}
		
		// Apply mode classification if enabled
		if (modeClassifier) {
			const classification = modeClassifier.classifySpot(dxSpot);
			dxSpot.mode = classification.mode;
			dxSpot.submode = classification.submode;
		}
		
		//lookup band
		dxSpot.band = qrg2band(dxSpot.frequency * 1000);

		// Check spot age - reject if too old
		const spotAge = Date.now() - Date.parse(dxSpot.when);
		const maxAgeMs = config.spotMaxAge * 60 * 1000; // Convert minutes to milliseconds
		if (spotAge > maxAgeMs) {
			// Spot is too old, silently ignore it
			return;
		}

		// Check for duplicate spot using O(1) index lookup
		// For RBN spots, use continent-based key to allow only one spot per continent per callsign
		let spotKey;
		if (spot_source === "rbn" && dxSpot.dxcc_spotter && dxSpot.dxcc_spotter.cont) {
			spotKey = `rbn_${dxSpot.spotted}_${dxSpot.dxcc_spotter.cont}`;
		} else {
			spotKey = `${dxSpot.frequency}_${dxSpot.spotted}_${dxSpot.spotter}`;
		}
		const existingSpot = spotKeyIndex.get(spotKey);

		if (existingSpot) {
			// Found duplicate - check if new spot is newer
			const newTimestamp = Date.parse(dxSpot.when);
			const existingTimestamp = Date.parse(existingSpot.when);

			if (newTimestamp > existingTimestamp) {
				// New spot is newer - remove old one from array
				const index = spots.indexOf(existingSpot);
				if (index !== -1) {
					spots.splice(index, 1);
				}
				removeFromIndexes(existingSpot);
			} else {
				// Old spot is newer - ignore this one
				return;
			}
		}

		//push spot to cache
		spots.push(dxSpot);

		// Update indexes (including spotKeyIndex)
		updateIndexes(dxSpot);

		// Broadcast to WebSocket clients
		if (wsClients.size > 0) {
			broadcastSpot(dxSpot);
		}

		// Empty out spots if maximum cache is reached
		// Remove the OLDEST spot by timestamp (optimized)
		if (spots.length > config.maxcache) {
			// Sort once to find oldest, then remove
			spots.sort((a, b) => Date.parse(a.when) - Date.parse(b.when));
			const oldestSpot = spots.shift(); // Remove first (oldest) element
			removeFromIndexes(oldestSpot);
		}
		
	} catch(e) { 
		console.error("Error processing spot:", e);
	} 
}

// -----------------------------------
// Index Management Functions
// -----------------------------------

/**
 * Updates all indexes when a new spot is added
 */
function updateIndexes(spot) {
    // Update band index
    if (spot.band) {
        if (!bandIndex.has(spot.band)) {
            bandIndex.set(spot.band, new Set());
        }
        bandIndex.get(spot.band).add(spot);
    }

    // Update frequency index (keep only latest spot per frequency)
    const existing = frequencyIndex.get(spot.frequency);
    if (!existing || Date.parse(spot.when) > Date.parse(existing.when)) {
        frequencyIndex.set(spot.frequency, spot);
    }

    // Update source index
    if (spot.source) {
        if (!sourceIndex.has(spot.source)) {
            sourceIndex.set(spot.source, new Set());
        }
        sourceIndex.get(spot.source).add(spot);
    }

    // Update spotKey index for O(1) duplicate detection
    // For RBN spots, use continent-based key
    let spotKey;
    if (spot.source === "rbn" && spot.dxcc_spotter && spot.dxcc_spotter.cont) {
        spotKey = `rbn_${spot.spotted}_${spot.dxcc_spotter.cont}`;
    } else {
        spotKey = `${spot.frequency}_${spot.spotted}_${spot.spotter}`;
    }
    spotKeyIndex.set(spotKey, spot);
}

/**
 * Removes a spot from all indexes
 */
function removeFromIndexes(spot) {
    if (!spot) return;

    // Remove from band index
    if (spot.band && bandIndex.has(spot.band)) {
        bandIndex.get(spot.band).delete(spot);
        if (bandIndex.get(spot.band).size === 0) {
            bandIndex.delete(spot.band);
        }
    }

    // Remove from frequency index if this is the current spot
    if (frequencyIndex.get(spot.frequency) === spot) {
        frequencyIndex.delete(spot.frequency);
    }

    // Remove from source index
    if (spot.source && sourceIndex.has(spot.source)) {
        sourceIndex.get(spot.source).delete(spot);
        if (sourceIndex.get(spot.source).size === 0) {
            sourceIndex.delete(spot.source);
        }

    }

    // Remove from spotKey index
    const spotKey = `${spot.frequency}_${spot.spotted}_${spot.spotter}`;
    spotKeyIndex.delete(spotKey);
}

/**
 * Rebuilds all indexes from scratch
 */
function rebuildIndexes() {
    bandIndex.clear();
    frequencyIndex.clear();
    sourceIndex.clear();
    spotKeyIndex.clear();

    spots.forEach(spot => updateIndexes(spot));
}

/**
 * Removes spots older than the configured maximum age
 * Called periodically to keep cache fresh
 */
function cleanupOldSpots() {
    const maxAgeMs = config.spotMaxAge * 60 * 1000; // Convert minutes to milliseconds
    const cutoffTime = Date.now() - maxAgeMs;
    const initialCount = spots.length;
    
    // Filter out old spots
    const freshSpots = spots.filter(spot => {
        const spotTime = Date.parse(spot.when);
        const isOld = spotTime < cutoffTime;
        if (isOld) {
            // Remove from indexes
            removeFromIndexes(spot);
        }
        return !isOld;
    });
    
    const removedCount = initialCount - freshSpots.length;
    if (removedCount > 0) {
        spots.length = 0;
        spots.push(...freshSpots);
        console.log(`Cleanup: removed ${removedCount} old spots (older than ${config.spotMaxAge} minutes)`);
    }
}

// -----------------------------------
// Helper Functions
// -----------------------------------

let consecutiveErrorCount = 0;
const dxccServer = config.dxcc_lookup_wavelog_url;  // The WaveLog server
let abortController = null;  // For aborting ongoing requests

// DXCC cache: Map<callsign, {data, timestamp, accessCount}>
// Using LRU (Least Recently Used) eviction strategy
const dxccCache = new Map();
const DXCC_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;  // 7 days (callsigns don't change often)
const DXCC_CACHE_MAX_SIZE = 20000;  // Increased to 20k - reduces PHP lookups dramatically
const DXCC_CLEANUP_INTERVAL = 60 * 60 * 1000;  // Cleanup every hour

// Prefix-based DXCC cache: Map<prefix, {dxcc_id, cont, entity, timestamp}>
// This dramatically increases cache hits since many calls share same prefix
// Examples: W1*, K2*, DL*, G3*, etc.
const dxccPrefixCache = new Map();
const DXCC_PREFIX_CACHE_MAX_SIZE = 5000;  // Store 5k prefixes (covers most amateur radio)
const DXCC_PREFIX_TTL = 30 * 24 * 60 * 60 * 1000;  // 30 days (prefixes change rarely)

// Pending lookup queue to batch requests and prevent duplicate concurrent lookups
const pendingDxccLookups = new Map(); // Map<callsign, Promise>

// DXCC lookup rate limiting to prevent overwhelming PHP-FPM
let dxccLookupQueue = [];
let dxccLookupInProgress = false;
const MAX_CONCURRENT_DXCC = 2; // Max 2 concurrent PHP requests
let activeDxccLookups = 0;

// Periodic cleanup of DXCC cache to remove expired entries
setInterval(() => {
    const now = Date.now();
    let removedCount = 0;
    
    // Clean callsign cache
    for (const [call, entry] of dxccCache.entries()) {
        if (now - entry.timestamp > DXCC_CACHE_TTL) {
            dxccCache.delete(call);
            removedCount++;
        }
    }
    
    // Clean prefix cache
    let prefixRemoved = 0;
    for (const [prefix, entry] of dxccPrefixCache.entries()) {
        if (now - entry.timestamp > DXCC_PREFIX_TTL) {
            dxccPrefixCache.delete(prefix);
            prefixRemoved++;
        }
    }
    
    if (removedCount > 0 || prefixRemoved > 0) {
        console.log(`[DXCC Cache] Cleaned up ${removedCount} callsigns, ${prefixRemoved} prefixes. Cache: ${dxccCache.size} calls, ${dxccPrefixCache.size} prefixes`);
    }
}, DXCC_CLEANUP_INTERVAL);

/**
 * Normalizes callsign for cache lookup
 * Strips portable/mobile suffixes to maximize cache hits
 * Examples: W1ABC/P -> W1ABC, K2XYZ/M -> K2XYZ
 */
function normalizeCallsign(call) {
    if (!call) return '';
    
    // Remove common suffixes that don't change DXCC
    const normalized = call
        .toUpperCase()
        .replace(/\/P$/i, '')      // Portable
        .replace(/\/M$/i, '')      // Mobile
        .replace(/\/MM$/i, '')     // Maritime Mobile
        .replace(/\/AM$/i, '')     // Aeronautical Mobile
        .replace(/\/QRP$/i, '')    // QRP
        .replace(/\/[0-9]$/i, '')  // District number at end
        .trim();
    
    return normalized;
}

/**
 * Extracts DXCC prefix from callsign
 * Examples: W1ABC -> W1, K2XYZ -> K2, DL3ABC -> DL3, G3XYZ -> G3
 * Handles special cases like 2E0, 9A, etc.
 */
function extractPrefix(call) {
    if (!call) return null;
    
    const normalized = normalizeCallsign(call);
    
    // Handle special prefixes with numbers in middle (e.g., 2E0, 4U1)
    const specialMatch = normalized.match(/^([0-9][A-Z][0-9])/);
    if (specialMatch) {
        return specialMatch[1];
    }
    
    // Handle two-letter + number prefix (most common: W1, K2, DL3, G3, etc.)
    const twoLetterMatch = normalized.match(/^([A-Z]{1,2}[0-9])/);
    if (twoLetterMatch) {
        return twoLetterMatch[1];
    }
    
    // Handle single letter + number (rare but exists: B1, C6, etc.)
    const singleLetterMatch = normalized.match(/^([A-Z][0-9])/);
    if (singleLetterMatch) {
        return singleLetterMatch[1];
    }
    
    // Handle three-letter prefix (e.g., VE3, ZL3, etc.)
    const threeLetterMatch = normalized.match(/^([A-Z]{2,3}[0-9])/);
    if (threeLetterMatch) {
        return threeLetterMatch[1];
    }
    
    return null;
}

/**
 * Checks if cached DXCC data is valid for this prefix
 * Returns cached data if prefix matches, null otherwise
 */
function checkPrefixCache(call) {
    const prefix = extractPrefix(call);
    if (!prefix) return null;
    
    const cached = dxccPrefixCache.get(prefix);
    if (!cached) return null;
    
    // Check if expired
    const age = Date.now() - cached.timestamp;
    if (age > DXCC_PREFIX_TTL) {
        dxccPrefixCache.delete(prefix);
        return null;
    }
    
    // Return full DXCC data structure
    return {
        cont: cached.cont,
        entity: cached.entity,
        flag: cached.flag,
        dxcc_id: cached.dxcc_id,
        lotw_user: cached.lotw_user || false,  // Prefix can't determine LoTW status
        lat: cached.lat,
        lng: cached.lng,
        cqz: cached.cqz,
        fromPrefix: true  // Mark that this came from prefix cache
    };
}

/**
 * Updates prefix cache with DXCC data from a lookup
 */
function updatePrefixCache(call, dxccData) {
    const prefix = extractPrefix(call);
    if (!prefix || !dxccData || !dxccData.dxcc_id) return;
    
    // Check if we need to evict old entries
    if (dxccPrefixCache.size >= DXCC_PREFIX_CACHE_MAX_SIZE) {
        // Remove first (oldest) entry
        const firstKey = dxccPrefixCache.keys().next().value;
        dxccPrefixCache.delete(firstKey);
    }
    
    // Store essential DXCC info for this prefix
    dxccPrefixCache.set(prefix, {
        dxcc_id: dxccData.dxcc_id,
        cont: dxccData.cont,
        entity: dxccData.entity,
        flag: dxccData.flag,
        lat: dxccData.lat,
        lng: dxccData.lng,
        cqz: dxccData.cqz,
        timestamp: Date.now()
    });
}

async function dxcc_lookup(call) {
    if (!call) return {};
    
    // Normalize callsign to maximize cache hits
    const normalizedCall = normalizeCallsign(call);
    
    // 1. Check full callsign cache first (most accurate)
    const cached = dxccCache.get(normalizedCall);
    if (cached) {
        const age = Date.now() - cached.timestamp;
        if (age < DXCC_CACHE_TTL) {
            // Move to end of Map (LRU) by deleting and re-adding
            dxccCache.delete(normalizedCall);
            cached.accessCount = (cached.accessCount || 0) + 1;
            cached.timestamp = Date.now(); // Refresh timestamp on access
            dxccCache.set(normalizedCall, cached);
            return cached.data;
        } else {
            // Expired, remove from cache
            dxccCache.delete(normalizedCall);
        }
    }
    
    // 2. Check prefix cache (fast fallback - covers most cases)
    const prefixData = checkPrefixCache(normalizedCall);
    if (prefixData) {
        // Cache the full callsign with prefix data for even faster future lookups
        dxccCache.set(normalizedCall, {
            data: prefixData,
            timestamp: Date.now(),
            accessCount: 1,
            fromPrefix: true
        });
        return prefixData;
    }
    
    // 3. Check if lookup is already in progress for this callsign
    if (pendingDxccLookups.has(normalizedCall)) {
        // Return the existing promise to avoid duplicate lookups
        return pendingDxccLookups.get(normalizedCall);
    }
    
    // 4. Perform actual lookup via PHP
    const lookupPromise = performDxccLookup(normalizedCall);
    pendingDxccLookups.set(normalizedCall, lookupPromise);
    
    try {
        const result = await lookupPromise;
        
        // Update prefix cache with this result for future calls with same prefix
        if (result && result.dxcc_id) {
            updatePrefixCache(normalizedCall, result);
        }
        
        return result;
    } finally {
        // Remove from pending after completion (success or failure)
        pendingDxccLookups.delete(normalizedCall);
    }
}

async function performDxccLookup(call) {
    // Wait if too many concurrent lookups
    while (activeDxccLookups >= MAX_CONCURRENT_DXCC) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    activeDxccLookups++;
    let timeoutId = null;

    try {
        // Initialize the abort controller for the request
        abortController = new AbortController();
        timeoutId = setTimeout(() => {
            if (abortController) {
                abortController.abort();
            }
        }, 5000);  // Set timeout for 5 seconds

        const payload = {
            key: config.dxcc_lookup_wavelog_key,
            callsign: call
        };

        // Make the fetch request to the DXCC lookup server
        const response = await fetch(dxccServer, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: abortController.signal // Use the abort controller's signal
        });

        clearTimeout(timeoutId);  // Clear the timeout if the request succeeds

        if (!response.ok) {
            throw new Error(`DXCC lookup failed with status: ${response.status}`);
        }

        const result = await response.json();
        const returner = {
            cont: result.cont,
            entity: result.dxcc ? toUcWord(result.dxcc) : '',
            flag: result.dxcc_flag,
            dxcc_id: result.dxcc_id,
            lotw_user: result.lotw_member,
            lat: result.dxcc_lat || null,
            lng: result.dxcc_long || null,
	    cqz: result.dxcc_cqz || null,
        };

        // Cache the result with LRU eviction
        if (dxccCache.size >= DXCC_CACHE_MAX_SIZE) {
            // Remove least recently used entries (first 100 entries)
            let removed = 0;
            for (const key of dxccCache.keys()) {
                if (removed >= 100) break;
                dxccCache.delete(key);
                removed++;
            }
        }
        dxccCache.set(call, {
            data: returner,
            timestamp: Date.now(),
            accessCount: 1
        });

        consecutiveErrorCount = 0;  // Reset error count after a successful lookup
        abortController = null;  // Clear the abort controller after success
        activeDxccLookups--;  // Release concurrency slot
        return returner;

    } catch (error) {
        clearTimeout(timeoutId);  // Ensure the timeout is cleared on failure
        abortController = null;  // Clear the abort controller after failure
        activeDxccLookups--;  // Release concurrency slot
        consecutiveErrorCount++;  // Increment error count on failure

        // Log the error with server info on first failure, then only log every 10th error
        if (consecutiveErrorCount === 1) {
            console.error(`DXCC lookup failed for callsign: ${call}`);
            console.error(`Served by WaveLog server: ${dxccServer}`);
        } else if (consecutiveErrorCount % 10 === 0) {
            console.error(`DXCC lookup failed: ${consecutiveErrorCount} consecutive errors`);
        }
        
        // Cache failed lookups for 5 minutes to avoid hammering on bad callsigns
        dxccCache.set(call, {
            data: {},
            timestamp: Date.now(),
            accessCount: 1,
            failed: true
        });
        
        // Return empty object on error to prevent undefined access
        return {};
    }
}
// ================================================================
// Export for Phusion Passenger
// ================================================================
// When running under Passenger, export the Express app
// Passenger will handle the HTTP server
module.exports = app;
