/**
 * Utility Functions Library
 * Shared helper functions for connection logging, string manipulation,
 * frequency-to-band conversion, and spot timestamp utilities
 * 
 * @module lib/utils
 */

/**
 * Logs connection state changes for DX Cluster connections
 * @param {string} state - The state of the connection (attempting, connected, failed, error, closed, timeout).
 * @param {string} server - The server being connected to.
 * @param {string} reason - The reason for the connection.
 * @param {Error} [error=null] - Optional error object for logging.
 */
function logConnectionState(state, server = '', reason = '', error = null) {
    const timestamp = new Date().toISOString();
    const serverInfo = typeof server === 'object' ? `${server.host}:${server.port}` : server;

    if (state === 'failed' || state === 'error') {
        console.error(`[${timestamp}] - Error while connecting to ${serverInfo}:`, error);
    } else if (state === 'attempting') {
        // Only log on first attempt, not on reconnects (too verbose)
        // console.log(`[${timestamp}] - Attempting to connect to ${serverInfo}`);
    } else if (state === 'connected') {
        console.log(`[${timestamp}] - Successfully connected to ${serverInfo}`);
    } else if (state === 'closed') {
        console.log(`[${timestamp}] - Connection to ${serverInfo} closed, reconnecting...`);
    } else if (state === 'timeout') {
        console.log(`[${timestamp}] - Connection to ${serverInfo} timed out, reconnecting...`);
    }
}

/**
 * Converts a string to title case (capitalize each word).
 * @param {string} string - The input string to convert.
 * @returns {string} - The title-cased string.
 */
function toUcWord(string) {
    let words = string.toLowerCase().split(" ");
    for (let i = 0; i < words.length; i++) {
        words[i] = words[i][0].toUpperCase() + words[i].substr(1);
    }
    return words.join(" ");
}

/**
 * Maps frequency (in Hz) to corresponding amateur radio bands.
 * Covers HF, VHF, UHF, and microwave bands.
 * @param {number} frequency - Frequency in Hz.
 * @returns {string} - The corresponding amateur radio band (e.g., "20m", "2m") or empty string if not in ham band.
 */
function qrg2band(frequency) {
    // HF Bands
    if (frequency >= 1800000 && frequency <= 2000000) return "160m";
    if (frequency >= 3500000 && frequency <= 4000000) return "80m";
    if (frequency >= 5330000 && frequency <= 5405000) return "60m";  // 60m band (5 MHz)
    if (frequency >= 7000000 && frequency <= 7300000) return "40m";
    if (frequency >= 10100000 && frequency <= 10150000) return "30m";
    if (frequency >= 14000000 && frequency <= 14350000) return "20m";
    if (frequency >= 18068000 && frequency <= 18168000) return "17m";
    if (frequency >= 21000000 && frequency <= 21450000) return "15m";
    if (frequency >= 24890000 && frequency <= 24990000) return "12m";
    if (frequency >= 28000000 && frequency <= 29700000) return "10m";
    
    // VHF Bands
    if (frequency >= 50000000 && frequency <= 54000000) return "6m";
    if (frequency >= 70000000 && frequency <= 71000000) return "4m";
    if (frequency >= 144000000 && frequency <= 148000000) return "2m";
    
    // UHF Bands
    if (frequency >= 219000000 && frequency <= 225000000) return "1.25m";
    if (frequency >= 420000000 && frequency <= 450000000) return "70cm";
    
    // Microwave Bands
    if (frequency >= 902000000 && frequency <= 928000000) return "33cm";
    if (frequency >= 1240000000 && frequency <= 1300000000) return "23cm";
    if (frequency >= 2300000000 && frequency <= 2450000000) return "13cm";
    if (frequency >= 3300000000 && frequency <= 3500000000) return "9cm";
    if (frequency >= 5650000000 && frequency <= 5925000000) return "6cm";
    if (frequency >= 10000000000 && frequency <= 10500000000) return "3cm";
    if (frequency >= 24000000000 && frequency <= 24250000000) return "1.2cm";
    if (frequency >= 47000000000 && frequency <= 47200000000) return "6mm";
    if (frequency >= 75500000000 && frequency <= 81000000000) return "4mm";
    if (frequency >= 122250000000 && frequency <= 123000000000) return "2.5mm";
    if (frequency >= 134000000000 && frequency <= 141000000000) return "2mm";
    if (frequency >= 241000000000 && frequency <= 250000000000) return "1mm";
    if (frequency >= 250000000000) return "<1mm";
    
    return "";  // Not in amateur radio band
}

/**
 * Retrieves the most recent spot timestamp from an array.
 * @param {Array} spotArray - Array of spot objects with 'when' timestamps.
 * @returns {string} - The ISO timestamp of the most recent spot, or epoch time if array is empty.
 */
function getFreshestSpot(spotArray) {
    if (!spotArray || spotArray.length === 0) {
        return new Date('1970-01-01T00:00:00.000Z').toISOString();
    }
    
    let youngest = 0;
    spotArray.forEach((spot) => {
        if (spot && spot.when) {
            const timestamp = Date.parse(spot.when);
            if (!isNaN(timestamp) && timestamp > youngest) {
                youngest = timestamp;
            }
        }
    });
    
    return youngest > 0 ? new Date(youngest).toISOString() : new Date('1970-01-01T00:00:00.000Z').toISOString();
}

/**
 * Retrieves the oldest spot timestamp from an array.
 * @param {Array} spotArray - Array of spot objects with 'when' timestamps.
 * @returns {string} - The ISO timestamp of the oldest spot, or far-future time if array is empty.
 */
function getOldestSpot(spotArray) {
    if (!spotArray || spotArray.length === 0) {
        return new Date('2099-12-31T23:59:59.999Z').toISOString();
    }
    
    let oldest = Date.now();
    spotArray.forEach((spot) => {
        if (spot && spot.when) {
            const timestamp = Date.parse(spot.when);
            if (!isNaN(timestamp) && timestamp < oldest) {
                oldest = timestamp;
            }
        }
    });
    
    return new Date(oldest).toISOString();
}

/**
 * Sleep/delay utility function for async operations.
 * Returns a promise that resolves after the specified delay.
 * @param {number} delay - Delay in milliseconds.
 * @returns {Promise} - Promise that resolves after the delay.
 */
function sleepNow(delay) {
    return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Calculates allowed frequency deviation for spot deduplication based on mode.
 * FT8/FT4 allow ±3 kHz due to in-band frequency changes and receiver drift.
 * Other modes allow ±1 kHz for standard deviation.
 * @param {string} mode - Operating mode (e.g., "FT8", "FT4", "CW", "SSB").
 * @returns {number} - Allowed frequency deviation in kHz.
 */
function getAllowedDeviation(mode) {
    const upperMode = (mode || "").toUpperCase();
    switch (upperMode) {
        case "FT8":
        case "FT4":
            return 3; // ±3 kHz for FT8/FT4
        default:
            return 1; // ±1 kHz for other modes
    }
}

/**
 * Converts frequency from MHz to kHz.
 * SOTA API provides frequencies in MHz (e.g., "10.111"), this converts to kHz.
 * @param {string|number} freqMHz - Frequency in MHz.
 * @returns {number} - Frequency in kHz, or NaN if invalid.
 */
function toKHz(freqMHz) {
    const mhz = Number(freqMHz);
    if (Number.isFinite(mhz)) {
        return Math.round(mhz * 1000); // Convert to kHz
    }
    return NaN;
}

/**
 * Converts frequency from kHz to MHz.
 * @param {number} freqKHz - Frequency in kHz.
 * @returns {number} - Frequency in MHz, or NaN if invalid.
 */
function toMHz(freqKHz) {
    const khz = Number(freqKHz);
    if (Number.isFinite(khz)) {
        return khz / 1000; // Convert to MHz
    }
    return NaN;
}

module.exports = {
    logConnectionState,
    toUcWord,
    qrg2band,
    getFreshestSpot,
    getOldestSpot,
    sleepNow,
    getAllowedDeviation,
    toKHz,
    toMHz
};
