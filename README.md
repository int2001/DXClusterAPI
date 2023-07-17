# DXClusterAPI
Simple JSON API for DXCluster

# Example-API
For testing- and development we set Up a small live-instance, which caches 1000 Spots.
More information how to use it: [Here](https://jo30.de/dxcluster-per-rest-json/)

# Purpose
Make last n Spots of DXCluster accessible via API to use it in other Applications without having the stream there.
How is it done: Stream DXCluster to memory and put a small REST-API on it

# SetUp
Open Shell (have node-js and git already installed!):
* `git clone https://github.com/int2001/DXClusterAPI.git`
* change to DXClusterAPI Directory (f.ex. `cd DXClusterAPI`)
* rename `config.js.sample` to `config.js` and edit it (adjust callsign, max cached spots, port of service)
* type `npm install`
* start the Script f.ex. by typing `node ./index.js` or launching it within `pm2 start ./index.js`

# Hints/Tips
* tools logs access.log-style to console (or logfile if pm2 is used)
* you can restrict browser-access by editing the cors-line at index.js

# Using it
* point your Client (Browser / programm) to http://[host_where_it_is_running:port]/spots to get a list of all cached spots
* point your Client (Browser / programm) to http://[host_where_it_is_running:port]/spot/[QRG in kHz] to get the latest spot of that QRG


Sample output of /spots:
```
[
  {
    spotter: "ON4KWT",
    spotted: "TM100TC",
    frequency: 7113,
    message: "merci pour le qso Claude",
    when: "2023-07-16T09:19:11.457Z",
    add: {
      mode: "SSB",
      band: 40
    }
  },
  {
    spotter: "DK4SDR",
    spotted: "RI41POL",
    frequency: 14193,
    message: "Grid LR04 TNX VY 73",
    when: "2023-07-16T09:19:18.710Z",
    add: {
      mode: "SSB",
      band: 20
  }
},
]
```

Sample Output of /spot/QRG:
```
{
  spotter: "KD9VV",
  spotted: "KC3BVL",
  frequency: 50260,
  message: "EN71<MS>FM29",
  when: "2023-07-16T09:46:46.175Z",
  add: { }
}
```

Notice "add" is sometimes not filled. There's a rudimentary logic in this API to derivate band and Mode out of spot. Don't rely on that!
