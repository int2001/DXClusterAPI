/**
 * API Analytics Module
 * Tracks API usage statistics and client information
 * 
 * @module analytics
 */

const fs = require('fs');
const path = require('path');

class Analytics {
    constructor(options = {}) {
        this.enabled = options.enabled !== false;
        this.dataFile = options.dataFile || path.join(__dirname, '../../data/analytics.json');
        this.saveInterval = options.saveInterval || 5 * 60 * 1000; // 5 minutes default
        this.clients = {};
        this.saveTimer = null;
        
        // Endpoints to skip tracking
        this.skipPaths = options.skipPaths || ['/health', '/demo', '/customers', '/analytics'];
        
        if (this.enabled) {
            this.load();
            this.startAutoSave();
        }
    }

    /**
     * Load existing analytics data from file
     */
    load() {
        try {
            if (fs.existsSync(this.dataFile)) {
                const data = fs.readFileSync(this.dataFile, 'utf8');
                this.clients = JSON.parse(data);
                
                // Restore Sets from Arrays
                for (const client of Object.values(this.clients)) {
                    if (Array.isArray(client.referers)) {
                        client.referers = new Set(client.referers);
                    } else {
                        client.referers = new Set();
                    }
                }
                
                console.log(`[Analytics] Loaded ${Object.keys(this.clients).length} client records`);
            } else {
                // Create data directory if it doesn't exist
                const dataDir = path.dirname(this.dataFile);
                if (!fs.existsSync(dataDir)) {
                    fs.mkdirSync(dataDir, { recursive: true });
                }
                this.clients = {};
                console.log('[Analytics] Starting with empty client database');
            }
        } catch (error) {
            console.error('[Analytics] Error loading data:', error.message);
            this.clients = {};
        }
    }

    /**
     * Save analytics data to file
     */
    save() {
        if (!this.enabled) return;
        
        try {
            const prepared = this.prepareForSave();
            fs.writeFileSync(this.dataFile, JSON.stringify(prepared, null, 2), 'utf8');
        } catch (error) {
            console.error('[Analytics] Error saving data:', error.message);
        }
    }

    /**
     * Convert Sets to Arrays for JSON serialization
     */
    prepareForSave() {
        const prepared = {};
        for (const [key, client] of Object.entries(this.clients)) {
            prepared[key] = {
                ...client,
                referers: client.referers ? Array.from(client.referers) : []
            };
        }
        return prepared;
    }

    /**
     * Start automatic periodic saving
     */
    startAutoSave() {
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
        }
        
        this.saveTimer = setInterval(() => {
            this.save();
        }, this.saveInterval);
    }

    /**
     * Stop automatic saving and save final state
     */
    stop() {
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
            this.saveTimer = null;
        }
        this.save();
        console.log('[Analytics] Stopped and saved final state');
    }

    /**
     * Track an API request
     * 
     * @param {object} req - Express request object
     */
    track(req) {
        if (!this.enabled) return;

        // Skip tracking for certain endpoints
        const isSkipped = this.skipPaths.some(path => req.url.includes(path)) || 
                          req.url.endsWith('.html') || 
                          req.url.endsWith('.css') || 
                          req.url.endsWith('.js') ||
                          req.url.endsWith('.ico');
        
        if (isSkipped) return;

        // Extract client information
        const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                   req.headers['x-real-ip'] || 
                   req.socket.remoteAddress || 
                   req.connection.remoteAddress;
        
        const userAgent = req.headers['user-agent'] || 'Unknown';
        const referer = req.headers['referer'] || req.headers['referrer'] || 'Direct';
        const clientId = req.clientId || req.headers['x-client-id'] || null; // Support X-Client-ID header
        const endpoint = req.url.split('?')[0]; // Remove query params
        const method = req.method;
        
        // Create client key (IP-based, optionally with clientId)
        const clientKey = clientId ? `${clientId}@${ip}` : ip;
        
        // Initialize or update client record
        if (!this.clients[clientKey]) {
            this.clients[clientKey] = {
                ip: ip,
                clientId: clientId || undefined,
                userAgent: userAgent,
                firstSeen: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
                totalRequests: 0,
                endpoints: {},
                referers: new Set()
            };
        }
        
        const client = this.clients[clientKey];
        client.lastSeen = new Date().toISOString();
        client.totalRequests++;
        client.userAgent = userAgent; // Update in case it changed
        
        // Update clientId if provided (for cases where it wasn't initially)
        if (clientId && !client.clientId) {
            client.clientId = clientId;
        }
        
        // Track endpoint usage
        if (!client.endpoints[endpoint]) {
            client.endpoints[endpoint] = {
                count: 0,
                methods: {},
                lastAccess: new Date().toISOString()
            };
        }
        client.endpoints[endpoint].count++;
        client.endpoints[endpoint].lastAccess = new Date().toISOString();
        client.endpoints[endpoint].methods[method] = (client.endpoints[endpoint].methods[method] || 0) + 1;
        
        // Track referers
        if (referer !== 'Direct') {
            client.referers.add(referer);
        }
    }

    /**
     * Get analytics summary
     * 
     * @returns {object} Analytics summary with client data
     */
    getSummary() {
        const prepared = this.prepareForSave();
        
        // Calculate summary statistics
        const totalClients = Object.keys(prepared).length;
        const totalRequests = Object.values(prepared).reduce((sum, c) => sum + c.totalRequests, 0);
        
        // Sort clients by total requests (most active first)
        const sortedClients = Object.entries(prepared)
            .map(([key, client]) => ({
                ...client,
                key: key
            }))
            .sort((a, b) => b.totalRequests - a.totalRequests);
        
        // Group by endpoint usage
        const endpointStats = {};
        for (const client of Object.values(prepared)) {
            for (const [endpoint, data] of Object.entries(client.endpoints)) {
                if (!endpointStats[endpoint]) {
                    endpointStats[endpoint] = {
                        totalRequests: 0,
                        uniqueClients: 0
                    };
                }
                endpointStats[endpoint].totalRequests += data.count;
                endpointStats[endpoint].uniqueClients++;
            }
        }
        
        return {
            summary: {
                enabled: this.enabled,
                totalClients: totalClients,
                totalRequests: totalRequests,
                dataFile: this.dataFile
            },
            endpointStats: endpointStats,
            clients: sortedClients
        };
    }

    /**
     * Create Express middleware for tracking
     * 
     * @returns {function} Express middleware function
     */
    middleware() {
        return (req, res, next) => {
            this.track(req);
            next();
        };
    }
}

module.exports = Analytics;
