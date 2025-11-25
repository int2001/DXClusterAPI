"use strict";

// ================================================================
// Module Imports
// ================================================================
const POTASpots = require('./modules/pota');
const SOTASpots = require('./modules/sota');
const RBNManager = require('./modules/rbn');
const ModeClassifier = require('./modules/modeclassifier');
const Enrichment = require('./modules/enrichment');
const Persistence = require('./modules/persistence');
const Analytics = require('./modules/analytics');
const Clusters = require('./modules/clusters');
const APIv1 = require('./modules/apiv1');
const APIv2 = require('./modules/apiv2');
const Metrics = require('./modules/metrics');
const RateLimiter = require('./modules/rate-limiter');
const { toUcWord, qrg2band, getFreshestSpot, getOldestSpot, normalizeFrequency } = require('./lib/utils');
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

// Statistics indexes (for O(1) /stats endpoint)
const modeTypeStats = { phone: 0, digi: 0, cw: 0, unknown: 0 };
const continentStats = {};  // DX continent breakdown
const continentDeStats = {};  // DE (spotter) continent breakdown
let rbnSpotCount = 0;  // Track RBN spots for early exit in cleanup

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
        maxConcurrentDxcc: parseInt(process.env.MAX_CONCURRENT_DXCC) || 2, // PHP worker limit
        
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
        apiSpotLimit: parseInt(process.env.API_SPOT_LIMIT) || 200,
        
        // WebSocket configuration
        websocketEnabled: process.env.WEBSOCKET_ENABLED !== 'false',
        
        // Live page configuration
        livePageEnabled: process.env.LIVE_PAGE_ENABLED !== 'false',
        livePagePassword: process.env.LIVE_PAGE_PASSWORD || '',
        
        // Logging configuration
        fileLoggingEnabled: process.env.FILE_LOGGING_ENABLED !== 'false',
        logRetentionDays: parseInt(process.env.LOG_RETENTION_DAYS) || 3,
        
        // Persistence configuration
        persistenceEnabled: process.env.PERSISTENCE_ENABLED !== 'false',
        persistenceInterval: parseInt(process.env.PERSISTENCE_INTERVAL) || 60,
        persistencePath: process.env.PERSISTENCE_PATH || path.join(__dirname, 'data', 'spots-cache.json'),
        
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
        config.livePageEnabled = config.livePageEnabled !== false;
        config.livePagePassword = config.livePagePassword || '';
        config.fileLoggingEnabled = config.fileLoggingEnabled !== false;
        config.logRetentionDays = config.logRetentionDays || 3;
        config.spotMaxAge = config.spotMaxAge || 120;
        config.maxConcurrentDxcc = config.maxConcurrentDxcc || 2;
        config.persistenceEnabled = config.persistenceEnabled !== false;
        config.persistenceInterval = config.persistenceInterval || 60;
        config.persistencePath = config.persistencePath || path.join(__dirname, 'data', 'spots-cache.json');
        config.trustProxy = config.trustProxy !== false;  // Default true
    } catch (e) {
        console.error('[Core] No .env file or config.js found! Please create one based on .env.sample');
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
        console.error('[Core] Configuration errors:');
        errors.forEach(err => console.error(`[Core]   ❌ ${err}`));
        console.error('[Core] \nPlease fix the errors above and restart the application.');
        process.exit(1);
    }
    
    if (warnings.length > 0) {
        console.warn('[Core] Configuration warnings:');
        warnings.forEach(warn => console.warn(`[Core]   ⚠️  ${warn}`));
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

    console.log('');
    console.log('[Core] ════════════════════════════════════════════════════════════');
    console.log('[Core] 🚀 DXClusterAPI Starting');
    console.log('[Core] ════════════════════════════════════════════════════════════');
    console.log('[Core] 📋 PID:', process.pid);
    console.log('[Core] 🟢 Node.js:', process.versions.node);
    console.log('[Core] ⚙️  Mode:', config.mode);
    console.log('[Core] 📝 Log file:', LOG_FILE);
    console.log('[Core] ════════════════════════════════════════════════════════════');
    console.log('');
} else {
    console.log('');
    console.log('[Core] ════════════════════════════════════════════════════════════');
    console.log('[Core] 🚀 DXClusterAPI Starting');
    console.log('[Core] ════════════════════════════════════════════════════════════');
    console.log('[Core] 📋 PID:', process.pid);
    console.log('[Core] 🟢 Node.js:', process.versions.node);
    console.log('[Core] ⚙️  Mode:', config.mode);
    console.log('[Core] ════════════════════════════════════════════════════════════');
    console.log('');
}

/**
 * Helper function to log messages to file and console
 * @param {string} message - Message to log
 * @param {string} level - Log level (INFO, WARN, ERROR)
 */
function logToFile(message, level = 'INFO') {
    console.log('[Core] ' + message);
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
    console.log('[Core] Trust proxy enabled - X-Forwarded-For headers will be respected');
}

// Add API version header to all responses
app.use((req, res, next) => {
    res.setHeader('X-API-Version', APP_VERSION);
    next();
});

// Skip logging for high-frequency endpoints to reduce noise
morgan.token('skip-logging', (req, res) => {
    return (req.url.startsWith(config.baseUrl + '/spots') || 
            req.url.startsWith(config.baseUrl + '/health') ||
            req.url.startsWith(config.baseUrl + '/logs')) ? 'skip' : null;
});

if (morganStream) {
    app.use(morgan(':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms', { 
        stream: morganStream,
        skip: (req, res) => req.url.startsWith(config.baseUrl + '/spots') || 
                           req.url.startsWith(config.baseUrl + '/health') ||
                           req.url.startsWith(config.baseUrl + '/logs')
    }));
}
app.use(morgan(':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms', {
    skip: (req, res) => req.url.startsWith(config.baseUrl + '/spots') || 
                       req.url.startsWith(config.baseUrl + '/health') ||
                       req.url.startsWith(config.baseUrl + '/logs')
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
    skipPaths: ['/health', '/info', '/analytics']
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
    app.use(apiv1.createRouter(rateLimiter.getDataLimiter(), responseCacheMiddleware(55 * 1000)));
    console.log('[Core] API v1 endpoints enabled with rate limiting and 55-second response cache');
} else {
    console.log('[Core] API v1 endpoints disabled');
}

// ================================================================
// API v2 Module
// ================================================================
const apiv2 = new APIv2({
    enabled: config.apiv2Enabled,
    apiKey: config.apiv2Key,
    version: APP_VERSION,
    getSpotsData: () => spots,
    apiSpotLimit: config.apiSpotLimit
});

// Mount API v2 router if enabled
if (config.apiv2Enabled) {
    app.use(config.baseUrl + '/api/v2', apiv2.createRouter(rateLimiter.getDataLimiter(), responseCacheMiddleware(55 * 1000)));
    console.log('[Core] API v2 enabled at ' + config.baseUrl + '/api/v2' + (apiv2.getStatus().requiresAuth ? ' (authentication required)' : ' (no authentication)') + ' with rate limiting and 55-second response cache');
} else {
    console.log('[Core] API v2 disabled');
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
    
    // Only include live page endpoint if enabled
    if (config.livePageEnabled) {
        endpoints.live = config.baseUrl + '/live';
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

// Serve live page - only if enabled
if (config.livePageEnabled) {
    const livePagePath = path.join(__dirname, 'views', 'live', 'index.html');
    
    // Live page route with authentication
    app.get(config.baseUrl + '/live', (req, res) => {
        // HTTP Basic Authentication (if password is set)
        if (config.livePagePassword) {
            const authHeader = req.headers.authorization;
            
            if (!authHeader || !authHeader.startsWith('Basic ')) {
                res.setHeader('WWW-Authenticate', 'Basic realm="DXClusterAPI Live Monitor"');
                return res.status(401).send('Authentication required');
            }
            
            // Decode Basic Auth credentials
            const base64Credentials = authHeader.split(' ')[1];
            const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
            const [username, password] = credentials.split(':');
            
            // Verify password (username is ignored)
            if (password !== config.livePagePassword) {
                res.setHeader('WWW-Authenticate', 'Basic realm="DXClusterAPI Live Monitor"');
                return res.status(401).send('Invalid password');
            }
        }
        
        // Set no-cache and no-index headers
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
        
        // Send the HTML file
        res.sendFile(livePagePath);
    });
    
    console.log('[Core] Live page enabled at ' + config.baseUrl + '/live' + 
                (config.livePagePassword ? ' (password protected)' : ''));
} else {
    console.log('[Core] Live page disabled');
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

    // Single-pass cleanup: remove dead clients immediately
    let deadCount = 0;
    for (const client of wsClients) {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
            } catch (error) {
                console.error('[Core] Error sending to WebSocket client:', error);
                wsClients.delete(client);
                deadCount++;
            }
        } else if (client.readyState === WebSocket.CLOSED || client.readyState === WebSocket.CLOSING) {
            // Remove dead client immediately
            wsClients.delete(client);
            deadCount++;
        }
    }
    
    // Log cleanup if any dead clients were found
    if (deadCount > 0) {
        console.log(`[Core] Cleaned up ${deadCount} dead WebSocket clients. Active: ${wsClients.size}`);
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
    // Build source breakdown from sourceIndex (already O(1))
    const sources = {};
    sourceIndex.forEach((spotSet, sourceName) => {
        sources[sourceName] = spotSet.size;
    });
    
    // Get mode types and continents from indexes (O(1) - no iteration!)
    // These are updated in real-time as spots are added/removed
    
    // Legacy counts (for backward compatibility) - use sourceIndex instead of filter
    const potaCount = sourceIndex.get('pota')?.size || 0;
    const sotaCount = sourceIndex.get('sota')?.size || 0;
    const clusterSpots = spots.length - potaCount - sotaCount;
    
    const stats = {
        entries: spots.length,
        cluster: clusterSpots,
        pota: potaCount,
        sota: sotaCount,
        sources: sources,  // Per-source breakdown
        modeTypes: modeTypeStats,  // Mode type breakdown (phone/digi/cw) - from index
        continents: continentStats,  // DX continent breakdown - from index
        continents_de: continentDeStats,  // DE (spotter) continent breakdown - from index
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
            responseCache: responseCache.size,
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
            livePage: {
                enabled: config.livePageEnabled,
                passwordProtected: config.livePagePassword && config.livePagePassword.length > 0
            },
            metrics: metrics.getStatus(),
            rateLimiter: rateLimiter.getStatus(),
            persistence: config.persistenceEnabled ? {
                enabled: true,
                stats: persistenceController ? persistenceController.getStats() : null
            } : false,
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
        console.error('[Core] Error generating metrics:', error);
        res.status(500).json({ error: 'Failed to generate metrics' });
    }
});

/**
 * GET /logs - Retrieve recent log entries (last 1000 lines)
 * Only available when file logging is enabled
 */
app.get(config.baseUrl + '/logs', (req, res) => {
    if (!config.fileLoggingEnabled) {
        return res.status(503).json({ error: 'File logging is not enabled' });
    }
    
    try {
        const today = new Date();
        const fmtDate = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${y}${m}${dd}`;
        };
        
        const logFile = path.join(LOG_DIR, `app-${fmtDate(today)}.log`);
        
        if (!fs.existsSync(logFile)) {
            return res.json({ logs: [], message: 'No log file found for today' });
        }
        
        // Read log file and get last 1000 lines
        const logContent = fs.readFileSync(logFile, 'utf8');
        const lines = logContent.split('\n').filter(line => line.trim());
        const recentLines = lines.slice(-1000);
        
        res.json({
            logs: recentLines,
            total: lines.length,
            showing: recentLines.length,
            file: path.basename(logFile)
        });
    } catch (error) {
        console.error('[Core] Error reading log file:', error);
        res.status(500).json({ error: 'Failed to read log file' });
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
        console.log('[Core] WebSocket disabled in configuration');
        return null;
    }

    wss = new WebSocket.Server({ 
        server,
        path: '/ws'  // Explicit WebSocket path
    });

    wss.on('connection', (ws, req) => {
        wsClients.add(ws);
        console.log(`[Core] WebSocket client connected from ${req.socket.remoteAddress}. Total clients: ${wsClients.size}`);

        // Send initial connection confirmation
        ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected' }));

        ws.on('close', () => {
            wsClients.delete(ws);
            console.log(`[Core] WebSocket client disconnected. Total clients: ${wsClients.size}`);
        });

        ws.on('error', (error) => {
            console.error('[Core] WebSocket client error:', error.message);
            wsClients.delete(ws);
        });
        
        // Add ping/pong for connection health monitoring
        ws.isAlive = true;
        ws.on('pong', () => {
            ws.isAlive = true;
        });
    });

    wss.on('error', (error) => {
        console.error('[Core] WebSocket server error:', error.message);
    });
    
    // Periodic ping to detect dead connections (every 30 seconds)
    const pingInterval = setInterval(() => {
        let deadCount = 0;
        
        // Single-pass cleanup: terminate and remove dead clients immediately
        for (const ws of wsClients) {
            if (ws.isAlive === false) {
                // Connection is dead, terminate and remove it
                ws.terminate();
                wsClients.delete(ws);
                deadCount++;
                continue;
            }
            
            // Mark as not alive, will be set to true on pong response
            ws.isAlive = false;
            try {
                ws.ping();
            } catch (e) {
                wsClients.delete(ws);
                deadCount++;
            }
        }
        
        // Log cleanup if any dead clients were found
        if (deadCount > 0) {
            console.log(`[Core] Ping/pong cleanup: removed ${deadCount} dead clients. Active: ${wsClients.size}`);
        }
    }, 30000);
    
    // Store interval so we can clear it on shutdown
    wss.pingInterval = pingInterval;

    console.log(`[Core] WebSocket server initialized on path /ws`);
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
            console.log(`[Core] HTTP server listening on ${HOST}:${PORT}`);
        });

        // Initialize WebSocket on this server
        initializeWebSocket(server);
        
        // Log enabled modules
        const modules = [];
        if (config.clusterEnabled) modules.push('DX Clusters');
        if (config.includepotaspots) modules.push('POTA');
        if (config.includesotaspots) modules.push('SOTA');
        const moduleStr = modules.length > 0 ? `${modules.join(', ')}` : 'None';
        console.log(`[Core] Enabled modules: ${moduleStr}`);
        console.log(`[Core] Spot cache: max ${config.maxcache} spots, max age ${config.spotMaxAge} minutes`);
        
        // Initialize DX Cluster connections
        clusterManager.init();
        
        // Start periodic spot cleanup task (every 5 minutes)
        setInterval(() => {
            cleanupOldSpots();
        }, 5 * 60 * 1000);
    } catch (e) {
        console.error("[Core] Error starting HTTP server:", e);
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
    
    console.log(`[Core] \n${signal} received, starting graceful shutdown...`);
    
    // Close WebSocket connections
    if (wsClients.size > 0) {
        console.log(`[Core] Closing ${wsClients.size} WebSocket connections...`);
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
            console.log('[Core] Log stream closed');
        } catch (e) {}
    }
    
    // Save analytics data before shutdown
    if (analytics) {
        analytics.stop();
    }
    
    console.log('[Core] Graceful shutdown complete');
    
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
    console.error('[Core] Uncaught Exception:', error);
    if (!isShuttingDown) {
        gracefulShutdown('UNCAUGHT_EXCEPTION');
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Core] Unhandled Promise Rejection at:', promise, 'reason:', reason);
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
// Helper Functions for Spot Management
// -----------------------------------

/**
 * Binary search to find insertion point for a spot to maintain sorted order by timestamp
 * @param {Array} arr - Array of spots sorted by timestamp (oldest first)
 * @param {Object} spot - Spot to insert
 * @returns {number} - Index where spot should be inserted
 */
function findInsertionIndex(arr, spot) {
    const spotTime = Date.parse(spot.when);
    let left = 0;
    let right = arr.length;
    
    while (left < right) {
        const mid = Math.floor((left + right) / 2);
        const midTime = Date.parse(arr[mid].when);
        
        if (midTime < spotTime) {
            left = mid + 1;
        } else {
            right = mid;
        }
    }
    
    return left;
}

// -----------------------------------
// General Spot Handling
// -----------------------------------

/**
 * Generates a consistent spotKey for deduplication
 * @param {Object} spot - The spot object
 * @returns {string} - The spotKey for indexing
 */
function generateSpotKey(spot) {
    // For all spots: deduplicate by spotted callsign + DX continent
    // This keeps only the most recent spot per callsign per continent
    if (spot.dxcc_spotted && spot.dxcc_spotted.cont) {
        return `${spot.spotted}_${spot.dxcc_spotted.cont}`;
    } else {
        // Fallback for spots without DXCC data
        return `${spot.frequency}_${spot.spotted}_${spot.spotter}`;
    }
}

/**
 * Strips RBN/cluster suffixes from spotter callsigns
 * Removes -#, -15, -0-9 etc. to normalize callsigns
 * @param {string} callsign - The callsign to normalize
 * @returns {string} - Normalized callsign
 */
function normalizeSpotterCallsign(callsign) {
    if (!callsign) return callsign;
    // Remove dash followed by numbers, # or other suffixes
    return callsign.replace(/[-\/]([0-9]+|#)$/i, '');
}

/**
 * Sanitizes a value to ensure JSON serializability
 * Replaces NaN, Infinity, -Infinity with null
 * @param {*} value - Value to sanitize
 * @returns {*} - Sanitized value
 */
function sanitizeForJSON(value) {
    if (typeof value === 'number') {
        if (!isFinite(value)) {
            return null; // Replace NaN, Infinity, -Infinity with null
        }
    }
    return value;
}

/**
 * Ensures DXCC object has consistent structure
 * @param {object} dxccObj - DXCC object to normalize
 * @returns {object} - Normalized DXCC object
 */
function normalizeDXCCObject(dxccObj) {
    if (!dxccObj || typeof dxccObj !== 'object') {
        return {
            cont: '',
            entity: '',
            flag: '',
            dxcc_id: '',
            lotw_user: false,
            lat: null,
            lng: null,
            cqz: null
        };
    }
    
    // Ensure all expected fields exist with proper defaults
    return {
        cont: dxccObj.cont || '',
        entity: dxccObj.entity || '',
        flag: dxccObj.flag || '',
        dxcc_id: dxccObj.dxcc_id || '',
        lotw_user: Boolean(dxccObj.lotw_user),
        lat: sanitizeForJSON(dxccObj.lat),
        lng: sanitizeForJSON(dxccObj.lng),
        cqz: sanitizeForJSON(dxccObj.cqz),
        // Preserve enrichment fields if present
        ...(dxccObj.sota_ref !== undefined && { sota_ref: dxccObj.sota_ref || '' }),
        ...(dxccObj.pota_ref !== undefined && { pota_ref: dxccObj.pota_ref || '' }),
        ...(dxccObj.iota_ref !== undefined && { iota_ref: dxccObj.iota_ref || '' }),
        ...(dxccObj.wwff_ref !== undefined && { wwff_ref: dxccObj.wwff_ref || '' }),
        ...(dxccObj.isContest !== undefined && { isContest: Boolean(dxccObj.isContest) }),
        ...(dxccObj.contestName && { contestName: dxccObj.contestName }),
        ...(dxccObj.pota_mode && { pota_mode: dxccObj.pota_mode }),
        ...(dxccObj.sota_mode && { sota_mode: dxccObj.sota_mode })
    };
}

/**
 * Validates and sanitizes a spot object for JSON serialization
 * Ensures all numeric values are finite, DXCC objects are consistent,
 * and the spot can be safely serialized to JSON
 * @param {object} spot - Spot to validate
 * @returns {object|null} - Sanitized spot or null if invalid
 */
function validateAndSanitizeSpot(spot) {
    if (!spot || typeof spot !== 'object') {
        console.warn('[JSON Validation] Spot is not an object');
        return null;
    }
    
    // Critical fields validation
    if (!spot.spotted || !spot.spotter || !spot.frequency) {
        console.warn(`[JSON Validation] Missing critical fields - spotted: ${spot.spotted}, spotter: ${spot.spotter}, frequency: ${spot.frequency}`);
        return null;
    }
    
    // Validate frequency is finite
    const freq = sanitizeForJSON(spot.frequency);
    if (freq === null) {
        console.warn(`[JSON Validation] Invalid frequency (NaN/Infinity) for ${spot.spotted}: ${spot.frequency}`);
        return null;
    }
    
    // Normalize DXCC objects to ensure consistent structure
    const normalizedSpot = {
        spotter: String(spot.spotter),
        spotted: String(spot.spotted),
        frequency: freq,
        message: String(spot.message || ''),
        when: spot.when,
        source: String(spot.source || ''),
        band: String(spot.band || ''),
        mode: spot.mode || null,
        submode: spot.submode || null,
        dxcc_spotter: normalizeDXCCObject(spot.dxcc_spotter),
        dxcc_spotted: normalizeDXCCObject(spot.dxcc_spotted)
    };
    
    // Preserve _sourceData if present (internal use only, stripped in API responses)
    if (spot._sourceData) {
        normalizedSpot._sourceData = spot._sourceData;
    }
    
    // Final JSON serializability test
    try {
        JSON.stringify(normalizedSpot);
        return normalizedSpot;
    } catch (error) {
        console.error(`[JSON Validation] Spot failed JSON serialization test: ${error.message}`);
        console.error(`[JSON Validation] Problematic spot: spotter=${spot.spotter}, spotted=${spot.spotted}, frequency=${spot.frequency}`);
        return null;
    }
}

/**
 * Processes spots received from different sources and may add additional data points
 */
async function handlespot(spot, spot_source = "cluster") {

	try {
		// ====================================================================
		// CRITICAL VALIDATION: Reject spots missing essential fields
		// ====================================================================
		if (!spot.spotted || !spot.spotter || !spot.frequency) {
			console.warn(`[Spot Validation] Rejected spot missing critical fields - spotted: ${spot.spotted}, spotter: ${spot.spotter}, frequency: ${spot.frequency}, source: ${spot_source}`);
			return;
		}
		
		// Normalize spotter callsign - strip RBN/cluster suffixes like -#, -15, etc.
		// This simplifies deduplication and improves cache hit rates
		spot.spotter = normalizeSpotterCallsign(spot.spotter);
		
		// Normalize frequency for consistency (based on Wavelog PR #2514)
		// All frequencies should be in kHz with 1 decimal place
		const normalizedFreq = normalizeFrequency(spot.frequency);
		if (isNaN(normalizedFreq)) {
			console.warn(`[Core] Invalid frequency for spot from ${spot.spotter}: ${spot.frequency}`);
			return;
		}
		
		// Store original source data for GUI debugging/display
		const sourceData = {
			source_type: spot_source,
			timestamp: new Date().toISOString(),
			raw: null
		};
		
		// Capture source-specific raw data before processing
		// Check for POTA/SOTA first (they have additional_data), otherwise treat as cluster/RBN
		if (spot_source === 'pota' && spot.additional_data) {
			// For POTA, store the API response data
			sourceData.raw = {
				spotter: spot.spotter,
				activator: spot.spotted,
				frequency: spot.frequency,
				mode: spot.additional_data.pota_mode,
				reference: spot.additional_data.pota_ref,
				message: spot.message
			};
		} else if (spot_source === 'sota' && spot.additional_data) {
			// For SOTA, store the API response data
			sourceData.raw = {
				spotter: spot.spotter,
				activator: spot.spotted,
				frequency: spot.frequency,
				mode: spot.additional_data.sota_mode,
				reference: spot.additional_data.sota_ref,
				message: spot.message
			};
		} else {
			// For all DX clusters (rbn, dxfun, ha-cluster, or any custom cluster), store the original spot data
			sourceData.raw = {
				spotter: spot.spotter,
				spotted: spot.spotted,
				frequency: spot.frequency,
				message: spot.message,
				when: spot.when,
				source: spot.source || spot_source
			};
		}
		
		//construct a clean spot
		let dxSpot = {
			spotter: spot.spotter,
			spotted: spot.spotted,
			frequency: normalizedFreq,  // Use normalized frequency
			message: spot.message,
			when: spot.when,	
			source: spot_source,
			_sourceData: sourceData  // Attach source data for GUI display
		}

		//do DXCC lookup (with timeout protection)
		try {
			dxSpot.dxcc_spotter = await dxcc_lookup(spot.spotter);
			dxSpot.dxcc_spotted = await dxcc_lookup(spot.spotted);
		} catch (dxccError) {
			// If DXCC lookup fails, continue with empty DXCC data
			console.warn(`[Core] DXCC lookup failed: ${dxccError.message}`);
			dxSpot.dxcc_spotter = {};
			dxSpot.dxcc_spotted = {};
		}
		
		// ====================================================================
		// DXCC VALIDATION: Reject spots that failed DXCC lookup
		// Empty DXCC data means the callsign couldn't be resolved (invalid, timeout, etc.)
		// We don't want spots without country/continent information in the system
		// ====================================================================
		const hasValidSpotter = dxSpot.dxcc_spotter && Object.keys(dxSpot.dxcc_spotter).length > 0;
		const hasValidSpotted = dxSpot.dxcc_spotted && Object.keys(dxSpot.dxcc_spotted).length > 0;
		
		if (!hasValidSpotter || !hasValidSpotted) {
			console.warn(`[DXCC Validation] Rejected spot with failed DXCC lookup - spotted: ${spot.spotted} (valid: ${hasValidSpotted}), spotter: ${spot.spotter} (valid: ${hasValidSpotter}), source: ${spot_source}`);
			return;
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
		// This is the single source of truth for mode/submode (Wavelog PR #2514)
		// Mode classification must happen AFTER enrichment so it can use
		// program-specific modes (POTA/SOTA) which are highest priority
		if (modeClassifier) {
			const classification = modeClassifier.classifySpot(dxSpot);
			dxSpot.mode = classification.mode;
			dxSpot.submode = classification.submode;
			// Optional: store confidence for debugging
			// dxSpot.modeConfidence = classification.confidence;
		} else {
			// Fallback if mode classifier is disabled
			dxSpot.mode = null;
			dxSpot.submode = null;
		}
		
		//lookup band
		dxSpot.band = qrg2band(dxSpot.frequency * 1000);

		// ====================================================================
		// JSON VALIDATION: Sanitize spot before adding to cache
		// ====================================================================
		const sanitizedSpot = validateAndSanitizeSpot(dxSpot);
		if (!sanitizedSpot) {
			console.warn(`[JSON Validation] Rejected invalid spot from ${spot_source}: ${spot.spotted} by ${spot.spotter}`);
			return;
		}
		// Replace dxSpot with sanitized version
		dxSpot = sanitizedSpot;

		// Check spot age - reject if too old
		// RBN spots use shorter timeout from RBN_SPOT_TIMEOUT
		// Regular spots use SPOT_MAX_AGE
		const spotAge = Date.now() - Date.parse(dxSpot.when);
		let maxAgeMs;
		
		if (spot_source === "rbn") {
			// RBN spots use the RBN-specific timeout
			maxAgeMs = config.rbnSpotTimeout * 60 * 1000; // Convert minutes to milliseconds
		} else {
			// Regular spots (cluster, POTA, SOTA) use the general timeout
			maxAgeMs = config.spotMaxAge * 60 * 1000; // Convert minutes to milliseconds
		}
		
		if (spotAge > maxAgeMs) {
			// Spot is too old, silently ignore it
			return;
		}

		// Check for duplicate spot using O(1) index lookup
		// Uses helper function for consistent key generation
		const spotKey = generateSpotKey(dxSpot);
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

		// Insert spot in sorted position (by timestamp) using binary search
		// This maintains the array sorted at all times, making eviction O(1)
		const insertIndex = findInsertionIndex(spots, dxSpot);
		spots.splice(insertIndex, 0, dxSpot);

		// Update indexes (including spotKeyIndex)
		updateIndexes(dxSpot);

		// Broadcast to WebSocket clients
		if (wsClients.size > 0) {
			broadcastSpot(dxSpot);
		}

		// Empty out spots if maximum cache is reached
		// Two-phase eviction: 1) Remove expired RBN spots, 2) LRU eviction if still needed
		if (spots.length >= config.maxcache) {
			// Phase 1: Remove expired RBN spots (they're stale after 5 minutes)
            const expiredCount = cleanupExpiredRBN();
            if (expiredCount > 0) {
                console.log(`[Core] Cache full: removed ${expiredCount} expired RBN spots, now ${spots.length} spots`);
            }			// Phase 2: If still full after RBN cleanup, do LRU eviction
			if (spots.length >= config.maxcache) {
				const batchSize = Math.max(Math.floor(config.maxcache * 0.1), 10); // Remove at least 10 spots
				
				// Atomic removal: slice creates new array without oldest spots
				// This prevents race conditions during API reads
				const removedSpots = spots.slice(0, batchSize);
				spots = spots.slice(batchSize);
				
				// Clean up indexes
				removedSpots.forEach(spot => removeFromIndexes(spot));
				
				console.log(`[Core] Cache still full (${config.maxcache}): removed ${batchSize} oldest spots, now ${spots.length} spots`);
			}
		}
		
	} catch(e) { 
		console.error("[Core] Error processing spot:", e);
	} 
}

/**
 * Removes expired RBN spots from cache
 * RBN spots older than RBN_SPOT_TIMEOUT should not be displayed
 * @returns {number} Number of spots removed
 */
function cleanupExpiredRBN() {
	// Early exit if no RBN spots exist
	if (rbnSpotCount === 0) {
		return 0;
	}
	
	const now = Date.now();
	const rbnMaxAge = config.rbnSpotTimeout * 60 * 1000; // Convert minutes to milliseconds
	let removedCount = 0;
	
	// Filter approach: create new array without expired RBN spots
	// This is safer for concurrent reads than splice operations
	const filteredSpots = spots.filter(spot => {
		if (spot.source === 'rbn') {
			const age = now - Date.parse(spot.when);
			if (age > rbnMaxAge) {
				removeFromIndexes(spot);
				removedCount++;
				return false; // Remove this spot
			}
		}
		return true; // Keep this spot
	});
	
	// Atomic replacement if any spots were removed
	if (removedCount > 0) {
		spots = filteredSpots;
	}
	
	return removedCount;
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
    // Frequency is already normalized in handlespot, ensuring consistency
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
    // Uses helper function to ensure consistency
    const spotKey = generateSpotKey(spot);
    spotKeyIndex.set(spotKey, spot);
    
    // Update statistics indexes
    // Track mode types
    if (spot.mode && modeTypeStats[spot.mode] !== undefined) {
        modeTypeStats[spot.mode]++;
    } else {
        modeTypeStats.unknown++;
    }
    
    // Track DX continents
    if (spot.dxcc_spotted?.cont) {
        continentStats[spot.dxcc_spotted.cont] = (continentStats[spot.dxcc_spotted.cont] || 0) + 1;
    }
    
    // Track DE continents
    if (spot.dxcc_spotter?.cont) {
        continentDeStats[spot.dxcc_spotter.cont] = (continentDeStats[spot.dxcc_spotter.cont] || 0) + 1;
    }
    
    // Track RBN spot count
    if (spot.source === 'rbn') {
        rbnSpotCount++;
    }
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
    const spotKey = generateSpotKey(spot);
    spotKeyIndex.delete(spotKey);
    
    // Update statistics indexes
    // Decrement mode type stats
    if (spot.mode && modeTypeStats[spot.mode] !== undefined) {
        modeTypeStats[spot.mode]--;
    } else {
        modeTypeStats.unknown--;
    }
    
    // Decrement DX continent stats
    if (spot.dxcc_spotted?.cont) {
        continentStats[spot.dxcc_spotted.cont] = (continentStats[spot.dxcc_spotted.cont] || 1) - 1;
        if (continentStats[spot.dxcc_spotted.cont] <= 0) {
            delete continentStats[spot.dxcc_spotted.cont];
        }
    }
    
    // Decrement DE continent stats
    if (spot.dxcc_spotter?.cont) {
        continentDeStats[spot.dxcc_spotter.cont] = (continentDeStats[spot.dxcc_spotter.cont] || 1) - 1;
        if (continentDeStats[spot.dxcc_spotter.cont] <= 0) {
            delete continentDeStats[spot.dxcc_spotter.cont];
        }
    }
    
    // Decrement RBN spot count
    if (spot.source === 'rbn') {
        rbnSpotCount--;
    }
}

/**
 * Rebuilds all indexes from scratch
 */
function rebuildIndexes() {
    bandIndex.clear();
    frequencyIndex.clear();
    sourceIndex.clear();
    spotKeyIndex.clear();
    
    // Clear statistics indexes
    modeTypeStats.phone = 0;
    modeTypeStats.digi = 0;
    modeTypeStats.cw = 0;
    modeTypeStats.unknown = 0;
    Object.keys(continentStats).forEach(key => delete continentStats[key]);
    Object.keys(continentDeStats).forEach(key => delete continentDeStats[key]);
    rbnSpotCount = 0;

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
        // Atomic replacement: assign new array reference instead of mutating
        // This prevents race conditions during API reads
        spots = freshSpots;
        console.log(`[Core] Cleanup: removed ${removedCount} old spots (older than ${config.spotMaxAge} minutes)`);
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

// Pending lookup queue to batch requests and prevent duplicate concurrent lookups
const pendingDxccLookups = new Map(); // Map<callsign, Promise>

// DXCC lookup rate limiting to prevent overwhelming PHP-FPM
let dxccLookupQueue = [];
let dxccLookupInProgress = false;
let activeDxccLookups = 0;

// HTTP Response cache: Map<cacheKey, {data, timestamp}>
// Caches full HTTP responses for high-traffic endpoints to reduce CPU/memory overhead
const responseCache = new Map();
const RESPONSE_CACHE_TTL = 55 * 1000;  // 55 seconds (clients poll every 60s)
const RESPONSE_CACHE_MAX_SIZE = 1000;  // Max cached responses
const RESPONSE_CACHE_CLEANUP_INTERVAL = 60 * 1000;  // Cleanup every minute

// Periodic cleanup of response cache to remove expired entries
setInterval(() => {
    const now = Date.now();
    let removedCount = 0;
    
    for (const [key, entry] of responseCache.entries()) {
        if (now - entry.timestamp > RESPONSE_CACHE_TTL) {
            responseCache.delete(key);
            removedCount++;
        }
    }
    
    if (removedCount > 0) {
        console.log(`[Response Cache] Cleaned up ${removedCount} entries. Cache: ${responseCache.size} entries`);
    }
}, RESPONSE_CACHE_CLEANUP_INTERVAL);

/**
 * Generates a cache key from request URL and query parameters
 * @param {string} baseUrl - Base URL path
 * @param {object} query - Query parameters object
 * @returns {string} - Cache key
 */
function generateCacheKey(baseUrl, query) {
    // Sort query parameters for consistent cache keys
    const sortedQuery = Object.keys(query).sort().map(key => `${key}=${query[key]}`).join('&');
    return sortedQuery ? `${baseUrl}?${sortedQuery}` : baseUrl;
}

/**
 * Response cache middleware - caches responses for specified TTL
 * @param {number} ttl - Time to live in milliseconds
 * @returns {function} - Express middleware function
 */
function responseCacheMiddleware(ttl = RESPONSE_CACHE_TTL) {
    return (req, res, next) => {
        // Generate cache key from URL and query params
        const cacheKey = generateCacheKey(req.path, req.query);
        
        // Check if cached response exists and is still valid
        const cached = responseCache.get(cacheKey);
        if (cached) {
            const age = Date.now() - cached.timestamp;
            if (age < ttl) {
                // Cache hit - return cached response
                res.setHeader('X-Cache', 'HIT');
                res.setHeader('X-Cache-Age', Math.floor(age / 1000)); // Age in seconds
                return res.json(cached.data);
            } else {
                // Expired - remove from cache
                responseCache.delete(cacheKey);
            }
        }
        
        // Cache miss - intercept res.json to cache the response
        const originalJson = res.json.bind(res);
        res.json = function(data) {
            // Cache the response
            if (responseCache.size >= RESPONSE_CACHE_MAX_SIZE) {
                // Remove oldest 10% of entries
                const toRemove = Math.floor(RESPONSE_CACHE_MAX_SIZE * 0.1);
                let removed = 0;
                for (const key of responseCache.keys()) {
                    if (removed >= toRemove) break;
                    responseCache.delete(key);
                    removed++;
                }
            }
            
            responseCache.set(cacheKey, {
                data: data,
                timestamp: Date.now()
            });
            
            // Add cache miss header
            res.setHeader('X-Cache', 'MISS');
            
            // Call original json method
            return originalJson(data);
        };
        
        next();
    };
}

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
    
    if (removedCount > 0) {
        console.log(`[DXCC Cache] Cleaned up ${removedCount} callsigns. Cache: ${dxccCache.size} callsigns`);
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
            // Return a shallow copy to prevent cache pollution from POTA/SOTA/enrichment data
            return { ...cached.data };
        } else {
            // Expired, remove from cache
            dxccCache.delete(normalizedCall);
        }
    }
    
    // 2. Check if lookup is already in progress for this callsign
    if (pendingDxccLookups.has(normalizedCall)) {
        // Return the existing promise to avoid duplicate lookups
        return pendingDxccLookups.get(normalizedCall);
    }
    
    // 3. Perform actual lookup via PHP
    const lookupPromise = performDxccLookup(normalizedCall);
    pendingDxccLookups.set(normalizedCall, lookupPromise);
    
    try {
        const result = await lookupPromise;
        return result;
    } finally {
        // Remove from pending after completion (success or failure)
        pendingDxccLookups.delete(normalizedCall);
    }
}

async function performDxccLookup(call) {
    // Wait if too many concurrent lookups
    while (activeDxccLookups >= config.maxConcurrentDxcc) {
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
            // Remove 10% of cache or 500 entries (whichever is larger) to reduce eviction frequency
            const toRemove = Math.max(500, Math.floor(DXCC_CACHE_MAX_SIZE * 0.1));
            let removed = 0;
            for (const key of dxccCache.keys()) {
                if (removed >= toRemove) break;
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
            console.error(`[Core] DXCC lookup failed for callsign: ${call}`);
            console.error(`[Core] Served by WaveLog server: ${dxccServer}`);
        } else if (consecutiveErrorCount % 10 === 0) {
            console.error(`[Core] DXCC lookup failed: ${consecutiveErrorCount} consecutive errors`);
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
// Persistence Module - Load Cache on Startup
// ================================================================
let persistenceController = null;

if (config.persistenceEnabled) {
    console.log('[Persistence] Loading spot cache from disk...');
    
    (async () => {
        const loadResult = await Persistence.loadCache(config.persistencePath, config.spotMaxAge);
        
        if (loadResult.success && loadResult.spots.length > 0) {
            // Restore spots array
            spots = loadResult.spots;
            
            // Rebuild all indexes from loaded spots
            console.log('[Persistence] Rebuilding indexes...');
            
            for (const spot of spots) {
                // Rebuild callsign index (spotKey)
                const spotKey = `${spot.spotted}_${spot.frequency}_${spot.source}`;
                spotKeyIndex.set(spotKey, spot);
                
                // Rebuild band index
                const band = spot.band;
                if (!bandIndex.has(band)) {
                    bandIndex.set(band, new Set());
                }
                bandIndex.get(band).add(spot);
                
                // Rebuild frequency index
                const normFreq = normalizeFrequency(spot.frequency);
                frequencyIndex.set(normFreq, spot);
                
                // Rebuild source index
                const source = spot.source;
                if (!sourceIndex.has(source)) {
                    sourceIndex.set(source, new Set());
                }
                sourceIndex.get(source).add(spot);
                
                // Rebuild statistics
                const modeType = spot.mode_type || 'unknown';
                modeTypeStats[modeType] = (modeTypeStats[modeType] || 0) + 1;
                
                if (spot.dxcc_spotted?.continent) {
                    continentStats[spot.dxcc_spotted.continent] = (continentStats[spot.dxcc_spotted.continent] || 0) + 1;
                }
                
                if (spot.dxcc_spotter?.continent) {
                    continentDeStats[spot.dxcc_spotter.continent] = (continentDeStats[spot.dxcc_spotter.continent] || 0) + 1;
                }
                
                if (spot.source === 'rbn') {
                    rbnSpotCount++;
                }
            }
            
            console.log(`[Persistence] Successfully restored ${loadResult.loaded} spots (cache age: ${Math.round(loadResult.cacheAge / 1000)}s)`);
        }
        
        // Start auto-save regardless of load success
        persistenceController = Persistence.startAutoSave(
            () => spots,
            config.persistenceInterval,
            config.persistencePath
        );
        
    })().catch(error => {
        console.error('[Persistence] Initialization error:', error.message);
    });
} else {
    console.log('[Persistence] Disabled');
}

// ================================================================
// Export for Phusion Passenger
// ================================================================
// When running under Passenger, export the Express app
// Passenger will handle the HTTP server
module.exports = app;
