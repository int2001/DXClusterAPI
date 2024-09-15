DXClusterAPI

Simple JSON API for DXCluster

Example-API

For testing and development, we have set up a live instance that caches 1000 spots. More information on how to use it can be found here: [Live Instance Info](https://jo30.de/dxcluster-per-rest-json/).

Purpose

DXClusterAPI makes the last n spots of DXCluster accessible via a JSON API, enabling other applications to use the data without needing the raw stream. The DXCluster data is streamed into memory, and a small REST API provides access to it.

SetUp

### Docker

1. Switch to the dockerized branch.

### Classic Setup

1. Open a terminal and ensure Node.js and Git are installed.
2. Clone the repository:
   ```bash
   git clone https://github.com/besynnerlig/DXClusterAPI.git
   ```
3. Navigate to the DXClusterAPI directory:
   ```bash
   cd DXClusterAPI
   ```
4. Make `master` the active branch:
   ```bash
   git switch master
   ```
5. Rename `config.js.sample` to `config.js` and edit it, adjusting:
   - Callsign
   - Max cached spots
   - Port of service
   - WaveLog URL & API Key

6. Install dependencies:
   ```bash
   npm install
   ```

7. Start the application:
   ```bash
   node ./index.js
   ```

   Alternatively, you can use PM2 to start the application:
   ```bash
   pm2 start ./index.js
   ```

   The application must be used alongside WaveLog, which adds DXCC information for both the spotter and spotted station to the cache whenever a new spot appears.

Hints/Tips

- The application logs access data in an access.log style format (or to a file if PM2 is used).
- You can restrict browser access by editing the CORS settings in `index.js`.

API Usage

To interact with the DXCluster API, point your client (browser or program) to the appropriate URL. The base URL is defined in the configuration file (e.g., `/dxcache`) and must be included in all requests if configured.

### Available Endpoints:

- **Get all cached spots**:
  ```bash
  http://[host]:[port][baseURL]/spots
  ```

- **Get spots for a specific band** (e.g., "40m"):
  ```bash
  http://[host]:[port][baseURL]/spots/[Band]
  ```

- **Get the latest spot for a specific frequency (in kHz)**:
  ```bash
  http://[host]:[port][baseURL]/spot/[QRG_in_kHz]
  ```

- **Get cache statistics** (e.g., number of entries, freshest or oldest spot):
  ```bash
  http://[host]:[port][baseURL]/stats
  ```

Ensure `[baseURL]` is replaced by the configured base URL, or remove it if no base URL is configured.

### Sample Output for /spots:
```json
[
  {
    "spotter": "F5EAN",
    "spotted": "HB9G",
    "frequency": 96974,
    "message": "/B IN96DK<TR>JN36BK RST 539",
    "when": "2023-07-20T05:10:00.693Z",
    "add": {
      "decont": "EU",
      "dxcont": "EU",
      "cqz": "14",
      "entity": "SWITZERLAND"
    }
  },
  {
    "spotter": "HA8LNN",
    "spotted": "F6BCW",
    "frequency": 14027,
    "message": "up1, nice signal",
    "when": "2023-07-20T05:10:05.589Z",
    "add": {
      "decont": "EU",
      "dxcont": "EU",
      "cqz": "14",
      "entity": "FRANCE"
    }
  }
]
```

### Sample Output for /spot/14027:
```json
{
  "spotter": "HA8LNN",
  "spotted": "F6BCW",
  "frequency": 14027,
  "message": "up1, nice signal",
  "when": "2023-07-20T05:10:05.589Z",
  "add": {
    "decont": "EU",
    "dxcont": "EU",
    "cqz": "14",
    "entity": "FRANCE"
  }
}
```

### Field Explanation:
- **spotter**: The operator who spotted the call.
- **spotted**: The station that was spotted.
- **frequency**: The frequency (in kHz) where the spot was made.
- **message**: Message provided by the spotter.
- **when**: Timestamp (UTC) of the spot.
- **add**: Additional information:
  - **decont**: Continent of the spotter.
  - **dxcont**: Continent of the spotted station.
  - **cqz**: CQ zone of the spotted station.
  - **entity**: DXCC entity (country) of the spotted station.

Notice: Not all fields in the "add" object will always be populated. Basic logic is used to derive band and mode information from the spot. However, this is not always reliable.
