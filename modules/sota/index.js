/**
 * Summits On The Air (SOTA) Module
 * Polls SOTA API for real-time summit activation spots
 * 
 * @module sota
 */

"use strict";

const events = require("events");
const { sleepNow, getAllowedDeviation, toKHz, normalizeFrequency } = require('../../lib/utils');

// Prefer global fetch (Node 18+) or fall back to node-fetch
const fetch = (global.fetch ? global.fetch : require("node-fetch"));

module.exports = class SOTASpots extends events.EventEmitter {
  constructor(opts = {}) {
    super();
    this.sotapollinterval = Math.max(30, Number(opts.sotapollinterval || 120)); // seconds
    this.sotaspotcache = new Map(); // Changed to Map for O(1) lookups: key = spotted_freq_mode
    this.MAX_CACHE_SIZE = 500; // Limit cache size to prevent unbounded growth
    this.apiUrl = "https://api2.sota.org.uk/api/spots/25/all";
    
    // Exponential backoff settings for API failures
    this.INITIAL_BACKOFF = 5000;        // 5 seconds
    this.MAX_BACKOFF = 300000;          // 5 minutes max
    this.BACKOFF_FACTOR = 2;
    this.currentBackoff = 0;            // 0 = no backoff active
    this.consecutiveErrors = 0;
  }

  /**
   * Start polling loop
   */
  async run(opts = {}) {
    while (true) {
      // wait between polls (or backoff if in error state)
      const waitTime = this.currentBackoff > 0 
          ? this.currentBackoff 
          : this.sotapollinterval * 1000;
      await sleepNow(waitTime);

      try {
        // 10s timeout with AbortController
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(this.apiUrl, { signal: controller.signal });
        clearTimeout(t);

        if (!res.ok) throw new Error(`HTTP error: ${res.status}`);

        /** @type {Array} */
        const rawspots = await res.json();
        
        // Safety: Validate response is array
        if (!Array.isArray(rawspots)) {
          console.warn('[SOTA] Invalid API response: not an array');
          continue;
        }

        const currentSpots = new Map();
        for (const item of rawspots) {
          // Safety: Validate item is object with required fields
          if (!item || typeof item !== 'object') continue;
          if (!item.callsign || !item.activatorCallsign || !item.frequency) continue;
          
          // Safety: Validate callsigns
          const callsignRegex = /^[A-Z0-9\/\-]{3,20}$/i;
          const spotter = String(item.callsign || '').trim().substring(0, 20);
          const spotted = String(item.activatorCallsign || '').trim().substring(0, 20);
          if (!callsignRegex.test(spotter) || !callsignRegex.test(spotted)) continue;
          
          // Safety: Sanitize text fields
          const mode = String(item.mode || '').replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim().substring(0, 20);
          const assoc = String(item.associationCode || '').replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim().substring(0, 10);
          const summit = String(item.summitCode || '').replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim().substring(0, 20);
          const summitDetails = String(item.summitDetails || '').replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim().substring(0, 100);
          const comments = String(item.comments || '').replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim().substring(0, 200);

          // SOTA API provides MHz strings like "10.111"
          const freqKHz = toKHz(item.frequency);
          
          // Normalize frequency to consistent kHz format (1 decimal place)
          // Fixes issue from Wavelog PR #2514: inconsistent frequency format
          const normalizedFreq = normalizeFrequency(freqKHz);

          // Safety: Validate frequency range (30 kHz to 300 GHz)
          if (isNaN(normalizedFreq) || normalizedFreq < 30 || normalizedFreq > 300000000) continue;

          // Safety: Validate and sanitize timestamp
          const ts = String(item.timeStamp || '').trim();
          if (!ts) continue;
          const when = ts.endsWith('Z') ? new Date(ts) : new Date(ts + 'Z');
          if (isNaN(when.getTime())) continue; // Invalid date

          // Build message with fallback to ensure it's never empty
          const summitRef = (assoc && summit) ? `${assoc}/${summit}` : `${assoc}${summit}`;
          let messageParts = [];
          if (mode) messageParts.push(mode);
          if (summitRef) messageParts.push(summitRef);
          if (summitDetails) messageParts.push(summitDetails);
          if (comments) messageParts.push(`(${comments})`);
          
          // Ensure message is never completely empty
          const msg = messageParts.length > 0 ? messageParts.join(' ') : `SOTA ${summitRef || 'Activation'}`;

          const dxSpot = {
            spotter,
            spotted,
            frequency: normalizedFreq,              // kHz with 1 decimal consistency
            message: msg,
            when: when,  // ISO timestamp from SOTA
            additional_data: {
              sota_ref: summitRef || "",
              sota_mode: mode
            }
          };

          // Create unique key for this spot
          const deviation = getAllowedDeviation(mode);
          const freqKey = Math.round(normalizedFreq / deviation) * deviation;
          const spotKey = `${spotted}_${freqKey}_${mode}`;
          
          // Add to current spots Map
          currentSpots.set(spotKey, dxSpot);

          // dedupe against previous cycle
          if (!this.sotaspotcache.has(spotKey)) {
            this.emit("spot", dxSpot);
          }
        }

        // Replace cache with the latest snapshot
        this.sotaspotcache = currentSpots;
        
        // Enforce cache size limit
        if (this.sotaspotcache.size > this.MAX_CACHE_SIZE) {
          // Remove oldest entries (first entries in Map)
          const toRemove = this.sotaspotcache.size - this.MAX_CACHE_SIZE;
          let removed = 0;
          for (const key of this.sotaspotcache.keys()) {
            if (removed >= toRemove) break;
            this.sotaspotcache.delete(key);
            removed++;
          }
        }
        
        // Success - reset backoff
        if (this.consecutiveErrors > 0) {
          console.log(`[SOTA] API recovered after ${this.consecutiveErrors} consecutive errors`);
        }
        this.consecutiveErrors = 0;
        this.currentBackoff = 0;
        
      } catch (err) {
        // Increment error count and calculate backoff
        this.consecutiveErrors++;
        
        if (this.currentBackoff === 0) {
          this.currentBackoff = this.INITIAL_BACKOFF;
        } else {
          this.currentBackoff = Math.min(this.currentBackoff * this.BACKOFF_FACTOR, this.MAX_BACKOFF);
        }
        
        const nextRetrySeconds = Math.round(this.currentBackoff / 1000);
        console.error(`[SOTA] Fetch failed (attempt ${this.consecutiveErrors}, retry in ${nextRetrySeconds}s): ${err.message || err}`);
      }
    }
  }
};
