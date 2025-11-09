/**
 * API v1 Module (Legacy)
 * Provides backward-compatible REST endpoints for DX Cluster spots
 * This module maintains the original API structure for existing integrations
 * 
 * @module apiv1
 */

const express = require('express');

class APIv1 {
    constructor(config, getSpotsData, getIndexes) {
        this.config = config;
        this.getSpotsData = getSpotsData;
        this.getIndexes = getIndexes;
    }

    /**
     * Retrieves a single spot for a given frequency
     * @param {number} qrg - The frequency in kHz
     * @returns {object} - The spot object or empty object if not found
     */
    getSingleSpot(qrg) {
        const { frequencyIndex } = this.getIndexes();
        const spot = frequencyIndex.get(qrg * 1);
        return spot || {};
    }

    /**
     * Retrieves all spots for a given band
     * @param {string} band - The band to search for
     * @returns {array} - An array of spots for the given band
     */
    getBandSpots(band) {
        const { bandIndex } = this.getIndexes();
        const spotSet = bandIndex.get(band);
        return spotSet ? Array.from(spotSet) : [];
    }

    /**
     * Retrieves all spots for a given source
     * @param {string} source - The source to search for
     * @returns {array} - An array of spots for the given source
     */
    getSourceSpots(source) {
        const { sourceIndex } = this.getIndexes();
        const spotSet = sourceIndex.get(source);
        return spotSet ? Array.from(spotSet) : [];
    }

    /**
     * Gets the list of API v1 endpoints
     * @returns {object} - Object with endpoint paths
     */
    getEndpoints() {
        const baseUrl = this.config.baseUrl || '';
        return {
            spots: baseUrl + '/spots',
            spotsByBand: baseUrl + '/spots/:band',
            spotsBySource: baseUrl + '/spots/source/:source',
            spotByFrequency: baseUrl + '/spot/:qrg',
            stats: baseUrl + '/stats'
        };
    }

    /**
     * Creates Express router with API v1 endpoints
     * @param {Function} rateLimiter - Optional rate limiter middleware for spot endpoints
     * @returns {express.Router} - Express router with mounted endpoints
     */
    createRouter(rateLimiter) {
        const router = express.Router();
        const baseUrl = this.config.baseUrl || '';

        // Middleware to extract X-Client-ID header for analytics
        router.use((req, res, next) => {
            const clientId = req.headers['x-client-id'];
            if (clientId) {
                req.clientId = clientId;
            }
            next();
        });

        /**
         * GET /spot/:qrg - Retrieve the latest spot for a given frequency (QRG in kHz)
         */
        router.get(baseUrl + '/spot/:qrg', rateLimiter || ((req, res, next) => next()), (req, res) => {
            const qrg = req.params.qrg;
            const single_spot = this.getSingleSpot(qrg);
            res.json(single_spot);
        });

        /**
         * GET /spots - Retrieve all cached spots
         */
        router.get(baseUrl + '/spots', rateLimiter || ((req, res, next) => next()), (req, res) => {
            const spots = this.getSpotsData();
            res.json(spots);
        });

        /**
         * GET /spots/:band - Retrieve all cached spots for a given band
         */
        router.get(baseUrl + '/spots/:band', rateLimiter || ((req, res, next) => next()), (req, res) => {
            const bandspots = this.getBandSpots(req.params.band);
            res.json(bandspots);
        });

        /**
         * GET /spots/source/:source - Retrieve all cached spots from a given source
         */
        router.get(baseUrl + '/spots/source/:source', rateLimiter || ((req, res, next) => next()), (req, res) => {
            const sourcespots = this.getSourceSpots(req.params.source);
            res.json(sourcespots);
        });

        return router;
    }
}

module.exports = APIv1;
