const net = require('net');
const events = require('events');

const sleepNow = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

module.exports = class POTASpots extends events.EventEmitter {
  
  //constructor
  constructor(opts = {}) {
    super();
    this.potapollinterval = opts.potapollinterval || 120; // Default to 120 seconds
    this.potaspotcache = [];
  }

  getalloweddeviation(mode)
  {
    //allow FT8 and FT4 to be up to 3khz off to be sure to catch all in-band-frequency changes and wobbly receivers
    switch (mode) {
      case "FT8":
        return 3;
      case "FT4":
        return 3;
      default:
        return 1;
    }
  }

  //continuously poll POTA API, determine new spots and emit those to event listeners
  async run(opts = {}) {
    while (true) {
      
      //Wait for the polling interval
      await sleepNow(this.potapollinterval * 1000);

      //cache variable
      let spots = [];

      //Try to get data from POTA API
      try {
        
        //fetch api response, 10s timeout
        const response = await fetch('https://api.pota.app/spot/activator', { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('HTTP error');

        //get json from response
        let rawspots = await response.json();

        //iterate through each spot
        rawspots.forEach((item, index) => {
        
          // build POTA spot
          let dxSpot = {
            spotter: item.spotter,
            spotted: item.activator,
            frequency: item.frequency,
            message: item.mode + (item.mode != '' ? " " : "") + "POTA @ " + item.reference + " " + item.name + " (" + item.locationDesc + ")",
            when: new Date(),
            additional_data: {
              pota_ref: item.reference,
              pota_mode: item.mode
            }
              
          }

          //put spots inside of array to build new
          spots.push(dxSpot);

          //check if the same spot (excluding "when") exists in cache
          //use an allowed deviation on frequency to catch multiple spots by RBN or PSK-Reporter for FT8, FT4 and CW modes
          let isNewSpot = !this.potaspotcache.some(existingSpot => 
            existingSpot.spotted === dxSpot.spotted &&
            Math.abs(existingSpot.frequency - dxSpot.frequency) <= this.getalloweddeviation(item.mode) &&
            existingSpot.message === dxSpot.message
          );

          //emit spot to event listeners
          if(isNewSpot)
          {
            this.emit('spot', dxSpot)
          }          
        });

        //set the potacache to the current state, effectively deleting all old spots
        this.potaspotcache = spots;
        
      } catch (error) {
        //log error to console
        console.error('Fetch failed:', error);
      }
    }
  }
};
