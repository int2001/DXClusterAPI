/**
 * Parks On The Air (POTA) Module
 * Polls POTA API for real-time park activation spots
 * 
 * @module pota
 */

const events = require('events');
const { sleepNow, getAllowedDeviation } = require('../../lib/utils');

module.exports = class POTASpots extends events.EventEmitter {
  
  //constructor
  constructor(opts = {}) {
    super();
    this.potapollinterval = Math.max(30, (opts.potapollinterval || 120)); // Default to 120 seconds, 30 seconds minimum
    this.potaspotcache = new Map(); // Changed to Map for O(1) lookups: key = spotted_freq_mode
    this.MAX_CACHE_SIZE = 500; // Limit cache size to prevent unbounded growth
  }

  //continuously poll POTA API, determine new spots and emit those to event listeners
  async run(opts = {}) {
	  while (true) {

		  //Wait for the polling interval
		  await sleepNow(this.potapollinterval * 1000);

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
				  
				  // Safety: Validate frequency range
				  const freq = parseFloat(item.frequency);
				  if (isNaN(freq) || freq < 30 || freq > 300000000) return;
				  
				  // Safety: Sanitize text fields
				  const mode = String(item.mode || '').replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim().substring(0, 20);
				  const name = String(item.name || '').replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim().substring(0, 100);
				  const locationDesc = String(item.locationDesc || '').replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim().substring(0, 100);
				  const reference = String(item.reference || '').replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim().substring(0, 20);
				  
				  // build POTA spot
				  let dxSpot = {
					  spotter: String(item.spotter).trim().substring(0, 20),
					  spotted: String(item.activator).trim().substring(0, 20),
					  frequency: freq,
					  message: mode + (mode != '' ? " " : "") + name + " (" + locationDesc + ")",
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

		  } catch (error) {
			  //log error to console
			  console.error('Fetch failed:', error);
		  }
	  }
  }
};
