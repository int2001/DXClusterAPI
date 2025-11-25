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
        this.stats = {
            totalClusters: clusters.length,
            activeConnections: 0,
            reconnectAttempts: 0,
            spotsReceived: 0
        };
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
     * Connect to a single cluster
     * @private
     */
    _connectOne(cluster) {
        logConnectionState('attempting', cluster.host, 'DXCluster server for receiving spots');
        const conn = new DXCluster();
        
        try {
            conn.connect(cluster).then(() => {
                logConnectionState('connected', cluster.host, 'DXCluster server for receiving spots');
                this.stats.activeConnections++;
            })
            .catch((err) => {
                logConnectionState('failed', cluster.host, 'DXCluster server for receiving spots', err);
                this.stats.reconnectAttempts++;
                this._connectOne(cluster);
            });

            // Event listeners for connection status changes
            conn.on('close', () => {
                logConnectionState('closed', cluster.host, 'DXCluster server connection closed');
                this.stats.activeConnections--;
                this.stats.reconnectAttempts++;
                this._connectOne(cluster);
            });

            conn.on('timeout', () => {
                logConnectionState('timeout', cluster.host, 'DXCluster server connection timed out');
                this.stats.activeConnections--;
                this.stats.reconnectAttempts++;
                this._connectOne(cluster);
            });

            conn.on('error', (err) => {
                logConnectionState('error', cluster.host, 'DXCluster server connection error', err);
                this.stats.activeConnections--;
                this.stats.reconnectAttempts++;
                this._connectOne(cluster);
            });

            // Forward spot events to parent
            conn.on('spot', async (spot) => {
                this.stats.spotsReceived++;
                this.emit('spot', spot, cluster.cluster || 'cluster');
            });

            this.connections.push({ cluster, conn });
        } catch (e) {
            logConnectionState('error', cluster.host, 'DXCluster not reachable', e);
            this.stats.reconnectAttempts++;
        }
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
        this.connections.forEach(({ conn }) => {
            try {
                conn.removeAllListeners();
                // If DXCluster module has a disconnect/close method, call it here
            } catch (e) {
                console.error('[Clusters] Error closing cluster connection:', e);
            }
        });
        this.connections = [];
        this.stats.activeConnections = 0;
    }
}

module.exports = Clusters;
