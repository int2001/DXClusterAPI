/**
 * API v2 Module
 * Modern REST API with authentication, filtering, and standardized responses
 * 
 * @module apiv2
 */

const express = require('express');

class APIv2 {
    /**
     * Creates a new API v2 instance
     * @param {object} config - Configuration object
     * @param {boolean} config.enabled - Whether API v2 is enabled
     * @param {string} config.apiKey - API key for authentication (empty = no auth)
     * @param {string} config.version - Application version
     * @param {function} config.getSpotsData - Function to get spots data
     */
    constructor(config) {
        this.enabled = config.enabled !== false;
        this.apiKey = config.apiKey || '';
        this.version = config.version || '2.0.0';
        this.getSpotsData = config.getSpotsData || (() => []);
        this.requireAuth = this.apiKey.length > 0;
        this.apiSpotLimit = config.apiSpotLimit || 200; // Default spot limit for /spots endpoint
        
        // Heatmap cache (15-minute TTL)
        this.heatmapCache = null;
        this.heatmapCacheTime = 0;
        this.HEATMAP_CACHE_TTL = 15 * 60 * 1000; // 15 minutes in milliseconds
    }

    /**
     * Authentication middleware
     */
    authMiddleware() {
        return (req, res, next) => {
            // Extract and store client ID for analytics (optional header)
            const clientId = req.headers['x-client-id'];
            if (clientId) {
                req.clientId = clientId;
            }

            // Skip auth if no API key is configured
            if (!this.requireAuth) {
                return next();
            }

            const providedKey = req.headers['x-api-key'];
            
            if (!providedKey) {
                return res.status(401).json(this.formatResponse({
                    success: false,
                    error: 'Authentication required. Please provide X-API-Key header.',
                    data: null
                }));
            }

            if (providedKey !== this.apiKey) {
                return res.status(403).json(this.formatResponse({
                    success: false,
                    error: 'Invalid API key',
                    data: null
                }));
            }

            next();
        };
    }

    /**
     * Format standardized API response
     * @param {object} params - Response parameters
     * @returns {object} Formatted response
     */
    formatResponse({ success = true, error = null, data = null, meta = {} }) {
        return {
            status: success ? 'success' : 'error',
            version: this.version,
            timestamp: new Date().toISOString(),
            error: error,
            data: data,
            meta: meta
        };
    }

    /**
     * Strips internal debugging data from spots before API response
     * @param {array} spots - Array of spots
     * @returns {array} - Cleaned spots without internal data
     */
    cleanSpotsForAPI(spots) {
        return spots.map(spot => {
            const { _sourceData, ...cleanSpot } = spot;
            return cleanSpot;
        });
    }

    /**
     * Filter spots based on query parameters
     * @param {Array} spots - Array of spots to filter
     * @param {object} filters - Filter parameters
     * @returns {Array} Filtered spots
     */
    filterSpots(spots, filters) {
        let filtered = [...spots];

        // Filter by band
        if (filters.band) {
            const band = filters.band.toLowerCase();
            filtered = filtered.filter(spot => 
                spot.band && spot.band.toLowerCase() === band
            );
        }

        // Filter by continent (dxcc_spotted.cont)
        if (filters.continent) {
            const cont = filters.continent.toUpperCase();
            filtered = filtered.filter(spot => 
                spot.dxcc_spotted?.cont === cont
            );
        }

        // Filter by source
        if (filters.source) {
            const source = filters.source.toLowerCase();
            filtered = filtered.filter(spot => 
                spot.source && spot.source.toLowerCase() === source
            );
        }

        // Filter by max age (in minutes)
        if (filters.maxAge) {
            const maxAge = parseInt(filters.maxAge);
            if (!isNaN(maxAge)) {
                const cutoffTime = new Date(Date.now() - maxAge * 60 * 1000);
                filtered = filtered.filter(spot => {
                    const spotTime = new Date(spot.when);
                    return spotTime >= cutoffTime;
                });
            }
        }

        // Filter by frequency range
        if (filters.minFreq || filters.maxFreq) {
            const minFreq = filters.minFreq ? parseFloat(filters.minFreq) : 0;
            const maxFreq = filters.maxFreq ? parseFloat(filters.maxFreq) : Infinity;
            filtered = filtered.filter(spot => 
                spot.frequency >= minFreq && spot.frequency <= maxFreq
            );
        }

        // Filter by contest spots
        if (filters.contest !== undefined) {
            const showContest = filters.contest === 'true' || filters.contest === true;
            filtered = filtered.filter(spot => 
                spot.dxcc_spotted?.isContest === showContest
            );
        }

        // Filter by POTA/SOTA/IOTA/WWFF
        if (filters.pota === 'true') {
            filtered = filtered.filter(spot => 
                spot.dxcc_spotted?.pota_ref && spot.dxcc_spotted.pota_ref.length > 0
            );
        }
        if (filters.sota === 'true') {
            filtered = filtered.filter(spot => 
                spot.dxcc_spotted?.sota_ref && spot.dxcc_spotted.sota_ref.length > 0
            );
        }
        if (filters.iota === 'true') {
            filtered = filtered.filter(spot => 
                spot.dxcc_spotted?.iota_ref && spot.dxcc_spotted.iota_ref.length > 0
            );
        }
        if (filters.wwff === 'true') {
            filtered = filtered.filter(spot => 
                spot.dxcc_spotted?.wwff_ref && spot.dxcc_spotted.wwff_ref.length > 0
            );
        }

        // Filter by mode (supports comma-separated: cw,phone,digi)
        if (filters.mode) {
            const requestedModes = filters.mode.toLowerCase().split(',').map(m => m.trim());
            filtered = filtered.filter(spot => 
                spot.mode && requestedModes.includes(spot.mode.toLowerCase())
            );
        }

        // Filter by submode (supports comma-separated: FT8,FT4,CW,USB,LSB)
        if (filters.submode) {
            const requestedSubmodes = filters.submode.toUpperCase().split(',').map(m => m.trim());
            filtered = filtered.filter(spot => 
                spot.submode && requestedSubmodes.includes(spot.submode.toUpperCase())
            );
        }

        return filtered;
    }

    /**
     * Generate heatmap data: spots by DE continent, band, and DX continent
     * Results are cached for 15 minutes
     * @returns {object} Heatmap data structure
     */
    generateHeatmap() {
        // Check cache
        const now = Date.now();
        if (this.heatmapCache && (now - this.heatmapCacheTime < this.HEATMAP_CACHE_TTL)) {
            return this.heatmapCache;
        }

        const spots = this.getSpotsData();
        const heatmap = {};
        
        // Standard band order for consistency
        const bandOrder = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '4m', '2m', '70cm'];
        const continents = ['EU', 'NA', 'SA', 'AS', 'AF', 'OC'];
        
        // Process each spot
        spots.forEach(spot => {
            const deCont = spot.dxcc_spotter?.cont;  // Spotter's continent
            const dxCont = spot.dxcc_spotted?.cont;  // Spotted station's continent
            const band = spot.band;
            
            // Skip if missing required data
            if (!deCont || !dxCont || !band) return;
            
            // Initialize DE continent if needed
            if (!heatmap[deCont]) {
                heatmap[deCont] = {};
            }
            
            // Initialize band if needed
            if (!heatmap[deCont][band]) {
                heatmap[deCont][band] = {};
            }
            
            // Initialize DX continent counter if needed
            if (!heatmap[deCont][band][dxCont]) {
                heatmap[deCont][band][dxCont] = 0;
            }
            
            // Increment counter
            heatmap[deCont][band][dxCont]++;
        });
        
        // Structure the result
        const result = {
            continents: continents,
            bands: bandOrder,
            data: heatmap,
            generatedAt: new Date().toISOString(),
            totalSpots: spots.length,
            cacheExpiresIn: this.HEATMAP_CACHE_TTL / 1000 // seconds
        };
        
        // Cache the result
        this.heatmapCache = result;
        this.heatmapCacheTime = now;
        
        return result;
    }

    /**
     * Create router with all API v2 endpoints
     * @param {Function} rateLimiter - Optional rate limiter middleware for spot endpoints
     * @param {Function} cacheMiddleware - Optional response cache middleware
     * @returns {express.Router} Express router
     */
    createRouter(rateLimiter, cacheMiddleware) {
        // Create a fresh router instance each time
        const router = express.Router();
        
        // Apply authentication to all v2 routes
        router.use(this.authMiddleware());
        
        // Use cache middleware if provided, otherwise passthrough
        const cache = cacheMiddleware || ((req, res, next) => next());

        /**
         * GET /api/v2/spots
         * Get all spots with optional filtering
         * Uses 1-minute response cache to reduce CPU overhead from repeated filtering/JSON serialization
         * 
         * Query parameters:
         * - band: Filter by band (e.g., "20m", "40m")
         * - continent: Filter by continent code (e.g., "EU", "NA", "AS")
         * - source: Filter by source (e.g., "cluster", "pota", "sota")
         * - maxAge: Maximum age in minutes (e.g., 30, 60)
         * - minFreq: Minimum frequency in kHz (e.g., 14000)
         * - maxFreq: Maximum frequency in kHz (e.g., 14350)
         * - contest: Filter contest spots (true/false)
         * - pota: Show only POTA spots (true/false)
         * - sota: Show only SOTA spots (true/false)
         * - iota: Show only IOTA spots (true/false)
         * - wwff: Show only WWFF spots (true/false)
         * - mode: Filter by mode, comma-separated (e.g., "cw", "phone,digi")
         * - submode: Filter by submode, comma-separated (e.g., "FT8", "CW,RTTY")
         * - limit: Maximum number of results (max: 500, omit for all results)
         * - offset: Pagination offset (default: 0)
         */
        router.get('/spots', cache, rateLimiter || ((req, res, next) => next()), (req, res) => {
            try {
                const spots = this.getSpotsData();
                const filters = req.query;
                
                // Apply filters
                let filtered = this.filterSpots(spots, filters);
                
                // Reverse to newest-first for consistent API behavior
                filtered.reverse();
                
                // Pagination
                const offset = parseInt(filters.offset) || 0;
                const total = filtered.length;
                
                // Apply limit: use provided limit, or default limit, max 500
                let limit;
                if (filters.limit !== undefined) {
                    limit = Math.min(parseInt(filters.limit), 500);
                } else {
                    // No limit specified - use default API_SPOT_LIMIT
                    limit = this.apiSpotLimit;
                }
                
                // Apply pagination (now on reversed/newest-first array)
                filtered = filtered.slice(offset, offset + limit);
                
                // Include source data for debug/live page if requested
                const includeDebug = filters.debug === 'true' || filters.debug === '1';
                const responseSpots = includeDebug ? filtered : this.cleanSpotsForAPI(filtered);
                
                res.json(this.formatResponse({
                    success: true,
                    data: responseSpots,
                    meta: {
                        total: total,
                        limit: limit,
                        offset: offset,
                        returned: responseSpots.length,
                        filters: filters
                    }
                }));
            } catch (error) {
                console.error('[APIv2] /spots error:', error);
                res.status(500).json(this.formatResponse({
                    success: false,
                    error: 'Internal server error',
                    data: null
                }));
            }
        });

        /**
         * GET /api/v2/spots/:callsign
         * Get spots for a specific callsign
         */
        router.get('/spots/:callsign', rateLimiter || ((req, res, next) => next()), (req, res) => {
            try {
                const callsign = req.params.callsign.toUpperCase();
                const spots = this.getSpotsData();
                
                const filtered = spots.filter(spot => 
                    spot.spotted && spot.spotted.toUpperCase() === callsign
                );
                
                // Strip internal debug data before sending to customers
                const cleanedSpots = this.cleanSpotsForAPI(filtered);
                
                res.json(this.formatResponse({
                    success: true,
                    data: cleanedSpots,
                    meta: {
                        callsign: callsign,
                        total: cleanedSpots.length
                    }
                }));
            } catch (error) {
                console.error('[APIv2] /spots/:callsign error:', error);
                res.status(500).json(this.formatResponse({
                    success: false,
                    error: 'Internal server error',
                    data: null
                }));
            }
        });

        /**
         * GET /api/v2/spot/:qrg
         * Get the latest spot at a specific frequency (in kHz)
         */
        router.get('/spot/:qrg', rateLimiter || ((req, res, next) => next()), (req, res) => {
            try {
                const qrg = parseFloat(req.params.qrg);
                const spots = this.getSpotsData();
                
                // Find spot with exact frequency match
                const spot = spots.find(s => s.frequency === qrg);
                
                if (spot) {
                    res.json(this.formatResponse({
                        success: true,
                        data: spot,
                        meta: {
                            frequency: qrg
                        }
                    }));
                } else {
                    res.status(404).json(this.formatResponse({
                        success: false,
                        error: 'No spot found at this frequency',
                        data: null,
                        meta: {
                            frequency: qrg
                        }
                    }));
                }
            } catch (error) {
                console.error('[APIv2] /spot/:qrg error:', error);
                res.status(500).json(this.formatResponse({
                    success: false,
                    error: 'Internal server error',
                    data: null
                }));
            }
        });

        /**
         * GET /api/v2/bands
         * Get list of active bands with spot counts
         */
        router.get('/bands', (req, res) => {
            try {
                const spots = this.getSpotsData();
                const bandStats = {};
                
                spots.forEach(spot => {
                    const band = spot.band || 'Unknown';
                    bandStats[band] = (bandStats[band] || 0) + 1;
                });
                
                const bands = Object.entries(bandStats)
                    .map(([band, count]) => ({ band, spots: count }))
                    .sort((a, b) => b.spots - a.spots);
                
                res.json(this.formatResponse({
                    success: true,
                    data: bands,
                    meta: {
                        totalBands: bands.length
                    }
                }));
            } catch (error) {
                console.error('[APIv2] /bands error:', error);
                res.status(500).json(this.formatResponse({
                    success: false,
                    error: 'Internal server error',
                    data: null
                }));
            }
        });

        /**
         * GET /api/v2/sources
         * Get list of active sources with spot counts
         */
        router.get('/sources', (req, res) => {
            try {
                const spots = this.getSpotsData();
                const sourceStats = {};
                
                spots.forEach(spot => {
                    const source = spot.source || 'Unknown';
                    sourceStats[source] = (sourceStats[source] || 0) + 1;
                });
                
                const sources = Object.entries(sourceStats)
                    .map(([source, count]) => ({ source, spots: count }))
                    .sort((a, b) => b.spots - a.spots);
                
                res.json(this.formatResponse({
                    success: true,
                    data: sources,
                    meta: {
                        totalSources: sources.length
                    }
                }));
            } catch (error) {
                console.error('[APIv2] /sources error:', error);
                res.status(500).json(this.formatResponse({
                    success: false,
                    error: 'Internal server error',
                    data: null
                }));
            }
        });

        /**
         * GET /api/v2/heatmap
         * Get band activity heatmap by DE continent, band, and DX continent
         * Data is cached for 15 minutes for performance
         * 
         * Query parameters:
         * - continent: Filter by DE continent (spotter's continent) (e.g., "EU", "NA")
         * 
         * Response structure:
         * {
         *   continents: ["EU", "NA", "SA", "AS", "AF", "OC"],
         *   bands: ["160m", "80m", "60m", "40m", ...],
         *   data: {
         *     "EU": {
         *       "20m": { "EU": 45, "NA": 23, "AS": 12, ... },
         *       "40m": { "EU": 34, "NA": 18, ... }
         *     },
         *     "NA": { ... }
         *   }
         * }
         */
        router.get('/heatmap', (req, res) => {
            try {
                let heatmapData = this.generateHeatmap();
                
                // Filter by DE continent if requested
                const deContFilter = req.query.continent?.toUpperCase();
                if (deContFilter) {
                    const filteredData = {};
                    if (heatmapData.data[deContFilter]) {
                        filteredData[deContFilter] = heatmapData.data[deContFilter];
                    }
                    heatmapData = {
                        ...heatmapData,
                        data: filteredData,
                        filtered: true,
                        filterContinent: deContFilter
                    };
                }
                
                res.json(this.formatResponse({
                    success: true,
                    data: heatmapData,
                    meta: {
                        cached: true,
                        cacheAgeSeconds: Math.floor((Date.now() - this.heatmapCacheTime) / 1000),
                        cacheTTLSeconds: this.HEATMAP_CACHE_TTL / 1000
                    }
                }));
            } catch (error) {
                console.error('[APIv2] /heatmap error:', error);
                res.status(500).json(this.formatResponse({
                    success: false,
                    error: 'Internal server error',
                    data: null
                }));
            }
        });

        /**
         * GET /api/v2/info
         * Get API information and capabilities
         */
        router.get('/info', (req, res) => {
            res.json(this.formatResponse({
                success: true,
                data: {
                    apiVersion: 'v2',
                    appVersion: this.version,
                    authentication: this.requireAuth,
                    endpoints: [
                        {
                            path: '/api/v2/spots',
                            method: 'GET',
                            description: 'Get filtered spots',
                            parameters: [
                                'band', 'continent', 'source', 'maxAge', 'minFreq', 'maxFreq',
                                'contest', 'pota', 'sota', 'iota', 'wwff', 'mode', 'submode', 'limit', 'offset'
                            ]
                        },
                        {
                            path: '/api/v2/spots/:callsign',
                            method: 'GET',
                            description: 'Get spots for specific callsign'
                        },
                        {
                            path: '/api/v2/spot/:qrg',
                            method: 'GET',
                            description: 'Get latest spot at specific frequency (kHz)'
                        },
                        {
                            path: '/api/v2/bands',
                            method: 'GET',
                            description: 'Get active bands with spot counts'
                        },
                        {
                            path: '/api/v2/sources',
                            method: 'GET',
                            description: 'Get active sources with spot counts'
                        },
                        {
                            path: '/api/v2/heatmap',
                            method: 'GET',
                            description: 'Get band activity heatmap by DE continent, band, and DX continent (cached 15min)',
                            parameters: ['continent']
                        },
                        {
                            path: '/api/v2/info',
                            method: 'GET',
                            description: 'Get API information and capabilities'
                        }
                    ]
                },
                meta: {}
            }));
        });

        return router;
    }

    /**
     * Gets the list of API v2 endpoints
     * @param {string} baseUrl - Base URL prefix
     * @returns {object} - Object with endpoint paths
     */
    getEndpoints(baseUrl = '') {
        return {
            info: baseUrl + '/api/v2/info',
            spots: baseUrl + '/api/v2/spots',
            spotByCallsign: baseUrl + '/api/v2/spots/:callsign',
            spotByFrequency: baseUrl + '/api/v2/spot/:qrg',
            bands: baseUrl + '/api/v2/bands',
            sources: baseUrl + '/api/v2/sources',
            heatmap: baseUrl + '/api/v2/heatmap'
        };
    }

    /**
     * Get module status
     * @returns {object} Status information
     */
    getStatus() {
        return {
            enabled: this.enabled,
            requiresAuth: this.requireAuth,
            version: this.version
        };
    }
}

module.exports = APIv2;
