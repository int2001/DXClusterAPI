const EventEmitter = require('events');
const DXCluster = require('../../lib/dxcluster');
const { logConnectionState } = require('../../lib/utils');

/**
 * Clusters Module
 * Manages DX Cluster connections with configurable enable/disable support
 */
class Clusters extends EventEmitter {
    /**
     * Creates a new Clusters manager
     * @param {boolean} enabled - Whether the cluster module is enabled
     * @param {Array} clusters - Array of cluster configuration objects
     */
    constructor(enabled = true, clusters = []) {
        super();
        this.enabled = enabled;
        this.clusters = clusters;
        this.connections = [];
        this.reconnectDelays = new Map(); // Track reconnect delays per cluster
        this.stats = {
            totalClusters: clusters.length,
            activeConnections: 0,
            reconnectAttempts: 0,
            spotsReceived: 0
        };
        
        // Reconnect settings
        this.INITIAL_RECONNECT_DELAY = 5000;       // 5 seconds initial
        this.MAX_RECONNECT_DELAY = 3600000;        // 1 hour max (retry hourly when cluster is down)
        this.RECONNECT_BACKOFF_FACTOR = 2;         // Double delay each time
        this.reconnectTimers = new Map();          // Track active reconnect timers
        this.activeConnMap = new Map();            // Track which clusters are currently connected
    }

    /**
     * Initialize cluster connections
     */
    init() {
        if (!this.enabled) {
            console.log('[Clusters] Module disabled');
            return;
        }

        if (!this.clusters || this.clusters.length === 0) {
            console.log('[Clusters] No clusters configured');
            return;
        }

        console.log(`[Clusters] Initializing ${this.clusters.length} DXCluster(s)`);
        this.reconnect();
    }

    /**
     * Connect to all configured clusters
     */
    reconnect() {
        if (!this.enabled) return;

        this.clusters.forEach(cluster => {
            this._connectOne(cluster);
        });
    }

    /**
     * Connect to a single cluster with exponential backoff on failure
     * @private
     */
    _connectOne(cluster) {
        const clusterKey = cluster.host + ':' + cluster.port;

        // Cancel any pending reconnect timer for this cluster
        if (this.reconnectTimers.has(clusterKey)) {
            clearTimeout(this.reconnectTimers.get(clusterKey));
            this.reconnectTimers.delete(clusterKey);
        }

        // Remove old connection from connections array and cleanup if exists
        const oldConnection = this.connections.find(c =>
            c.cluster.host === cluster.host && c.cluster.port === cluster.port
        );

        if (oldConnection) {
            // Cleanup old connection before creating new one
            this._cleanupConnection(oldConnection);
        }

        this.connections = this.connections.filter(c =>
            !(c.cluster.host === cluster.host && c.cluster.port === cluster.port)
        );

        logConnectionState('attempting', cluster.host, 'DXCluster server for receiving spots');
        const conn = new DXCluster();

        // Track connection state to prevent double-counting
        let isConnected = false;

        try {
            conn.connect(cluster).then(() => {
                logConnectionState('connected', cluster.host, 'DXCluster server for receiving spots');
                isConnected = true;
                this.activeConnMap.set(clusterKey, true);
                this._updateActiveConnections();
                // Reset reconnect delay on successful connection
                this.reconnectDelays.delete(clusterKey);
            })
            .catch((err) => {
                logConnectionState('failed', cluster.host, 'DXCluster server for receiving spots', err);
                this.stats.reconnectAttempts++;
                this._scheduleReconnect(cluster, clusterKey);
            });

            // Event listeners for connection status changes
            conn.on('close', () => {
                if (isConnected) {
                    logConnectionState('closed', cluster.host, 'DXCluster server connection closed');
                    isConnected = false;
                    this.activeConnMap.delete(clusterKey);
                    this._updateActiveConnections();
                    this.stats.reconnectAttempts++;
                    // Connection lost - start with shorter delay for quick recovery
                    this.reconnectDelays.set(clusterKey, this.INITIAL_RECONNECT_DELAY);
                    this._scheduleReconnect(cluster, clusterKey);
                }
            });

            conn.on('timeout', () => {
                if (isConnected) {
                    logConnectionState('timeout', cluster.host, 'DXCluster server connection timed out');
                    isConnected = false;
                    this.activeConnMap.delete(clusterKey);
                    this._updateActiveConnections();
                    this.stats.reconnectAttempts++;
                    // Connection lost - start with shorter delay for quick recovery
                    this.reconnectDelays.set(clusterKey, this.INITIAL_RECONNECT_DELAY);
                    this._scheduleReconnect(cluster, clusterKey);
                }
            });

            conn.on('error', (err) => {
                if (isConnected) {
                    logConnectionState('error', cluster.host, 'DXCluster server connection error', err);
                    isConnected = false;
                    this.activeConnMap.delete(clusterKey);
                    this._updateActiveConnections();
                }
                this.stats.reconnectAttempts++;
                this._scheduleReconnect(cluster, clusterKey);
            });

            // Forward spot events to parent
            conn.on('spot', async (spot) => {
                this.stats.spotsReceived++;
                this.emit('spot', spot, cluster.cluster || 'cluster');
            });

            this.connections.push({ cluster, conn, clusterKey });
        } catch (e) {
            logConnectionState('error', cluster.host, 'DXCluster not reachable', e);
            this.stats.reconnectAttempts++;
            this._scheduleReconnect(cluster, clusterKey);
        }
    }
    
    /**
     * Update active connections count from the map
     * @private
     */
    _updateActiveConnections() {
        this.stats.activeConnections = this.activeConnMap.size;
    }

    /**
     * Internal method to cleanup connection resources and prevent memory leaks
     * Called during reconnection, shutdown, and connection failures
     * @private
     */
    _cleanupConnection(connectionObj) {
        const { conn, clusterKey } = connectionObj;
        try {
            // Remove all event listeners from DXCluster instance
            if (conn && conn.removeAllListeners) {
                conn.removeAllListeners();
            }

            // Call cleanup method on DXCluster instance if available
            if (conn && conn._cleanupResources) {
                conn._cleanupResources();
            }

            // Remove from tracking maps
            this.activeConnMap.delete(clusterKey);
            this.reconnectTimers.delete(clusterKey);
        } catch (error) {
            console.error('[Clusters] Connection cleanup error:', error);
        }
    }

    /**
     * Schedule a reconnection attempt with exponential backoff
     * @private
     */
    _scheduleReconnect(cluster, clusterKey) {
        // Cancel any existing timer for this cluster
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
        
        console.log(`[Clusters] Reconnecting to ${cluster.host} in ${delayFormatted}...`);
        
        const timerId = setTimeout(() => {
            this.reconnectTimers.delete(clusterKey);
            this._connectOne(cluster);
        }, currentDelay);
        
        this.reconnectTimers.set(clusterKey, timerId);
        
        // Increase delay for next attempt (exponential backoff with max cap)
        const nextDelay = Math.min(currentDelay * this.RECONNECT_BACKOFF_FACTOR, this.MAX_RECONNECT_DELAY);
        this.reconnectDelays.set(clusterKey, nextDelay);
    }

    /**
     * Get module status
     * @returns {Object} Status information
     */
    getStatus() {
        return {
            enabled: this.enabled,
            totalClusters: this.stats.totalClusters,
            activeConnections: this.stats.activeConnections,
            reconnectAttempts: this.stats.reconnectAttempts,
            spotsReceived: this.stats.spotsReceived
        };
    }

    /**
     * Graceful shutdown of all connections
     */
    shutdown() {
        console.log('[Clusters] Shutting down cluster connections...');

        // Cancel all pending reconnect timers
        this.reconnectTimers.forEach((timerId, clusterKey) => {
            clearTimeout(timerId);
            console.log(`[Clusters] Cancelled reconnect timer for ${clusterKey}`);
        });
        this.reconnectTimers.clear();

        // Close all connections with proper cleanup
        this.connections.forEach(({ conn, clusterKey }) => {
            try {
                // Remove all event listeners first
                if (conn && conn.removeAllListeners) {
                    conn.removeAllListeners();
                }

                // Call cleanup method on DXCluster instance if available
                if (conn && conn._cleanupResources) {
                    conn._cleanupResources();
                }
            } catch (e) {
                console.error('[Clusters] Error closing cluster connection:', e);
            }
        });

        this.connections = [];
        this.activeConnMap.clear();
        this.reconnectDelays.clear();
        this.stats.activeConnections = 0;
    }
}

module.exports = Clusters;
