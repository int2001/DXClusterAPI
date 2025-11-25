/**
 * Persistence Module
 * Saves spot cache to disk periodically and restores on startup
 * 
 * @module persistence
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Save spots cache to disk
 * Uses atomic write (temp file + rename) to prevent corruption
 * 
 * @param {Array} spots - Array of spot objects to save
 * @param {string} filePath - Path to cache file
 * @returns {Promise<Object>} - Save result with success flag and stats
 */
async function saveCache(spots, filePath) {
    try {
        const startTime = Date.now();
        
        // Prepare cache data with metadata
        const cacheData = {
            version: '1.0',
            timestamp: Date.now(),
            spotCount: spots.length,
            spots: spots
        };
        
        // Write to temporary file first (atomic write pattern)
        const tempPath = filePath + '.tmp';
        const jsonData = JSON.stringify(cacheData, null, 0); // No formatting for smaller file
        
        await fs.writeFile(tempPath, jsonData, 'utf8');
        
        // Atomic rename (overwrites existing file)
        await fs.rename(tempPath, filePath);
        
        const duration = Date.now() - startTime;
        const fileSize = Buffer.byteLength(jsonData, 'utf8');
        
        return {
            success: true,
            spotCount: spots.length,
            fileSize: fileSize,
            duration: duration,
            timestamp: cacheData.timestamp
        };
        
    } catch (error) {
        console.error('[Persistence] Failed to save cache:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Load spots cache from disk
 * Validates data structure and filters expired spots
 * 
 * @param {string} filePath - Path to cache file
 * @param {number} spotMaxAge - Maximum spot age in minutes
 * @returns {Promise<Object>} - Load result with spots array and stats
 */
async function loadCache(filePath, spotMaxAge) {
    try {
        const startTime = Date.now();
        
        // Check if file exists
        try {
            await fs.access(filePath);
        } catch {
            console.log('[Persistence] No cache file found, starting with empty cache');
            return {
                success: true,
                spots: [],
                loaded: 0,
                expired: 0,
                fromCache: false
            };
        }
        
        // Read and parse cache file
        const jsonData = await fs.readFile(filePath, 'utf8');
        const cacheData = JSON.parse(jsonData);
        
        // Validate cache structure
        if (!cacheData.spots || !Array.isArray(cacheData.spots)) {
            console.warn('[Persistence] Invalid cache structure, starting with empty cache');
            return {
                success: false,
                spots: [],
                loaded: 0,
                expired: 0,
                error: 'Invalid cache structure'
            };
        }
        
        // Filter expired spots
        const now = Date.now();
        const maxAgeMs = spotMaxAge * 60 * 1000;
        const validSpots = cacheData.spots.filter(spot => {
            // spot.when is ISO string in UTC (e.g., "2025-11-25T22:41:00.000Z")
            const spotTimestamp = Date.parse(spot.when);
            const spotAge = now - spotTimestamp;
            return spotAge <= maxAgeMs;
        });
        
        const expiredCount = cacheData.spots.length - validSpots.length;
        const duration = Date.now() - startTime;
        
        console.log(`[Persistence] Loaded ${validSpots.length} spots from cache (${expiredCount} expired, ${duration}ms)`);
        console.log(`[Persistence] Cache was saved: ${new Date(cacheData.timestamp).toISOString()}`);
        
        return {
            success: true,
            spots: validSpots,
            loaded: validSpots.length,
            expired: expiredCount,
            cacheAge: now - cacheData.timestamp,
            duration: duration,
            fromCache: true
        };
        
    } catch (error) {
        console.error('[Persistence] Failed to load cache:', error.message);
        return {
            success: false,
            spots: [],
            loaded: 0,
            expired: 0,
            error: error.message
        };
    }
}

/**
 * Start automatic cache saving on interval
 * 
 * @param {Function} getSpotsFunction - Function that returns current spots array
 * @param {number} intervalSeconds - Save interval in seconds
 * @param {string} filePath - Path to cache file
 * @returns {Object} - Control object with stop() method and stats
 */
function startAutoSave(getSpotsFunction, intervalSeconds, filePath) {
    let lastSaveResult = null;
    let saveCount = 0;
    
    const intervalId = setInterval(async () => {
        try {
            const spots = getSpotsFunction();
            
            // Skip save if no spots
            if (spots.length === 0) {
                return;
            }
            
            lastSaveResult = await saveCache(spots, filePath);
            
            if (lastSaveResult.success) {
                saveCount++;
                // Log only every 10 saves to reduce noise
                if (saveCount % 10 === 0) {
                    console.log(`[Persistence] Auto-save #${saveCount}: ${lastSaveResult.spotCount} spots, ${(lastSaveResult.fileSize / 1024).toFixed(1)}KB, ${lastSaveResult.duration}ms`);
                }
            }
        } catch (error) {
            console.error('[Persistence] Auto-save error:', error.message);
        }
    }, intervalSeconds * 1000);
    
    console.log(`[Persistence] Auto-save started (every ${intervalSeconds}s)`);
    
    return {
        stop: () => {
            clearInterval(intervalId);
            console.log(`[Persistence] Auto-save stopped (${saveCount} saves completed)`);
        },
        getStats: () => ({
            saveCount: saveCount,
            lastSave: lastSaveResult,
            intervalSeconds: intervalSeconds
        })
    };
}

module.exports = {
    saveCache,
    loadCache,
    startAutoSave
};
