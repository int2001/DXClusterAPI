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
* install gearman (`apt install gearman gearman-job-server`) and configure it to your needs
* `git clone https://github.com/int2001/DXClusterAPI.git`
* change to DXClusterAPI Directory (f.ex. `cd DXClusterAPI`)
* rename `config.js.sample` to `config.js` and edit it (adjust callsign, max cached spots, port of service, clublog API Key)
* type `npm install`
* start the Script f.ex. by typing `node ./index.js` or launching it within `pm2 start ./index.js`

* This has to be used together with the [gearman-Version of dxcc-lookup](https://github.com/int2001/dxcc_lookup). Everytime a fresh spots appears this feature adds DXCC-Information for spotter and spotted to the cache.

# Hints/Tips
* tools logs access.log-style to console (or logfile if pm2 is used)
* you can restrict browser-access by editing the cors-line at index.js

# Using it
* point your Client (Browser / programm) to http://[host_where_it_is_running:port]/spots to get a list of all cached spots
* point your Client (Browser / programm) to http://[host_where_it_is_running:port]/spots/[Band] to get a list of all cached spots at that Band. (e.g. "40m")
* point your Client (Browser / programm) to http://[host_where_it_is_running:port]/spot/[QRG in kHz] to get the latest spot of that QRG
* point your Client (Browser / programm) to http://[host_where_it_is_running:port]/stats] to get a small info about your cache-state

Sample output of /spots:
```
[
{
  spotter: 'F5EAN',
  spotted: 'HB9G',
  frequency: 96974,
  message: '/B       IN96DK<TR>JN36BK RST 539',
  when: 2023-07-20T05:10:00.693Z,
  add: { decont: 'EU', dxcont: 'EU', cqz: '14', entity: 'SWITZERLAND' }
}
{
  spotter: 'HA8LNN',
  spotted: 'F6BCW',
  frequency: 14027,
  message: 'up1, nice signal',
  when: 2023-07-20T05:10:05.589Z,
  add: { decont: 'EU', dxcont: 'EU', cqz: '14', entity: 'FRANCE' }
}
]
```

Sample Output of /spot/14027:
```
{
  spotter: 'HA8LNN',
  spotted: 'F6BCW',
  frequency: 14027,
  message: 'up1, nice signal',
  when: 2023-07-20T05:10:05.589Z,
  add: { decont: 'EU', dxcont: 'EU', cqz: '14', entity: 'FRANCE' }
}
```

Some explaination:
* spotter: the Ham who spotted the Call
* spotted: the who is spotted
* frequency: QRG in kHz
* message: message given by the spotter at the Cluster
* when: UTC-Timestamp of spot
* add: Additional-Infos
  * decont: Continent of the spotter
  * dxcont: Continent of the spotted station
  * czq: CQ-Zone of the spotted station
  * entity: DXCC-Name of the spotted station

Notice: Not all Fields in Object "add" are always filled. There's a rudimentary logic in this API to derivate band and Mode out of spot. Don't rely on that!
