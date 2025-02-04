#!/usr/bin/env -S bun
"use strict";
const DXCluster = require('./dxcluster');
const POTASpots = require('./pota');
const express = require("express");
const app = express()
const path = require("path")
const cors = require('cors');
const morgan = require('morgan');
const fetch = require('node-fetch');  // Fetch for API requests
var dxcc;

//Load config from file or from environment variables
var config = {};
if (process.env.WEBPORT === undefined) {
	config = require("./config.js");
} else {
	config={maxcache: process.env.MAXCACHE, webport: process.env.WEBPORT, baseUrl: process.env.WEBURL, dxcc_lookup_wavelog_url: process.env.WAVELOG_URL, dxcc_lookup_wavelog_key: process.env.WAVELOG_KEY, includepotaspots: process.env.POTA_INTEGRATION, potapollinterval: process.env.POTA_POLLING_INTERVAL };
	config.dxc={ host: process.env.DXHOST, port: process.env.DXPORT, loginPrompt: 'login:', call: process.env.DXCALL, password: process.env.DXPASSWORD };
}

morgan.token('remote-addr', function (req, res) {
        var ffHeaderValue = req.headers['x-forwarded-for'];
        return ffHeaderValue || req.connection.remoteAddress;
});

app.disable('x-powered-by');
app.use(express.json());
app.use(morgan(':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms'));
app.use(cors({ origin: '*' }));

// DXCluster connection and spot cache
let conn = new DXCluster()
let spots=[];

// -----------------------------------
// Utility Functions
// -----------------------------------

/**
 * Helper function to log connection state changes.
 * @param {string} state - The current state of the connection.
 * @param {string} server - The server being connected to.
 * @param {string} reason - The reason for the connection.
 * @param {Error} [error=null] - Optional error object for logging.
 */
function logConnectionState(state, server = '', error = null) {
    const timestamp = new Date().toISOString();
    const serverInfo = typeof server === 'object' ? `${server.host}:${server.port}` : server;

    if (error && error instanceof Error) {
        console.error(`[${timestamp}] - Error while connecting to ${serverInfo}:`, error);
    } else if (state === 'attempting') {
        console.log(`[${timestamp}] - Attempting to connect to ${serverInfo}`);
    } else if (state === 'connected') {
        console.log(`[${timestamp}] - Successfully connected to ${serverInfo}`);
    } else if (state === 'closed') {
        console.log(`[${timestamp}] - Connection to ${serverInfo} closed`);
    } else if (state === 'timeout') {
        console.log(`[${timestamp}] - Connection to ${serverInfo} timed out`);
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

// -----------------------------------
// DXCluster Connection Logic
// -----------------------------------

/**
 * Initiates a connection to the DXCluster and logs events.
 */
function reconnect() {
    logConnectionState('attempting', config.dxc, 'DXCluster server for receiving spots');
    conn.connect(config.dxc)
        .then(() => {
            logConnectionState('connected', config.dxc, 'DXCluster server for receiving spots');
        })
        .catch((err) => {
            logConnectionState('failed', config.dxc, 'DXCluster server for receiving spots', err);
            setTimeout(reconnect, 5000);  // Retry connection after 5 seconds
        });
}

// Event listeners for connection status changes
conn.on('close', () => {
    logConnectionState('closed', config.dxc, 'DXCluster server connection closed');
    reconnect();
});

conn.on('timeout', () => {
    logConnectionState('timeout', config.dxc, 'DXCluster server connection timed out');
    reconnect();
});

conn.on('error', (err) => {
    logConnectionState('error', config.dxc, 'DXCluster server connection error', err);
    reconnect();
});

// -----------------------------------
// DXCluster Spot Handling
// -----------------------------------

/**
 * Processes spots received from DXCluster.
 */
conn.on('spot', async function x(spot) {
	await handlespot(spot, "cluster");
})

// -----------------------------------
// API Endpoints
// -----------------------------------

/**
 * GET /spot/:qrg - Retrieve the latest spot for a given frequency (QRG in kHz).
 */
app.get(config.baseUrl + '/spot/:qrg', (req, res) => {
    const qrg = req.params.qrg;
    const single_spot = get_singlespot(qrg);
    res.json(single_spot);
});

/**
 * GET /spots - Retrieve all cached spots.
 */
app.get(config.baseUrl + '/spots', (req, res) => {
    res.json(spots);
});

/**
 * GET /spots/:band - Retrieve all cached spots for a given band.
 */
app.get(config.baseUrl + '/spots/:band', (req, res) => {
    const bandspots = get_bandspots(req.params.band);
    res.json(bandspots);
});

/**
 * GET /stats - Retrieve statistics about the cached spots.
 */
app.get(config.baseUrl + '/stats', (req, res) => {
    const stats = {
        entries: spots.length,
		cluster: spots.filter(item => item.source === 'cluster').length,
		pota: spots.filter(item => item.source === 'pota').length,
        freshest: get_freshest(spots),
        oldest: get_oldest(spots)
    };
    res.json(stats);
});

// -----------------------------------
// Server Start
// -----------------------------------

/**
 * Starts the server and initializes the DXCluster connection.
 */
async function main() {
    try {
        app.listen(config.webport, '0.0.0.0', () => {
            console.log(`Listener started on Port ${config.webport}`);
        });
        reconnect();  // Start the connection to DXCluster
    } catch (e) {
        console.error("Error starting server:", e);
        process.exit(99);
    }
}

main();

// -----------------------------------
// POTA Spot Handling
// -----------------------------------

/**
 * Processes spots received from POTA integration.
 */

//only initialize pota component if configured
if(config.includepotaspots || false){
	
	//get potapollinterval
	let potapollinterval = config.potapollinterval || 120;
	var pota = new POTASpots({potapollinterval: potapollinterval});
	pota.run();

	pota.on('spot', async function x(spot) {
		await handlespot(spot, "pota");
	})
}

// -----------------------------------
// General Spot Handling
// -----------------------------------

/**
 * Processes spots received from different sources and may add additional data points
 */
async function handlespot(spot, spot_source = "cluster"){

	try {

		//construct a clean spot
		let dxSpot = {
			spotter: spot.spotter,
			spotted: spot.spotted,
			frequency: spot.frequency,
			message: spot.message,
			when: spot.when,	
			source: spot_source,	
		}

		//do DXCC lookup
		dxSpot.dxcc_spotter=await dxcc_lookup(spot.spotter);
		dxSpot.dxcc_spotted=await dxcc_lookup(spot.spotted);
		
		//add pota specific data
		if(spot_source == "pota"){
			dxSpot.dxcc_spotted["pota_ref"] = spot.additional_data.pota_ref
			dxSpot.dxcc_spotted["pota_mode"] = spot.additional_data.pota_mode
		}
		
		//lookup band
		dxSpot.band=qrg2band(dxSpot.frequency*1000);
		
		//push spot to cache
		spots.push(dxSpot);
		
		//empty out spots if maximum retainment is reached
		if (spots.length>config.maxcache) {
			spots.shift();
		}

		//reduce spots
		spots=reduce_spots(spots);
		
		//Log spot
		console.log(dxSpot);
	} catch(e) { 
		console.error("Error processing spot:", e);
	} 
}

function get_singlespot (qrg) {
	let ret={};
	let youngest=Date.parse('1970-01-01T00:00:00.000Z');
	spots.forEach((single) => {
		if( (qrg*1 === single.frequency) && (Date.parse(single.when)>youngest)) {
			ret=single;
			youngest=Date.parse(single.when);
		}
	});
	return ret;
}

// -----------------------------------
// Helper Functions
// -----------------------------------

let consecutiveErrorCount = 0;
const dxccServer = config.dxcc_lookup_wavelog_url;  // The WaveLog server
let abortController = null;  // For aborting ongoing requests

async function dxcc_lookup(call) {
    let timeoutId = null;  // Initialize timeoutId to null

    try {
        // Initialize the abort controller for the request
        abortController = new AbortController();
        timeoutId = setTimeout(() => {
            if (abortController) {
                abortController.abort();
            }
        }, 5000);  // Set timeout for 5 seconds

        const payload = {
            key: config.dxcc_lookup_wavelog_key,
            callsign: call
        };

        // Make the fetch request to the DXCC lookup server
        const response = await fetch(dxccServer, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: abortController.signal // Use the abort controller's signal
        });

        clearTimeout(timeoutId);  // Clear the timeout if the request succeeds

        if (!response.ok) {
            throw new Error(`DXCC lookup failed with status: ${response.status}`);
        }

        const result = await response.json();
        const returner = {
            cont: result.cont,
            entity: result.dxcc ? toUcWord(result.dxcc) : '',
            flag: result.dxcc_flag,
            dxcc_id: result.dxcc_id,
            lotw_user: result.lotw_member,
            lat: result.dxcc_lat || null,
            lng: result.dxcc_long || null
        };

        consecutiveErrorCount = 0;  // Reset error count after a successful lookup
        abortController = null;  // Clear the abort controller after success
        return returner;

    } catch (error) {
        clearTimeout(timeoutId);  // Ensure the timeout is cleared on failure
        abortController = null;  // Clear the abort controller after failure
        consecutiveErrorCount++;  // Increment error count on failure

        // Log the error with the WaveLog server info, but only for the first failure
        if (consecutiveErrorCount === 1) {
            console.error(`[${new Date().toISOString()}] - DXCC lookup failed for callsign: ${call} (Consecutive errors: ${consecutiveErrorCount}).`);
            console.error(`Served by WaveLog server: ${dxccServer}`);
        } else {
            console.error(`[${new Date().toISOString()}] - DXCC lookup failed for callsign: ${call} (Consecutive errors: ${consecutiveErrorCount}).`);
        }
    }
}


/**
 * Retrieves the latest spot for a given frequency (QRG in kHz).
 * @param {number} qrg - The frequency (in kHz) to search for.
 * @returns {object} - The latest spot for the given frequency.
 */
function get_singlespot(qrg) {
    let ret = {};
    let youngest = Date.parse('1970-01-01T00:00:00.000Z');
    spots.forEach((single) => {
        if ((qrg * 1 === single.frequency) && (Date.parse(single.when) > youngest)) {
            ret = single;
            youngest = Date.parse(single.when);
        }
    });
    return ret;
}

/**
 * Retrieves all spots for a given band.
 * @param {string} band - The band to search for.
 * @returns {array} - An array of spots for the given band.
 */
function get_bandspots(band) {
    return spots.filter((single) => single.band === band);
}

/**
 * Retrieves the most recent spot from the cache.
 * @param {array} spotobj - Array of spot objects.
 * @returns {string} - The timestamp of the most recent spot.
 */
function get_freshest(spotobj) {
    let youngest = Date.parse('1970-01-01T00:00:00.000Z');
    spotobj.forEach((single) => {
        if (Date.parse(single.when) > youngest) {
            youngest = Date.parse(single.when);
        }
    });
    return new Date(youngest).toISOString();
}

/**
 * Retrieves the oldest spot from the cache.
 * @param {array} spotobj - Array of spot objects.
 * @returns {string} - The timestamp of the oldest spot.
 */
function get_oldest(spotobj) {
    let oldest = Date.parse('2032-01-01T00:00:00.000Z');
    spotobj.forEach((single) => {
        if (Date.parse(single.when) < oldest) {
            oldest = Date.parse(single.when);
        }
    });
    return new Date(oldest).toISOString();
}

/**
 * Deduplicates the spot cache, keeping only the latest spots.
 * @param {array} spotobject - Array of spot objects.
 * @returns {array} - Deduplicated array of spots.
 */
function reduce_spots(spotobject) {
    let unique = [];
    spotobject.forEach((single) => {
        if (
            single.dxcc_spotter &&  // Ensure dxcc_spotter exists
            single.dxcc_spotted &&  // Ensure dxcc_spotted exists
            !spotobject.find((item) =>
                item.spotted === single.spotted &&
                item.dxcc_spotter && item.dxcc_spotter.cont === single.dxcc_spotter.cont &&
                item.frequency === single.frequency &&
                Date.parse(item.when) > Date.parse(single.when)
            )
        ) {
            unique.push(single);
        }
    });
    return unique;
}

/**
 * Maps frequency (in Hz) to corresponding ham radio bands.
 * @param {number} Frequency - Frequency in Hz.
 * @returns {string} - The corresponding ham radio band.
 */
function qrg2band(Frequency) {
    let Band = '';
    if (Frequency > 1000000 && Frequency < 2000000) Band = "160m";
    else if (Frequency > 3000000 && Frequency < 4000000) Band = "80m";
    else if (Frequency > 6000000 && Frequency < 8000000) Band = "40m";
    else if (Frequency > 9000000 && Frequency < 11000000) Band = "30m";
    else if (Frequency > 13000000 && Frequency < 15000000) Band = "20m";
    else if (Frequency > 17000000 && Frequency < 19000000) Band = "17m";
    else if (Frequency > 20000000 && Frequency < 22000000) Band = "15m";
    else if (Frequency > 23000000 && Frequency < 25000000) Band = "12m";
    else if (Frequency > 27000000 && Frequency < 30000000) Band = "10m";
    else if (Frequency > 40660000 && Frequency < 40690000) Band = "8m";
    else if (Frequency > 49000000 && Frequency < 52000000) Band = "6m";
    else if (Frequency > 69000000 && Frequency < 71000000) Band = "4m";
    else if (Frequency > 140000000 && Frequency < 150000000) Band = "2m";
    else if (Frequency > 218000000 && Frequency < 226000000) Band = "1.25m";
    else if (Frequency > 430000000 && Frequency < 440000000) Band = "70cm";
    else if (Frequency > 900000000 && Frequency < 930000000) Band = "33cm";
    else if (Frequency > 1200000000 && Frequency < 1300000000) Band = "23cm";
    else if (Frequency > 2200000000 && Frequency < 2600000000) Band = "13cm";
    else if (Frequency > 3000000000 && Frequency < 4000000000) Band = "9cm";
    else if (Frequency > 5000000000 && Frequency < 6000000000) Band = "6cm";
    else if (Frequency > 9000000000 && Frequency < 11000000000) Band = "3cm";
    else if (Frequency > 23000000000 && Frequency < 25000000000) Band = "1.2cm";
    else if (Frequency > 46000000000 && Frequency < 55000000000) Band = "6mm";
    else if (Frequency > 75000000000 && Frequency < 82000000000) Band = "4mm";
    else if (Frequency > 120000000000 && Frequency < 125000000000) Band = "2.5mm";
    else if (Frequency > 133000000000 && Frequency < 150000000000) Band = "2mm";
    else if (Frequency > 240000000000 && Frequency < 250000000000) Band = "1mm";
    else if (Frequency >= 250000000000) Band = "<1mm";
    return Band;
}
