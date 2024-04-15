# DXClusterAPI / Docker-Version
Simple JSON API for DXCluster

# Example-API
For testing- and development we set Up a small live-instance, which caches 1000 Spots.
More information how to use it: [Here](https://jo30.de/dxcluster-per-rest-json/)

# Purpose
Make last n Spots of DXCluster accessible via API to use it in other Applications without having the stream there.
How is it done: Stream DXCluster to memory and put a small REST-API on it

# SetUp (Pre-built)
* Copy Paste contents of [/hub/docker-compose.yaml](https://github.com/int2001/DXClusterAPI/blob/dockerized/hub/docker-compose.yaml) into a local folder on your machine or Docker-Environment
* Adjust docker-compose.yaml (ENV-Vars - they're commented) to your needs. Don't forget Wavelog-URL and Key
* `docker-compose up -d` or "Start container" in your Docker-Env

# SetUp (Self-built)
* `git clone https://github.com/int2001/DXClusterAPI.git`
* `cd DXClusterAPI`
* `git checkout dockerized`
* Adjust docker-compose.yaml (ENV-Vars - they're commented) to your needs. Don't forget Wavelog-URL and Key
* `docker-compose up -d`

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
        "spotter": "IK2MMM",
        "spotted": "II1GM/2",
        "frequency": 14258,
        "message": "MARCONI AWARD 150ANNI",
        "when": "2024-04-15T14:48:12.235Z",
        "dxcc_spotter": {
            "cont": "EU",
            "entity": "Italy",
            "flag": "🇮🇹",
            "dxcc_id": "248",
            "lotw_user": "2",
            "lat": "41.9",
            "lng": "12.5"
        },
        "dxcc_spotted": {
            "cont": "EU",
            "entity": "Italy",
            "flag": "🇮🇹",
            "dxcc_id": "248",
            "lotw_user": false,
            "lat": "41.9",
            "lng": "12.5"
        },
        "band": "20m"
    },
]
```

Sample Output of /spot/14310:
```
{
  spotter: "EA4EHD",
  spotted: "AO75CM",
  frequency: 14310,
  message: "AO75CM",
  when: "2024-04-15T15:05:00.778Z",
  dxcc_spotter: {
  cont: "EU",
  entity: "Spain",
  flag: "🇪🇸",
  dxcc_id: "281",
  lotw_user: false,
  lat: "40.4",
  lng: "-3.7"
},
dxcc_spotted: {
  cont: "EU",
  entity: "Spain",
  flag: "🇪🇸",
  dxcc_id: "281",
  lotw_user: false,
  lat: "40.4",
  lng: "-3.7"
},
  band: "20m"
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
