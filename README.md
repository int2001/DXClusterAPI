# DXClusterAPI
Simple JSON API for DXCluster

# Example-API
For testing- and development we set Up a small live-instance, which caches 1000 Spots.
More information how to use it: [Here](https://jo30.de/dxcluster-per-rest-json/)

# Purpose
Make last n Spots of DXCluster accessible via API to use it in other Applications without having the stream there.
How is it done: Stream DXCluster to memory and put a small REST-API on it

# SetUp
## Docker
* Switch to dockerized Branch
  
## Classic
Open Shell (have node-js and git already installed!):
* `git clone https://github.com/int2001/DXClusterAPI.git`
* change to DXClusterAPI Directory (f.ex. `cd DXClusterAPI`)
* make master the active branch `git switch master`
* rename `config.js.sample` to `config.js` and edit it (adjust callsign, max cached spots, port of service, Wavelog URL & API Key)
* type `npm install`
* start the Script f.ex. by typing `node ./index.js` or launching it within `pm2 start ./index.js`

* This has to be used together with [Wavelog](https://github.com/wavelog/wavelog). Everytime a fresh spots appears this feature adds DXCC-Information for spotter and spotted to the cache.

# Hints/Tips
* tools logs access.log-style to console (or logfile if pm2 is used)
* you can restrict browser-access by editing the cors-line at index.js

## API Usage

To interact with the DXCluster API, point your client (browser or program) to the appropriate URL, which includes the configured `baseURL`. The `baseURL` is defined in the configuration file (e.g., `/dxcache`) and must be included in all requests if configured. Below are the available endpoints:

- To retrieve a list of all cached spots, use:
  ```
  http://[host_where_it_is_running:port][baseURL]/spots
  ```

- To retrieve all cached spots for a specific band (e.g., "40m"), use:
  ```
  http://[host_where_it_is_running:port][baseURL]/spots/[Band]
  ```
  Replace `[Band]` with the desired band, such as "40m".

- To retrieve the latest spot for a specific frequency (QRG in kHz), use:
  ```
  http://[host_where_it_is_running:port][baseURL]/spot/[QRG_in_kHz]
  ```
  Replace `[QRG_in_kHz]` with the desired frequency in kilohertz (e.g., `14000` for 14 MHz).

- To get basic statistics about the cache state, such as the number of entries and the freshest or oldest spot, use:
  ```
  http://[host_where_it_is_running:port][baseURL]/stats
  ```

Ensure that `[baseURL]` is replaced by the configured base URL (if applicable), or remove it if no base URL is configured.

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
