/**
 * Metrics Module
 * Provides Prometheus metrics for monitoring the DXClusterAPI application
 * Tracks HTTP request duration, spot cache size, WebSocket connections,
 * cluster connection status, and spots by band
 * 
 * @module metrics
 */

"use strict";

const promClient = require('prom-client');

class Metrics {
    /**
     * Initialize the Metrics module
     * @param {Object} config - Configuration object
     * @param {boolean} config.enabled - Whether metrics are enabled
     * @param {Function} config.getSpotsData - Function to get current spots
     * @param {Function} config.getClusterStatus - Function to get cluster connection status
     * @param {Function} config.getWebSocketClients - Function to get WebSocket client count
     */
    constructor(config) {
        this.enabled = config.enabled !== false; // Default to enabled
        this.getSpotsData = config.getSpotsData;
        this.getClusterStatus = config.getClusterStatus;
        this.getWebSocketClients = config.getWebSocketClients;

        if (!this.enabled) {
            console.log('Metrics module disabled');
            return;
        }

        // Create a Registry to register metrics
        this.register = new promClient.Registry();

        // Add default metrics (CPU, memory, event loop, etc.)
        promClient.collectDefaultMetrics({ register: this.register });

        // Initialize custom metrics
        this.initializeMetrics();

        console.log('Metrics module initialized');
    }

    /**
     * Initialize custom Prometheus metrics
     */
    initializeMetrics() {
        // HTTP request duration histogram
        this.httpRequestDuration = new promClient.Histogram({
            name: 'http_request_duration_seconds',
            help: 'Duration of HTTP requests in seconds',
            labelNames: ['method', 'route', 'status_code'],
            buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5]
        });
        this.register.registerMetric(this.httpRequestDuration);

        // Total number of spots cached
        this.spotsTotal = new promClient.Gauge({
            name: 'dxcluster_spots_total',
            help: 'Total number of spots currently cached'
        });
        this.register.registerMetric(this.spotsTotal);

        // WebSocket connections
        this.websocketConnections = new promClient.Gauge({
            name: 'dxcluster_websocket_connections',
            help: 'Number of active WebSocket connections'
        });
        this.register.registerMetric(this.websocketConnections);

        // Cluster connections by status
        this.clusterConnections = new promClient.Gauge({
            name: 'dxcluster_cluster_connections',
            help: 'Number of DX cluster connections',
            labelNames: ['cluster', 'status']
        });
        this.register.registerMetric(this.clusterConnections);

        // Spots by band
        this.spotsByBand = new promClient.Gauge({
            name: 'dxcluster_spots_by_band',
            help: 'Number of spots by band',
            labelNames: ['band']
        });
        this.register.registerMetric(this.spotsByBand);
    }

    /**
     * Express middleware to track HTTP request duration
     * @returns {Function} Express middleware function
     */
    middleware() {
        if (!this.enabled) {
            return (req, res, next) => next();
        }

        return (req, res, next) => {
            const start = Date.now();
            res.on('finish', () => {
                const duration = (Date.now() - start) / 1000;
                const route = req.route ? req.route.path : req.url;
                this.httpRequestDuration
                    .labels(req.method, route, res.statusCode)
                    .observe(duration);
            });
            next();
        };
    }

    /**
     * Update all custom metrics with current values
     */
    updateMetrics() {
        if (!this.enabled) {
            return;
        }

        // Update spots total
        if (this.getSpotsData) {
            const spots = this.getSpotsData();
            this.spotsTotal.set(spots.length);

            // Update spots by band
            const bandCounts = {};
            spots.forEach(spot => {
                const band = spot.band || 'unknown';
                bandCounts[band] = (bandCounts[band] || 0) + 1;
            });

            // Reset all band labels first to clear old bands
            this.spotsByBand.reset();
            
            // Set new values
            Object.entries(bandCounts).forEach(([band, count]) => {
                this.spotsByBand.labels(band).set(count);
            });
        }

        // Update WebSocket connections
        if (this.getWebSocketClients) {
            const clientCount = this.getWebSocketClients();
            this.websocketConnections.set(clientCount);
        }

        // Update cluster connection status
        if (this.getClusterStatus) {
            const clusterStatus = this.getClusterStatus();
            if (clusterStatus && clusterStatus.clusters) {
                clusterStatus.clusters.forEach(cluster => {
                    this.clusterConnections
                        .labels(cluster.name, cluster.connected ? 'connected' : 'disconnected')
                        .set(cluster.connected ? 1 : 0);
                });
            }
        }
    }

    /**
     * Get metrics in Prometheus format
     * @returns {Promise<string>} Prometheus metrics
     */
    async getMetrics() {
        if (!this.enabled) {
            throw new Error('Metrics are disabled');
        }

        // Update metrics before returning
        this.updateMetrics();

        return await this.register.metrics();
    }

    /**
     * Get metrics content type for HTTP response
     * @returns {string} Content-Type header value
     */
    getContentType() {
        return this.register.contentType;
    }

    /**
     * Get module status
     * @returns {Object} Status information
     */
    getStatus() {
        return {
            enabled: this.enabled,
            metricsAvailable: this.enabled,
            endpoint: '/metrics'
        };
    }
}

module.exports = Metrics;
