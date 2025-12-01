/**
 * Reverse Beacon Network (RBN) Module
 * Connects to RBN telnet servers for CW/RTTY and FT8 spots
 * Filters spots to show only one per continent per spotted callsign
 * 
 * @module rbn
 */

const DXCluster = require('../../lib/dxcluster');
const EventEmitter = require('events');

class RBNManager extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.enabled = options.enabled !== false;
        this.callsign = options.callsign || 'N0CALL';
        this.connections = [];
        this.spots = new Map(); // Key: spotted callsign, Value: Map of continent -> spot
        this.pendingSpots = new Map(); // Track spots currently being processed to prevent race conditions
        this.spotTimeout = options.spotTimeout || 5 * 60 * 1000; // 5 minutes default
        this.MAX_SPOTS = 2000; // Maximum number of unique callsigns to track
        
        // Exponential backoff settings for reconnections
        this.INITIAL_RECONNECT_DELAY = 5000;       // 5 seconds initial
        this.MAX_RECONNECT_DELAY = 3600000;        // 1 hour max
        this.RECONNECT_BACKOFF_FACTOR = 2;         // Double delay each time
        this.reconnectDelays = new Map();          // Track delays per cluster
        this.reconnectTimers = new Map();          // Track active reconnect timers
        
        // Feed enable/disable flags
        this.cwRttyEnabled = options.cwRttyEnabled !== false; // default true
        this.ft8Enabled = options.ft8Enabled === true; // default false
        
        // Build cluster configurations based on enabled feeds
        this.clusters = [];
        
        if (this.cwRttyEnabled) {
            this.clusters.push({
                host: "telnet.reversebeacon.net",
                port: 7000,
                loginPrompt: "Please enter your call:",
                call: this.callsign,
                password: "",
                cluster: "RBN_CW_RTTY"
            });
        }
        
        if (this.ft8Enabled) {
            this.clusters.push({
                host: "telnet.reversebeacon.net",
                port: 7001,
                loginPrompt: "Please enter your call:",
                call: this.callsign,
                password: "",
                cluster: "RBN_FT8"
            });
        }
        
        if (this.enabled) {
            this.startCleanupTimer();
        }
    }

    /**
     * Start all RBN cluster connections
     */
    async start() {
        if (!this.enabled) {
            console.log('[RBN] Module disabled');
            return;
        }

        if (this.clusters.length === 0) {
            console.log('[RBN] No RBN feeds enabled (check RBN_CW_RTTY_ENABLED and RBN_FT8_ENABLED)');
            return;
        }

        console.log(`[RBN] Starting Reverse Beacon Network module with ${this.clusters.length} connections`);
        console.log(`[RBN] Using callsign: ${this.callsign}`);
        console.log(`[RBN] Enabled feeds: ${this.clusters.map(c => c.cluster).join(', ')}`);

        for (const clusterConfig of this.clusters) {
            await this.connectToCluster(clusterConfig);
        }
    }

    /**
     * Connect to a single RBN cluster with exponential backoff on failures
     */
    async connectToCluster(config) {
        const clusterKey = config.cluster;
        
        // Cancel any pending reconnect timer for this cluster
        if (this.reconnectTimers.has(clusterKey)) {
            clearTimeout(this.reconnectTimers.get(clusterKey));
            this.reconnectTimers.delete(clusterKey);
        }
        
        try {
            console.log(`[RBN] Connecting to ${config.cluster} (${config.host}:${config.port})...`);
            
            const cluster = new DXCluster({
                call: config.call,
                ct: '\r\n'
            });
            
            // Track if connection was established (for backoff reset)
            let wasConnected = false;

            cluster.on('spot', (spot) => {
                this.handleSpot(spot, config.cluster);
            });

            cluster.on('message', (msg) => {
                // Suppress regular messages to reduce log noise
                if (msg.includes('Connected') || msg.includes('Spot rate')) {
                    console.log(`[RBN] ${config.cluster}: ${msg.trim()}`);
                }
            });

            cluster.on('close', () => {
                console.log(`[RBN] ${config.cluster} connection closed.`);
                // Connection lost - reset to quick retry
                if (wasConnected) {
                    this.reconnectDelays.set(clusterKey, this.INITIAL_RECONNECT_DELAY);
                }
                this._scheduleReconnect(config);
            });

            cluster.on('error', (err) => {
                console.error(`[RBN] ${config.cluster} error:`, err.message);
            });

            await cluster.connect({
                host: config.host,
                port: config.port,
                call: config.call,
                password: config.password,
                loginPrompt: config.loginPrompt
            });
            
            wasConnected = true;

            this.connections.push({
                cluster: cluster,
                config: config
            });

            console.log(`[RBN] ${config.cluster} connected successfully`);
            
            // Reset reconnect delay on successful connection
            this.reconnectDelays.delete(clusterKey);

        } catch (error) {
            console.error(`[RBN] Failed to connect to ${config.cluster}:`, error.message);
            // Clean up failed connection before retry
            if (this.cluster) {
                this._cleanupRbnConnection({ cluster: config, conn: this.cluster });
            }
            this._scheduleReconnect(config);
        }
    }
    
    /**
     * Schedule a reconnection attempt with exponential backoff
     * @private
     */
    _scheduleReconnect(config) {
        const clusterKey = config.cluster;
        
        // Cancel any existing timer
        if (this.reconnectTimers.has(clusterKey)) {
            clearTimeout(this.reconnectTimers.get(clusterKey));
        }
        
        // Get current delay or start with initial delay
        let currentDelay = this.reconnectDelays.get(clusterKey) || this.INITIAL_RECONNECT_DELAY;
        
        // Format delay for logging
        const delaySeconds = Math.round(currentDelay / 1000);
        const delayFormatted = delaySeconds >= 60 
            ? `${Math.round(delaySeconds / 60)}m` 
            : `${delaySeconds}s`;
        
        console.log(`[RBN] Reconnecting to ${config.cluster} in ${delayFormatted}...`);
        
        const timerId = setTimeout(() => {
            this.reconnectTimers.delete(clusterKey);
            this.connectToCluster(config);
        }, currentDelay);
        
        this.reconnectTimers.set(clusterKey, timerId);
        
        // Increase delay for next attempt (exponential backoff with max cap)
        const nextDelay = Math.min(currentDelay * this.RECONNECT_BACKOFF_FACTOR, this.MAX_RECONNECT_DELAY);
        this.reconnectDelays.set(clusterKey, nextDelay);
    }

    /**
     * Handle incoming spot from RBN
     * Filters to keep only one spot per continent per spotted callsign
     * Note: Continent filtering is applied AFTER DXCC lookup in handlespot()
     */
    handleSpot(spot, source) {
        const spottedCall = spot.spotted;
        
        // Add source information immediately
        spot.source = source;
        spot.timestamp = Date.now();
        
        // Store temporarily - filtering will happen after DXCC lookup
        // We emit the spot and let the main spot handler do DXCC lookup
        // Then the actual filtering happens in the spot cache
        this.emit('spot', spot);
    }
    
    /**
     * Apply continent filtering to a spot with DXCC data
     * This should be called AFTER DXCC lookup is complete
     * Returns true if spot should be kept, false if should be filtered
     */
    shouldKeepSpot(spot) {
        if (!spot.dxcc_spotter || !spot.dxcc_spotter.cont) {
            // No DXCC data yet, keep it for now
            return true;
        }
        
        const spottedCall = spot.spotted;
        const spotterContinent = spot.dxcc_spotter.cont;
        
        // Add continent info to spot
        spot.spotterContinent = spotterContinent;
        
        // Check if we've reached max spots limit
        if (!this.spots.has(spottedCall) && this.spots.size >= this.MAX_SPOTS) {
            // Find and remove oldest spot by timestamp
            let oldestCall = null;
            let oldestTime = Date.now();
            
            for (const [call, continentMap] of this.spots.entries()) {
                for (const [continent, spotData] of continentMap.entries()) {
                    if (spotData.timestamp < oldestTime) {
                        oldestTime = spotData.timestamp;
                        oldestCall = call;
                    }
                }
            }
            
            if (oldestCall) {
                this.spots.delete(oldestCall);
            }
        }
        
        // Initialize spot entry if doesn't exist
        if (!this.spots.has(spottedCall)) {
            this.spots.set(spottedCall, new Map());
        }
        
        const continentSpots = this.spots.get(spottedCall);
        
        // Check if we already have a spot from this continent
        const existingSpot = continentSpots.get(spotterContinent);
        
        if (!existingSpot) {
            // First spot from this continent for this callsign - store it
            continentSpots.set(spotterContinent, {
                frequency: spot.frequency,
                message: spot.message,
                timestamp: Date.now()
            });
            return true;
        }
        
        // We have an existing spot from this continent
        // Check if new spot is better
        const shouldUpdate = this.shouldUpdateSpot(existingSpot, spot);
        if (shouldUpdate) {
            // Update with new snapshot
            continentSpots.set(spotterContinent, {
                frequency: spot.frequency,
                message: spot.message,
                timestamp: Date.now()
            });
            return true; // Allow replacement
        }
        
        // Reject this spot - we have a better one from this continent
        return false;
    }

    /**
     * Determine if new spot should replace existing one
     */
    shouldUpdateSpot(existingSpot, newSpot) {
        // Extract SNR values if available in message
        const existingSNR = this.extractSNR(existingSpot.message);
        const newSNR = this.extractSNR(newSpot.message);
        
        // If both have SNR, prefer higher SNR
        if (existingSNR !== null && newSNR !== null) {
            if (newSNR > existingSNR + 5) { // 5 dB threshold
                return true;
            }
        }
        
        // Otherwise, update if spot is on different frequency (callsign moved)
        if (Math.abs(newSpot.frequency - existingSpot.frequency) > 1.0) {
            return true;
        }
        
        // Update if existing spot is older than 2 minutes
        const age = Date.now() - (existingSpot.timestamp || 0);
        if (age > 2 * 60 * 1000) {
            return true;
        }
        
        return false;
    }

    /**
     * Extract SNR from message (e.g., "CW 25 dB 15 WPM CQ")
     */
    extractSNR(message) {
        if (!message) return null;
        const match = message.match(/(\d+)\s*dB/i);
        return match ? parseInt(match[1]) : null;
    }

    /**
     * Format spot for emission to main application
     */
    formatSpot(spot) {
        return {
            spotter: spot.spotter,
            spotted: spot.spotted,
            frequency: spot.frequency,
            message: spot.message || '',
            when: spot.when || new Date(),
            source: spot.source,
            spotterContinent: spot.spotterContinent
        };
    }

    /**
     * Get all active spots (one per continent per callsign)
     */
    getAllSpots() {
        const allSpots = [];
        
        for (const [spottedCall, continentMap] of this.spots.entries()) {
            for (const [continent, spot] of continentMap.entries()) {
                allSpots.push(this.formatSpot(spot));
            }
        }
        
        // Sort by frequency
        allSpots.sort((a, b) => a.frequency - b.frequency);
        
        return allSpots;
    }

    /**
     * Get statistics about RBN connections and spots
     */
    getStats() {
        const stats = {
            enabled: this.enabled,
            connections: this.connections.length,
            connectedClusters: this.connections.map(c => c.config.cluster),
            uniqueSpottedCallsigns: this.spots.size,
            totalSpots: 0,
            spotsByContinent: {}
        };
        
        for (const [spottedCall, continentMap] of this.spots.entries()) {
            stats.totalSpots += continentMap.size;
            
            for (const [continent] of continentMap.entries()) {
                stats.spotsByContinent[continent] = (stats.spotsByContinent[continent] || 0) + 1;
            }
        }
        
        return stats;
    }

    /**
     * Start cleanup timer to remove old spots
     */
    startCleanupTimer() {
        setInterval(() => {
            this.cleanupOldSpots();
        }, 60000); // Run every minute
    }

    /**
     * Remove spots older than spotTimeout
     */
    cleanupOldSpots() {
        const now = Date.now();
        let removedCount = 0;
        
        for (const [spottedCall, continentMap] of this.spots.entries()) {
            for (const [continent, spot] of continentMap.entries()) {
                const age = now - (spot.timestamp || 0);
                if (age > this.spotTimeout) {
                    continentMap.delete(continent);
                    removedCount++;
                }
            }
            
            // Remove callsign entry if no continents left
            if (continentMap.size === 0) {
                this.spots.delete(spottedCall);
            }
        }
        
        if (removedCount > 0) {
            console.log(`[RBN] Cleaned up ${removedCount} old spots`);
        }
    }

    /**
     * Stop all connections
     */
    stop() {
        console.log('[RBN] Stopping all RBN connections...');
        
        // Cancel all pending reconnect timers
        this.reconnectTimers.forEach((timerId, clusterKey) => {
            clearTimeout(timerId);
            console.log(`[RBN] Cancelled reconnect timer for ${clusterKey}`);
        });
        this.reconnectTimers.clear();
        this.reconnectDelays.clear();
        
        // Close all active connections
        for (const conn of this.connections) {
            try {
                conn.cluster.close();
            } catch (error) {
                console.error(`[RBN] Error closing ${conn.config.cluster}:`, error.message);
            }
        }
        
        this.connections = [];
        this.spots.clear();
        console.log('[RBN] All RBN connections stopped');
    }
}

module.exports = RBNManager;
