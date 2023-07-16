#!/usr/bin/env -S node
const DXCluster = require('dxcluster');
const express = require("express");
const app = express()
const path = require("path")
const config = require("./config.js");
const cors = require('cors');
const morgan = require('morgan');

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
});

app.get(config.baseUrl + '/spots', function(req, res){        // Fallback Route
	res.json(spots);
});

conn.connect(config.dxc)
.then(() => {
	console.log('connected')
})
.catch((err) => {
	console.log(err);
})

conn.on('spot', (spot) => {
	spot.add=qrg2band(spot.frequency);
	spots.push(spot);
	if (spots.length>config.maxcache) {
		spots.shift();
	}
	// console.log(spots);
})

app.listen(config.webport,'127.0.0.1', () => {
	console.log('listener started on Port '+config.webport);
});

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

function qrg2band (qrg) {
	let r={};
	switch(true) {
		case (qrg>1840 && qrg<=2000):	r.mode='SSB'; r.band=160; break;
		case (qrg>=3073 && qrg<=3076):	r.mode='FT8'; r.band=80; break;
		case (qrg>=3600 && qrg<=3800):	r.mode='SSB'; r.band=80; break;
		case (qrg>=7074 && qrg<=7076):	r.mode='FT8'; r.band=40; break;
		case (qrg>=7060 && qrg<=7200):	r.mode='SSB'; r.band=40; break;
		case (qrg>=14074 && qrg<=14076):	r.mode='FT8'; r.band=20; break;
		case (qrg>=14100 && qrg<=14350):	r.mode='SSB'; r.band=20; break;
		case (qrg>=21074 && qrg<=21076):	r.mode='FT8'; r.band=15; break;
		case (qrg>=21150 && qrg<=21450):	r.mode='SSB'; r.band=15; break;
		case (qrg>=28074 && qrg<=28076):	r.mode='FT8'; r.band=10; break;
		case (qrg>=28320 && qrg<=29300):	r.mode='SSB'; r.band=10; break;
		case (qrg>=50313 && qrg<=50314):	r.mode='FT8'; r.band=6; break;
		case (qrg>=18074 && qrg<=18076):	r.mode='FT8'; r.band=17; break;
		case (qrg>=18120 && qrg<=18168):	r.mode='SSB'; r.band=17; break;
		case (qrg>=10100 && qrg<=10150):	r.band=30; break;
		case (qrg>=24890 && qrg<=24990):	r.band=12; break;
	}
	return r;
}
