/**
 * Rate Limiter Module
 * Provides configurable rate limiting for API endpoints to prevent abuse and DDoS attacks
 * Implements different rate limits for general endpoints and data-heavy endpoints
 * 
 * @module rate-limiter
 */

"use strict";

const rateLimit = require('express-rate-limit');

class RateLimiter {
    /**
     * Initialize the Rate Limiter module
     * @param {Object} config - Configuration object
     * @param {boolean} config.enabled - Whether rate limiting is enabled
     * @param {number} config.generalWindow - Time window for general limiter in ms (default: 60000)
     * @param {number} config.generalMax - Max requests for general limiter (default: 120)
     * @param {number} config.dataWindow - Time window for data limiter in ms (default: 60000)
     * @param {number} config.dataMax - Max requests for data limiter (default: 60)
     * @param {number} config.banTimeMs - Ban duration in ms when limit exceeded (default: same as windowMs)
     * @param {Array<string>} config.exemptPaths - Paths to exempt from rate limiting
     * @param {boolean} config.trustProxy - Whether running behind a proxy
     */
    constructor(config = {}) {
        this.enabled = config.enabled !== false; // Default to enabled
        this.exemptPaths = config.exemptPaths || ['/health', '/metrics'];
        this.trustProxy = config.trustProxy !== false; // Default to true

        // Store configuration values for status reporting
        this.generalMax = config.generalMax || 120;
        this.dataMax = config.dataMax || 60;
        this.banTimeMs = config.banTimeMs || 60 * 1000; // Default to 1 minute ban
        this.generalWindow = config.generalWindow || 60 * 1000; // 1 minute window
        this.dataWindow = config.dataWindow || 60 * 1000; // 1 minute window

        if (!this.enabled) {
            console.log('[RateLimiter] Module disabled');
            return;
        }

        // Base configuration for rate limiters
        const baseLimiterConfig = {
            standardHeaders: true,
            legacyHeaders: false,
        };

        // Add proxy-aware configuration if trust proxy is enabled
        if (this.trustProxy) {
            // Use the leftmost IP in X-Forwarded-For (the real client IP)
            baseLimiterConfig.validate = { trustProxy: false };  // Disable express-rate-limit validation
        }

        // General rate limiter for most endpoints
        this.generalLimiter = rateLimit({
            ...baseLimiterConfig,
            windowMs: this.banTimeMs, // Use ban time as window - when exceeded, client waits this long
            max: this.generalMax,
            message: { error: `Too many requests. Try again after ${Math.ceil(this.banTimeMs / 1000)} seconds` },
            skip: (req) => this.shouldSkip(req)
        });

        // Stricter rate limiter for data endpoints (clients typically poll every 59 seconds)
        this.dataLimiter = rateLimit({
            ...baseLimiterConfig,
            windowMs: this.banTimeMs, // Use ban time as window - when exceeded, client waits this long
            max: this.dataMax,
            message: { error: `Too many spot requests. Try again after ${Math.ceil(this.banTimeMs / 1000)} seconds` },
            skip: (req) => this.shouldSkip(req)
        });

        console.log(`[RateLimiter] Initialized - General: ${this.generalMax}/min, Data: ${this.dataMax}/min, Ban: ${Math.ceil(this.banTimeMs / 1000)}s`);
    }

    /**
     * Check if request should skip rate limiting
     * @param {Object} req - Express request object
     * @returns {boolean} True if should skip
     */
    shouldSkip(req) {
        if (!this.enabled) {
            return true;
        }

        // Check if path is in exempt list
        return this.exemptPaths.some(path => req.url.startsWith(path));
    }

    /**
     * Get general rate limiter middleware
     * @returns {Function} Express middleware function
     */
    getGeneralLimiter() {
        if (!this.enabled) {
            return (req, res, next) => next();
        }
        return this.generalLimiter;
    }

    /**
     * Get data rate limiter middleware (for spot endpoints)
     * @returns {Function} Express middleware function
     */
    getDataLimiter() {
        if (!this.enabled) {
            return (req, res, next) => next();
        }
        return this.dataLimiter;
    }

    /**
     * Create middleware that applies general limiter except to exempt paths
     * @param {string} baseUrl - Base URL to check against exempt paths
     * @returns {Function} Express middleware function
     */
    middleware(baseUrl = '') {
        if (!this.enabled) {
            return (req, res, next) => next();
        }

        return (req, res, next) => {
            // Check if path should be exempt
            const shouldExempt = this.exemptPaths.some(path => 
                req.url.startsWith(baseUrl + path)
            );

            if (shouldExempt) {
                return next();
            }

            this.generalLimiter(req, res, next);
        };
    }

    /**
     * Get module status
     * @returns {Object} Status information
     */
    getStatus() {
        return {
            enabled: this.enabled,
            generalLimit: this.enabled ? `${this.generalMax} requests/minute` : 'disabled',
            dataLimit: this.enabled ? `${this.dataMax} requests/minute` : 'disabled',
            banTime: this.enabled ? `${Math.ceil(this.banTimeMs / 1000)} seconds` : 'disabled',
            exemptPaths: this.exemptPaths
        };
    }
}

module.exports = RateLimiter;
