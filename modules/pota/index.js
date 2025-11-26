/**
 * Parks On The Air (POTA) Module
 * Polls POTA API for real-time park activation spots
 * 
 * @module pota
 */

const events = require('events');
const { sleepNow, getAllowedDeviation, normalizeFrequency } = require('../../lib/utils');

module.exports = class POTASpots extends events.EventEmitter {
  
  //constructor
  constructor(opts = {}) {
    super();
    this.potapollinterval = Math.max(30, (opts.potapollinterval || 120)); // Default to 120 seconds, 30 seconds minimum
    this.potaspotcache = new Map(); // Changed to Map for O(1) lookups: key = spotted_freq_mode
    this.MAX_CACHE_SIZE = 500; // Limit cache size to prevent unbounded growth
    
    // Exponential backoff settings for API failures
    this.INITIAL_BACKOFF = 5000;        // 5 seconds
    this.MAX_BACKOFF = 300000;          // 5 minutes max
    this.BACKOFF_FACTOR = 2;
    this.currentBackoff = 0;            // 0 = no backoff active
    this.consecutiveErrors = 0;
    
    // Circuit breaker: stop retrying after too many consecutive failures
    this.MAX_CONSECUTIVE_ERRORS = 50;   // Stop after 50 failures (~4 hours at max backoff)
    this.circuitOpen = false;
  }

  //continuously poll POTA API, determine new spots and emit those to event listeners
  async run(opts = {}) {
	  while (true) {
		  // Circuit breaker: stop if too many consecutive errors
		  if (this.circuitOpen) {
		      console.error('[POTA] Circuit breaker OPEN - too many consecutive failures. Stopping polling.');
		      this.emit('circuit_open', { consecutiveErrors: this.consecutiveErrors });
		      return; // Exit the loop
		  }

		  //Wait for the polling interval (or backoff if in error state)
		  const waitTime = this.currentBackoff > 0 
		      ? this.currentBackoff 
		      : this.potapollinterval * 1000;
		  await sleepNow(waitTime);

		  //cache variable
		  const currentSpots = new Map();

		  //Try to get data from POTA API
		  try {

			  //fetch api response, 10s timeout
			  const response = await fetch('https://api.pota.app/spot/activator', { signal: AbortSignal.timeout(10000) });
			  if (!response.ok) throw new Error('HTTP error');

			  //get json from response
			  let rawspots = await response.json();
			  
			  // Safety: Validate response is array
			  if (!Array.isArray(rawspots)) {
				  console.warn('[POTA] Invalid API response: not an array');
				  continue;
			  }

			  //iterate through each spot
			  rawspots.forEach((item, index) => {
				  // Safety: Validate required fields exist
				  if (!item || typeof item !== 'object') return;
				  if (!item.spotter || !item.activator || !item.frequency) return;
				  
				  // Safety: Validate callsigns (alphanumeric, slashes, hyphens only)
				  const callsignRegex = /^[A-Z0-9\/\-]{3,20}$/i;
				  if (!callsignRegex.test(String(item.spotter).trim())) return;
				  if (!callsignRegex.test(String(item.activator).trim())) return;
				  
				  // Normalize frequency to consistent kHz format (1 decimal place)
				  // Fixes issue from Wavelog PR #2514: inconsistent frequency format
				  const freq = normalizeFrequency(item.frequency);
				  
				  // Safety: Validate frequency range
				  if (isNaN(freq) || freq < 30 || freq > 300000000) return;
				  
				  // Safety: Sanitize text fields
				  const mode = String(item.mode || '').replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim().substring(0, 20);
				  const name = String(item.name || '').replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim().substring(0, 100);
				  const locationDesc = String(item.locationDesc || '').replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim().substring(0, 100);
				  const reference = String(item.reference || '').replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim().substring(0, 20);
				  
				  // Build message with fallback to reference if name/location are empty
				  let messageParts = [];
				  if (mode) messageParts.push(mode);
				  if (name) {
					  messageParts.push(name);
				  } else if (reference) {
					  // Fallback: use reference as name if name is empty
					  messageParts.push(reference);
				  }
				  if (locationDesc) messageParts.push(`(${locationDesc})`);
				  
				  // Ensure message is never completely empty
				  const message = messageParts.length > 0 ? messageParts.join(' ') : `POTA ${reference || 'Activation'}`;
				  
				  // build POTA spot
				  let dxSpot = {
					  spotter: String(item.spotter).trim().substring(0, 20),
					  spotted: String(item.activator).trim().substring(0, 20),
					  frequency: freq,
					  message: message,
					  when: new Date(),
					  additional_data: {
						  pota_ref: reference,
						  pota_mode: mode
					  }

				  }

				  if (!isNaN(item.frequency)) { 	// ignore POTA-Spots without (valid) frequency
					  // Create unique key for this spot (use frequency deviation)
					  const deviation = getAllowedDeviation(mode);
					  // Round frequency to nearest deviation to group similar spots
					  const freqKey = Math.round(freq / deviation) * deviation;
					  const spotKey = `${dxSpot.spotted}_${freqKey}_${mode}`;
					  
					  // Add to current spots Map
					  currentSpots.set(spotKey, dxSpot);

					  // check if this is a new spot (not in previous cache)
					  if (!this.potaspotcache.has(spotKey)) {
						  this.emit('spot', dxSpot);
					  }
				  }
			  });

			  // Replace cache with current spots
			  this.potaspotcache = currentSpots;
			  
			  // Enforce cache size limit
			  if (this.potaspotcache.size > this.MAX_CACHE_SIZE) {
				  // Remove oldest entries (first entries in Map)
				  const toRemove = this.potaspotcache.size - this.MAX_CACHE_SIZE;
				  let removed = 0;
				  for (const key of this.potaspotcache.keys()) {
					  if (removed >= toRemove) break;
					  this.potaspotcache.delete(key);
					  removed++;
				  }
			  }
			  
			  // Success - reset backoff
			  if (this.consecutiveErrors > 0) {
				  console.log(`[POTA] API recovered after ${this.consecutiveErrors} consecutive errors`);
			  }
			  this.consecutiveErrors = 0;
			  this.currentBackoff = 0;

		  } catch (error) {
			  //log error to console with backoff info
			  this.consecutiveErrors++;
			  
			  // Check circuit breaker threshold
			  if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
				  this.circuitOpen = true;
				  console.error(`[POTA] Circuit breaker triggered after ${this.consecutiveErrors} consecutive failures`);
				  continue; // Will exit on next iteration
			  }
			  
			  // Calculate next backoff
			  if (this.currentBackoff === 0) {
				  this.currentBackoff = this.INITIAL_BACKOFF;
			  } else {
				  this.currentBackoff = Math.min(this.currentBackoff * this.BACKOFF_FACTOR, this.MAX_BACKOFF);
			  }
			  
			  const nextRetrySeconds = Math.round(this.currentBackoff / 1000);
			  console.error(`[POTA] Fetch failed (attempt ${this.consecutiveErrors}/${this.MAX_CONSECUTIVE_ERRORS}, retry in ${nextRetrySeconds}s): ${error.message || error}`);
		  }
	  }
  }
  
  /**
   * Reset circuit breaker (can be called externally to retry)
   */
  resetCircuitBreaker() {
	  this.circuitOpen = false;
	  this.consecutiveErrors = 0;
	  this.currentBackoff = 0;
	  console.log('[POTA] Circuit breaker reset');
  }
};
