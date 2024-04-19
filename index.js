#!/usr/bin/env -S bun
"use strict";
const DXCluster = require('./dxcluster');
const express = require("express");
const app = express()
const path = require("path")
const cors = require('cors');
const morgan = require('morgan');
const gearman = require('gearman');
var dxcc;

var config = {};
if (process.env.WEBPORT === undefined) {
	config = require("./config.js");
} else {
	config={maxcache: process.env.MAXCACHE, webport: process.env.WEBPORT, baseUrl: process.env.WEBURL, dxcc_lookup_wavelog_url: process.env.WAVELOG_URL, dxcc_lookup_wavelog_key: process.env.WAVELOG_KEY };
	config.dxc={ host: process.env.DXHOST, port: process.env.DXPORT, loginPrompt: 'login:', call: process.env.DXCALL };
}

morgan.token('remote-addr', function (req, res) {
        var ffHeaderValue = req.headers['x-forwarded-for'];
        return ffHeaderValue || req.connection.remoteAddress;
});

app.disable('x-powered-by');
app.use(express.json());
app.use(morgan(':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms'));
app.use(cors({
	origin: '*'
}));

conn = new DXCluster()
var spots=[];

app.get(config.baseUrl + '/spot/:qrg', function(req, res){        // Fallback Route
	var qrg=req.params.qrg;
	single_spot=get_singlespot(qrg);
	res.json(single_spot);
	single_spot={};
});

app.get(config.baseUrl + '/spots', function(req, res){        // Fallback Route
	res.json(spots);
});

app.get(config.baseUrl + '/spots/:band', function(req, res){        // Fallback Route
	bandspots=get_bandspots(req.params.band);
	res.json(bandspots);
	bandspots=[];
});

app.get(config.baseUrl + '/stats', function(req, res){        // Fallback Route
	let stats={};
	stats.entries=spots.length;
	stats.freshest=get_freshest(spots);
	stats.oldest=get_oldest(spots);
	res.json(stats);
	status={};
});

reconnect();

conn.on('close', () => {
	console.log("Conn closed / reconnect");
	reconnect();
});

conn.on('timeout', () => {
	console.log("Conn timeouted / reconnect");
	reconnect();
});

conn.on('error', function(ex) {
	console.log("Conn other Error / reconnect");
	console.log(ex);
	reconnect();
});

conn.on('spot', async function x(spot) {
	try {
		spot.dxcc_spotter=await dxcc_lookup(spot.spotter);
		spot.dxcc_spotted=await dxcc_lookup(spot.spotted);
		spot.band=qrg2band(spot.frequency*1000);
		spots.push(spot);
		if (spots.length>config.maxcache) {
			spots.shift();
		}
		spots=reduce_spots(spots);
	} catch(e) { 
		console.log(spot);
		console.log(e);
	
	} 
		
	// console.log(spot.spotted + " @ " + spot.when);
})

async function main() {
	try {
		app.listen(config.webport,'0.0.0.0', () => {
			console.log('listener started on Port '+config.webport);
		});
	} catch(e) {
		console.log("Error Occured:  "+e);
		process.exit(99);
	} 
}

main();

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


function get_bandspots(band) {
	let ret=[];
	spots.forEach((single) => {
		if( (band === single.band) ) {
			ret.push(single);
		}
	});
	return ret;
}

function get_freshest(spotobj) {
	let youngest=Date.parse('1970-01-01T00:00:00.000Z');
	spotobj.forEach((single) => {
		if((Date.parse(single.when)>youngest)) {
			youngest=Date.parse(single.when);
		}
	});
	return new Date(youngest).toISOString();
}
	
function get_oldest(spotobj) {
	let oldest=Date.parse('2032-01-01T00:00:00.000Z');
	spotobj.forEach((single) => {
		if((Date.parse(single.when)<oldest)) {
			oldest=Date.parse(single.when);
		}
	});
	return new Date(oldest).toISOString();
}
	
function reduce_spots(spotobject) { // Try to reduce spots a little (Delete dupes and only hold youngest)
	let unique=[];
	spotobject.forEach((single) => {
		if (!spotobject.find((item) => ((item.spotted == single.spotted) && (item.dxcc_spotter.cont == single.dxcc_spotter.cont) && (item.frequency == single.frequency) && (Date.parse(item.when)>Date.parse(single.when))))) {
			unique.push(single);
		}
	});
	return unique;
}

function reconnect() {
	conn.connect(config.dxc)
	.then(() => {
		console.log('connected')
	})
	.catch((err) => {
		console.log(err);
	})
}

function qrg2band(Frequency) {
	let Band = '';
	if (Frequency > 1000000 && Frequency < 2000000) {
		Band = "160m";
	} else if (Frequency > 3000000 && Frequency < 4000000) {
		Band = "80m";
	} else if (Frequency > 6000000 && Frequency < 8000000) {
		Band = "40m";
	} else if (Frequency > 9000000 && Frequency < 11000000) {
		Band = "30m";
	} else if (Frequency > 13000000 && Frequency < 15000000) {
		Band = "20m";
	} else if (Frequency > 17000000 && Frequency < 19000000) {
		Band = "17m";
	} else if (Frequency > 20000000 && Frequency < 22000000) {
		Band = "15m";
	} else if (Frequency > 23000000 && Frequency < 25000000) {
		Band = "12m";
	} else if (Frequency > 27000000 && Frequency < 30000000) {
		Band = "10m";
	} else if (Frequency > 49000000 && Frequency < 52000000) {
		Band = "6m";
	} else if (Frequency > 69000000 && Frequency < 71000000) {
		Band = "4m";
	} else if (Frequency > 140000000 && Frequency < 150000000) {
		Band = "2m";
	} else if (Frequency > 218000000 && Frequency < 226000000) {
		Band = "1.25m";
	} else if (Frequency > 430000000 && Frequency < 440000000) {
		Band = "70cm";
	} else if (Frequency > 900000000 && Frequency < 930000000) {
		Band = "33cm";
	} else if (Frequency > 1200000000 && Frequency < 1300000000) {
		Band = "23cm";
	} else if (Frequency > 2200000000 && Frequency < 2600000000) {
		Band = "13cm";
	} else if (Frequency > 3000000000 && Frequency < 4000000000) {
		Band = "9cm";
	} else if (Frequency > 5000000000 && Frequency < 6000000000) {
		Band = "6cm";
	} else if (Frequency > 9000000000 && Frequency < 11000000000) {
		Band = "3cm";
	} else if (Frequency > 23000000000 && Frequency < 25000000000) {
		Band = "1.2cm";
	} else if (Frequency > 46000000000 && Frequency < 55000000000) {
		Band = "6mm";
	} else if (Frequency > 75000000000 && Frequency < 82000000000) {
		Band = "4mm";
	} else if (Frequency > 120000000000 && Frequency < 125000000000) {
		Band = "2.5mm";
	} else if (Frequency > 133000000000 && Frequency < 150000000000) {
		Band = "2mm";
	} else if (Frequency > 240000000000 && Frequency < 250000000000) {
		Band = "1mm";
	} else if (Frequency >= 250000000000) {
		Band = "<1mm";
	}
	return Band
}

async function dxcc_lookup(call) {
	return new Promise(async (resolve,reject) => {
		try {
			let payload={};
			payload.key=config.dxcc_lookup_wavelog_key;
			payload.callsign=call;
			result=await postData(config.dxcc_lookup_wavelog_url,payload);
			payload={};
			let returner={};
			returner.cont=result.cont;
			if (result.dxcc) {
				returner.entity=toUcWord(result.dxcc);
			} else {
				returner.entity='';
			}
			returner.flag=result.dxcc_flag;
			returner.dxcc_id=result.dxcc_id;
			returner.lotw_user=result.lotw_member;
			if (result.dxcc_lat) {
				returner.lat=result.dxcc_lat;
				returner.lng=result.dxcc_long;
			} else {
				returner.lat=null;
				returner.lng=null;
			}
			result={};
			resolve(returner);
		} catch(e) {
			console.log(e);
			reject();
		}
	});
}


async function postData(url = "", data = {}) {
	// Default options are marked with *
	const response = await fetch(url, {
		method: "POST", // *GET, POST, PUT, DELETE, etc.
		mode: "cors", // no-cors, *cors, same-origin
		cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
		credentials: "same-origin", // include, *same-origin, omit
		headers: {
			"Content-Type": "application/json",
			// 'Content-Type': 'application/x-www-form-urlencoded',
		},
		redirect: "follow", // manual, *follow, error
		referrerPolicy: "no-referrer", // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
		body: JSON.stringify(data), // body data type must match "Content-Type" header
	});
	returner=await response.json();
	return returner;
}

function toUcWord(string) {
	let words = string.toLowerCase().split(" ");

	for (let i = 0; i < words.length; i++) {
		words[i] = words[i][0].toUpperCase() + words[i].substr(1);
	}

	return words.join(" ");
}
