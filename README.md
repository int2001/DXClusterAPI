# DXClusterAPI

Node.js REST API for DX Cluster Spots with POTA, SOTA, and RBN Integration

Aggregates spots from multiple DX Clusters, POTA, SOTA, and Reverse Beacon Network into a unified REST API with DXCC lookups via Wavelog.

## Live Test Instance

A public test instance is available for testing and development purposes:
- **URL**: https://jo30.de/dxcluster-per-rest-json/
- **Cache**: 1000 spots
- **Purpose**: Testing and development only
- **More info**: [jo30.de/dxcluster-per-rest-json/](https://jo30.de/dxcluster-per-rest-json/)

## Table of Contents

- [Live Test Instance](#live-test-instance)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Deployment Modes](#deployment-modes)
  - [Docker Mode](#docker-mode)
  - [Native Mode](#native-mode)
  - [Passenger Mode](#passenger-mode)
- [API Endpoints](#api-endpoints)
- [Module Configuration](#module-configuration)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

## Requirements

- **Node.js** 16+ (18+ recommended for native fetch support)
- **Bun** 1.0+ (for Docker mode) or **NPM** (for Native/Passenger modes)
- **Docker** & **Docker Compose** (optional, for Docker mode)
- **Phusion Passenger** (optional, for shared hosting)

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/int2001/DXClusterAPI.git
cd DXClusterAPI
```

### 2. Install Dependencies

**Using npm:**
```bash
npm install
```

**Using Bun:**
```bash
bun install
```

### 3. Configure the Application

Copy the sample environment file and edit it:

```bash
cp .env.sample .env
```

Edit `.env` with your settings (see [Configuration](#configuration) section).

## Configuration

All configuration is done via the `.env` file. Copy `.env.sample` to `.env` and adjust:

### Essential Settings

```bash
# Runtime mode: docker, native, or passenger
MODE=native

# Web server port (ignored in Passenger mode)
WEBPORT=3000

# Base URL path (empty for root, or "/api" for subpath)
BASEURL=

# Maximum spots to cache (default: 500)
MAXCACHE=500
```

### DX Cluster Configuration

```bash
# Single cluster (recommended: dxspots.com for reliability and speed)
CLUSTERS=[{"host":"dxspots.com","port":7300,"loginPrompt":"login:","call":"TE1ST","password":"","cluster":"DXSPOTS"}]
```

**Multiple clusters example:**
```bash
CLUSTERS=[{"host":"dxspots.com","port":7300,"loginPrompt":"login:","call":"TE1ST","password":"","cluster":"DXSPOTS"},{"host":"dxc.nc7j.com","port":7300,"loginPrompt":"login:","call":"TE1ST","password":"","cluster":"NC7J"}]
```

### DXCC Lookup (Wavelog)

```bash
WAVELOG_URL=https://your-wavelog-instance.com/api/lookup
WAVELOG_KEY=your_api_key_here

# Maximum concurrent DXCC lookups (default: 2)
# Lower values reduce PHP-FPM memory usage but may slow spot processing
# Increase to 3-5 if your Wavelog server has plenty of RAM
MAX_CONCURRENT_DXCC=2
```

### Module Toggles

```bash
# POTA Integration
POTA_ENABLED=true
POTA_POLLING_INTERVAL=120

# SOTA Integration
SOTA_ENABLED=true
SOTA_POLLING_INTERVAL=120

# Module Configuration
CLUSTER_ENABLED=true
ENRICHMENT_ENABLED=true
MODE_CLASSIFIER_ENABLED=true
ANALYTICS_ENABLED=false

# WebSocket (disable for some shared hosting)
WEBSOCKET_ENABLED=true
```

### Logging

```bash
FILE_LOGGING_ENABLED=true
LOG_RETENTION_DAYS=3
```

## Modular Architecture

DXClusterAPI features a modular architecture where all major components can be enabled or disabled via `.env` configuration:

### API v1 Module (`API_V1_ENABLED`)
- **Default**: `true` (enabled)
- **Purpose**: Legacy REST API endpoints for backward compatibility
- **Location**: `modules/apiv1/`
- **Endpoints**: `/spots`, `/spots/:band`, `/spots/source/:source`, `/spot/:qrg`
- **Features**:
  - Direct JSON responses (no wrapper)
  - No authentication
  - Simple parameter-based filtering

**Example:**
```bash
API_V1_ENABLED=true
```

### API v2 Module (`API_V2_ENABLED`)
- **Default**: `true` (enabled)
- **Purpose**: Modern REST API with advanced filtering and optional authentication
- **Location**: `modules/apiv2/`
- **Base Path**: `/api/v2`
- **Features**:
  - Standardized JSON responses with metadata
  - Optional API key authentication
  - Advanced filtering (band, continent, frequency, activity types)
  - Pagination support

**Example:**
```bash
API_V2_ENABLED=true
API_V2_KEY=  # Leave empty for open access
API_SPOT_LIMIT=200  # Maximum spots returned by API endpoints (default limit)
```

### API Spot Limit Configuration
- **Spot Limit** (`API_SPOT_LIMIT`): Default maximum number of spots returned by API endpoints
  - Default: `200`
  - Applies to API v1 `/spots` (always enforced)
  - Applies to API v2 `/spots` (when `limit` parameter not specified)
  - Spots are sorted by timestamp (newest first)
  - Recommended: 100-500 depending on client needs
  - API v2 can override with `?limit=N` parameter (max 500)

**Example:**
```bash
API_SPOT_LIMIT=200  # Default limit for both API v1 and v2
```

### API v1 Configuration
- **Enabled** (`API_V1_ENABLED`): Enable/disable legacy API v1 endpoints
  - Default: `true`
  - Includes: `/spots`, `/spots/:band`, `/spots/source/:source`, `/spot/:qrg`

**Example:**
```bash
API_V1_ENABLED=true
```

### Cluster Module (`CLUSTER_ENABLED`)
- **Default**: `true` (enabled)
- **Purpose**: Manages connections to one or more DX Cluster servers
- **Configuration**: Set cluster details in `CLUSTERS` JSON array
- **Location**: `modules/clusters/`
- **Features**:
  - Multi-cluster support with automatic reconnection
  - Connection health monitoring
  - Spot aggregation from all configured clusters

**Example:**
```bash
CLUSTER_ENABLED=true
CLUSTERS=[{"host":"dxspots.com","port":7300,"loginPrompt":"login:","call":"TE1ST","password":"","cluster":"DXSPOTS"}]
```

### Enrichment Module (`ENRICHMENT_ENABLED`)
- **Default**: `true` (enabled)
- **Purpose**: Extracts metadata from spot messages (POTA/SOTA/IOTA/WWFF references, contest detection)
- **Location**: `modules/enrichment/`
- **Benefits**: Automatically adds structured data to spots for easier filtering and display

**Example:**
```bash
ENRICHMENT_ENABLED=true
```

### Mode Classifier Module (`MODE_CLASSIFIER_ENABLED`)
- **Default**: `true` (enabled)
- **Purpose**: Automatically detects operating mode (CW/Phone/Digi) and submode (USB/LSB/FT8/RTTY/etc.) for all spots
- **Location**: `modules/modeclassifier/`
- **Classification Priority**:
  1. Program-specific modes (POTA/SOTA/WWFF/IOTA reported modes)
  2. Message parsing (RBN includes mode in message: "CW 25 dB", "FT8 -10 dB")
  3. Mode field (if explicitly provided by spot source)
  4. Frequency-based band plan analysis (fallback)
- **Mode Categories**: `cw`, `phone`, `digi`
- **Submodes**: `CW`, `LSB`, `USB`, `SSB`, `AM`, `FM`, `FT8`, `FT4`, `RTTY`, `PSK31`, `PSK63`, `JT65`, `JT9`, `Q65`, and more
- **Confidence Scoring**: Each classification includes a confidence level (0.3 to 1.0)

**Example:**
```bash
MODE_CLASSIFIER_ENABLED=true
```

**Output Fields:**
```json
{
  "mode": "digi",
  "submode": "FT8"
}
```

### Analytics Module (`ANALYTICS_ENABLED`)
- **Default**: `true` (enabled)
- **Purpose**: Tracks API usage statistics (client IPs, endpoints, request counts)
- **Location**: `modules/analytics/`
- **Data**: Stored in `data/analytics.json`, accessible via `/analytics` endpoint

**Example:**
```bash
ANALYTICS_ENABLED=true
```

### POTA Module (`POTA_ENABLED`)
- **Default**: `true` (enabled)
- **Purpose**: Polls POTA API for Parks on the Air spots
- **Polling Interval**: Configurable (default 120 seconds)

**Example:**
```bash
POTA_ENABLED=true
POTA_POLLING_INTERVAL=120
```

### SOTA Module (`SOTA_ENABLED`)
- **Default**: `true` (enabled)
- **Purpose**: Polls SOTA API for Summits on the Air spots
- **Polling Interval**: Configurable (default 120 seconds)

**Example:**
```bash
SOTA_ENABLED=true
SOTA_POLLING_INTERVAL=120
```

### RBN Module (`RBN_ENABLED`)
- **Default**: `false` (disabled)
- **Purpose**: Connects to Reverse Beacon Network for automated CW/RTTY/FT8 spot detection
- **Connections**: Configurable - enable CW/RTTY feed, FT8 feed, or both
- **Filtering**: Shows only one spot per continent per spotted callsign for cleaner data
- **Spot Timeout**: Configurable (default 5 minutes)

**Key Features:**
- Connects to `telnet.reversebeacon.net` on ports 7000 (CW/RTTY) and 7001 (FT8)
- Continental filtering: Keeps best spot from each continent (NA, SA, EU, AS, AF, OC, AN)
- Automatic spot aging: Removes spots older than configured timeout
- Signal strength awareness: Updates to stronger signals when available
- Selective feed control: Enable only the modes you want (CW/RTTY, FT8, or both)

**Configuration Options:**
```bash
RBN_ENABLED=false                # Enable RBN module (default: off for privacy)
RBN_CALLSIGN=YOUR_CALLSIGN       # Your amateur radio callsign (required)
RBN_SPOT_TIMEOUT=5               # Spot timeout in minutes
RBN_CW_RTTY_ENABLED=true         # Enable CW/RTTY feed (port 7000)
RBN_FT8_ENABLED=false            # Enable FT8 feed (port 7001)
```

**Feed Options:**
- **CW/RTTY Feed** (`RBN_CW_RTTY_ENABLED`): Morse code and RTTY digital mode spots (default: enabled)
- **FT8 Feed** (`RBN_FT8_ENABLED`): FT8 digital mode spots (default: disabled due to high volume)
- You can enable both feeds, only one, or neither (module disabled)

**Note**: Requires a valid amateur radio callsign for RBN login. RBN spots appear with `source: "rbn"` in the API. FT8 feed generates very high spot volumes - enable only if needed.

### Live Page (`LIVE_PAGE_ENABLED`)
- **Default**: `true` (enabled)
- **Purpose**: Serves the built-in live monitoring web interface at `/live`
- **Location**: `views/live/index.html`
- **Features**: Real-time spot display, WebSocket updates, JSON inspection, logs viewer

**Password Protection:**
Optionally protect the live page with HTTP Basic Authentication by setting `LIVE_PAGE_PASSWORD`:

**Example:**
```bash
LIVE_PAGE_ENABLED=true
LIVE_PAGE_PASSWORD=MySecretPassword123
```

**Note**: 
- When disabled, the `/live` endpoint will not be available
- When `LIVE_PAGE_PASSWORD` is empty, the live page is publicly accessible
- When `LIVE_PAGE_PASSWORD` is set, browsers will prompt for authentication (username is ignored, only password is checked)

### Metrics Module
- **Default**: Enabled automatically
- **Purpose**: Provides Prometheus metrics for monitoring and observability
- **Location**: `modules/metrics/`
- **Endpoint**: `/metrics`
- **Features**:
  - HTTP request latency tracking
  - Spot cache metrics
  - WebSocket connection count
  - Cluster connection status by cluster name
  - Spots by band distribution
  - Standard Node.js metrics (CPU, memory, GC, event loop)

**Metrics exported:**
- `http_request_duration_seconds` - Request latency histogram
- `dxcluster_spots_total` - Total cached spots
- `dxcluster_websocket_connections` - Active WebSocket connections
- `dxcluster_cluster_connections` - Cluster status (labeled)
- `dxcluster_spots_by_band` - Spot distribution by band

### Rate Limiter Module
- **Default**: `false` (disabled, enable for production if needed)
- **Purpose**: Protects API from abuse and DDoS attacks
- **Location**: `modules/rate-limiter/`
- **Configuration**: `RATE_LIMITER_ENABLED=false`
- **Features**:
  - General limit: 120 requests/minute per IP
  - Data endpoints limit: 60 requests/minute per IP (for spot polling)
  - Automatic exemption for `/health` and `/metrics`
  - Applied to both API v1 and v2

**Rate limits:**
- Most endpoints: 120 req/min (2 req/sec)
- Spot data endpoints: 60 req/min (1 req/sec)
- Health/metrics: Unlimited

## Deployment Modes

### Docker Mode

**Easiest for production deployments**

1. Create your `.env` file from `.env.sample`
2. Build and start:

```bash
docker-compose up -d
```

The application will be available at `http://localhost:3000` (or your configured port).

**Useful commands:**
```bash
# View logs
docker-compose logs -f

# Restart
docker-compose restart

# Stop
docker-compose down
```

### Native Mode

**Best for development or VPS deployments**

1. Create your `.env` file with `MODE=native`
2. Install dependencies:

```bash
npm install
```

3. Start the application:

```bash
npm start
```

**Running as a service (systemd example):**

Create `/etc/systemd/system/dxcluster.service`:

```ini
[Unit]
Description=DXClusterAPI Service
After=network.target

[Service]
Type=simple
User=dxcluster
WorkingDirectory=/opt/dxclusterapi
ExecStart=/usr/bin/node index.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable dxcluster
sudo systemctl start dxcluster
```

### Passenger Mode

**For shared hosting environments**

1. Upload files to your hosting account
2. Create `.env` file with `MODE=passenger` and `WEBSOCKET_ENABLED=true`
3. Install dependencies: `npm install`
4. Configure via hosting control panel (not .htaccess)
5. Restart Passenger:

```bash
mkdir -p tmp && touch tmp/restart.txt
```

**Important Notes:**

- **MyDevil.net and similar hosts:** Do NOT use `.htaccess` files in the application directory. Configure the Node.js app through your hosting control panel (e.g., DevilWEB). The entry point should be `index.js` and the app type should be set to `nodejs`.
- **Static file collision:** The live page is served through Express at `/live` and is not affected by static file hosting.
- **Application structure:** Ensure files are in `~/domains/DOMAIN/public_nodejs/` directory
- **Static files:** The live page is in `views/live/` - served through Express only
- **Restart:** Use `mkdir -p tmp && touch tmp/restart.txt` or hosting panel restart command

**Typical directory structure:**
```
/home/username/
├── domains/
│   └── yourdomain.com/
│       └── public_nodejs/     # Application root
│           ├── index.js       # Entry point
│           ├── app.js
│           ├── .env           # MODE=passenger
│           ├── modules/
│           │   ├── dxcluster/
│           │   ├── pota/
│           │   └── sota/
│           ├── public/        # Static files
│           │   └── index.html
│           ├── logs/
│           └── tmp/           # For restart signal
```

## API Endpoints

All endpoints are prefixed with `BASEURL` from your configuration.

### API Version Control

DXClusterAPI supports both legacy API v1 and modern API v2 endpoints. Both can be enabled or disabled independently via `.env` configuration:

```bash
# Enable/disable API versions
API_V1_ENABLED=true
API_V2_ENABLED=true

# Optional: API key for v2 authentication (leave empty for open access)
API_V2_KEY=
```

When both are enabled, API v1 endpoints remain at their original paths for backward compatibility, while API v2 endpoints are available at `/api/v2/*`.

### API v1 Endpoints (Legacy)

**Status:** Active when `API_V1_ENABLED=true` (default)
**Authentication:** None required
**Response Format:** Direct JSON array or object

#### API Information

```http
GET /
GET /info
```

Returns API information and available endpoints. Both endpoints return identical information.

**Note:** On shared hosting where the root `/` is handled by the web server (serving `index.html`), use `/info` to access API information via JSON.

**Example response:**
```json
{
  "name": "DXClusterAPI",
  "version": "2.0.0",
  "description": "Real-time DX Cluster, POTA, and SOTA spot aggregation API",
  "api": {
    "v1": {
      "enabled": true,
      "endpoints": {
        "spots": "/spots",
        "spotsByBand": "/spots/:band",
        "spotsBySource": "/spots/source/:source",
        "spotByFrequency": "/spot/:qrg",
        "stats": "/stats",
        "health": "/health",
        "live": "/live"
      }
    },
    "v2": {
      "enabled": true,
      "requiresAuth": false,
      "endpoints": {
        "spots": "/api/v2/spots",
        "spotByCallsign": "/api/v2/spots/:callsign",
        "bands": "/api/v2/bands",
        "sources": "/api/v2/sources",
        "heatmap": "/api/v2/heatmap",
        "info": "/api/v2/info"
      }
    }
  },
  "documentation": "https://github.com/int2001/DXClusterAPI"
}
```

### Live Page
```http
GET /live
```

Interactive web interface showing real-time spots. The page will automatically:
- **Try WebSocket first** for real-time streaming (if `WEBSOCKET_ENABLED=true`)
- **Fall back to polling** if WebSocket is unavailable (common on shared hosting)
- Display connection status and mode (WebSocket or Polling)

Access at `http://yourserver.com/live`.

#### API v1: Get All Spots
```http
GET /spots
```

Returns the latest cached spots with DXCC information, sorted by timestamp (newest first). The number of spots returned is limited by the `API_SPOT_LIMIT` environment variable (default: 200).

**Configuration:**
- Set `API_SPOT_LIMIT` in `.env` to change the limit (default: 200)
- Spots are automatically sorted by timestamp, newest first
- This ensures consistent response size and optimal performance

**Example response:**
```json
[
  {
    "spotter": "W1ABC",
    "spotted": "DL2XYZ",
    "frequency": 14074,
    "message": "FT8 loud and clear",
    "when": "2025-11-09T12:34:56.789Z",
    "source": "cluster",
    "band": "20m",
    "mode": "digi",
    "submode": "FT8",
    "dxcc_spotter": {
      "cont": "NA",
      "entity": "United States",
      "flag": "🇺🇸",
      "dxcc_id": "291",
      "lotw_user": true,
      "lat": "37.09",
      "lng": "-95.71",
      "cqz": "4"
    },
    "dxcc_spotted": {
      "cont": "EU",
      "entity": "Fed. Rep. Of Germany",
      "flag": "🇩🇪",
      "dxcc_id": "230",
      "lotw_user": true,
      "lat": "51.3",
      "lng": "10.4",
      "cqz": "14",
      "sota_ref": "",
      "pota_ref": "",
      "iota_ref": "",
      "wwff_ref": "",
      "isContest": false
    }
  }
]
```

**Note:** For more advanced filtering and pagination, use [API v2 endpoints](#api-v2-endpoints-modern-rest) which support query parameters like `limit`, `offset`, `band`, `continent`, `maxAge`, etc.

**Spot Metadata Enrichment:**

All spots are automatically enriched with metadata extracted from the message field (when `ENRICHMENT_ENABLED=true`):
- **SOTA References**: Detected format `XX/YY-###` (e.g., "G/LD-001", "W4G/NG-001")
- **POTA References**: Detected format `XX-####` (e.g., "K-1234", "US-4306")
- **IOTA References**: Detected format `XX-###` (e.g., "EU-005", "NA-001")
- **WWFF References**: Detected format `XXFF-####` (e.g., "KFF-6731", "GIFF-0001")
- **Contest Detection**: Automatically flags contest-related spots with `isContest: true` and identifies the contest type in `contestName`
  - Uses word-boundary matching to avoid false positives
  - Filters out conversational messages (TU, TNX, 73, GL, etc.)
  - Excludes generic "CQ DX <region>" patterns
  - Detects typical contest exchanges (599/5NN + serial number patterns)

**Enrichment Configuration:**
- Set `ENRICHMENT_ENABLED=true` in `.env` to enable automatic enrichment (default: enabled)
- Set `ENRICHMENT_ENABLED=false` to disable if you don't need park references or contest detection
- Enrichment module located in `modules/enrichment/`

**Smart Enrichment:**
- Enrichment is performed ONLY if the spot doesn't already contain these fields
- If a spot already has enrichment fields they are preserved
- This prevents double-enrichment when chaining multiple APIs
- Module-specific data (POTA/SOTA) takes priority over message parsing

This enrichment is performed on ALL spots from all sources (DX Clusters, POTA, SOTA) when enabled.

#### API v1: Get Spots by Band
```http
GET /spots/:band
```

**Example:**
```http
GET /spots/20m
```

#### API v1: Get Spots by Source
```http
GET /spots/source/:source
```

Sources: `cluster`, `pota`, `sota`, `rbn`

**Example:**
```http
GET /spots/source/pota
```

**POTA spot example:**
```json
{
  "spotter": "K1ABC",
  "spotted": "W2XYZ",
  "frequency": 14310,
  "message": "SSB POTA @ K-1234 My State Park (My State)",
  "when": "2025-11-09T14:30:00.000Z",
  "source": "pota",
  "band": "20m",
  "mode": "phone",
  "submode": "USB",
  "dxcc_spotter": {},
  "dxcc_spotted": {
    "pota_ref": "K-1234",
    "pota_mode": "SSB",
    "sota_ref": "",
    "iota_ref": "",
    "wwff_ref": "",
    "isContest": false
  }
}
```

**SOTA spot example:**
```json
{
  "spotter": "G1ABC",
  "spotted": "GM2XYZ",
  "frequency": 7032,
  "message": "CW SOTA @ GM/SS-001 Ben Nevis (Scotland)",
  "when": "2025-11-09T15:45:00.000Z",
  "source": "sota",
  "band": "40m",
  "mode": "cw",
  "submode": "CW",
  "dxcc_spotter": {},
  "dxcc_spotted": {
    "sota_ref": "GM/SS-001",
    "sota_mode": "CW",
    "pota_ref": "",
    "iota_ref": "",
    "wwff_ref": "",
    "isContest": false
  }
}
```

**Contest spot example:**
```json
{
  "spotter": "W1AW",
  "spotted": "LZ2XYZ",
  "frequency": 14025,
  "message": "CQ WW DX Contest 599 023",
  "when": "2025-11-09T16:00:00.000Z",
  "source": "cluster",
  "band": "20m",
  "mode": "cw",
  "submode": "CW",
  "dxcc_spotter": {},
  "dxcc_spotted": {
    "entity": "Bulgaria",
    "flag": "🇧🇬",
    "sota_ref": "",
    "pota_ref": "",
    "iota_ref": "",
    "wwff_ref": "",
    "isContest": true,
    "contestName": "CQ WW DX CONTEST"
  }
}
```

**IOTA spot example:**
```json
{
  "spotter": "G4XYZ",
  "spotted": "SV9/DL1ABC",
  "frequency": 14260,
  "message": "EU-001 Crete Island",
  "when": "2025-11-09T17:00:00.000Z",
  "source": "cluster",
  "band": "20m",
  "mode": "phone",
  "submode": "USB",
  "dxcc_spotter": {},
  "dxcc_spotted": {
    "entity": "Crete",
    "flag": "🇬🇷",
    "sota_ref": "",
    "pota_ref": "",
    "iota_ref": "EU-015",
    "wwff_ref": "",
    "isContest": false
  }
}
```

#### API v1: Get Single Spot by Frequency
```http
GET /spot/:qrg
```

**Example:**
```http
GET /spot/14074
```

Returns the most recent spot on the specified frequency (in kHz).

#### API v1: Get Statistics
```http
GET /stats
```

Returns cache statistics with per-source breakdown.

**Example response:**
```json
{
  "entries": 150,
  "cluster": 100,
  "pota": 30,
  "sota": 20,
  "sources": {
    "NC7J": 45,
    "DXSPOTS": 55,
    "pota": 30,
    "sota": 20
  },
  "freshest": "2025-11-09T12:34:56.789Z",
  "oldest": "2025-11-09T10:15:23.456Z"
}
```

The `sources` object shows how many spots came from each configured cluster (e.g., NC7J, DXSPOTS) and external sources (pota, sota).

#### API v1: Health Check
```http
GET /health
```

Returns application health status for monitoring and load balancers.

**Example response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-09T12:34:56.789Z",
  "uptime": 86400,
  "mode": "docker",
  "memory": {
    "used": 45,
    "total": 64
  },
  "cache": {
    "spots": 150,
    "maxcache": 200
  },
  "modules": {
    "cluster": true,
    "pota": true,
    "sota": true,
    "enrichment": true,
    "websocket": true,
    "apiv1": {
      "enabled": true
    },
    "apiv2": {
      "enabled": true,
      "requiresAuth": false
    }
  }
}
```

#### API v1: API Usage Statistics
```http
GET /analytics
```

Returns detailed information about API clients and usage patterns. Tracks who is accessing your API endpoints.

**Configuration:**
- Enable/disable via `ANALYTICS_ENABLED=true/false` in `.env`
- Data stored in `data/analytics.json`
- Automatically saves every 5 minutes and on shutdown
- Module located in `modules/analytics/`

**Example response:**
```json
{
  "summary": {
    "enabled": true,
    "totalClients": 5,
    "totalRequests": 12453,
    "dataFile": "/path/to/data/analytics.json"
  },
  "endpointStats": {
    "/spots": {
      "totalRequests": 8500,
      "uniqueClients": 4
    },
    "/spots/20m": {
      "totalRequests": 2100,
      "uniqueClients": 3
    }
  },
  "clients": [
    {
      "ip": "192.168.1.100",
      "userAgent": "Mozilla/5.0...",
      "firstSeen": "2025-11-01T10:00:00.000Z",
      "lastSeen": "2025-11-09T12:34:56.000Z",
      "totalRequests": 5234,
      "endpoints": {
        "/spots": {
          "count": 4000,
          "methods": {
            "GET": 4000
          },
          "lastAccess": "2025-11-09T12:34:56.000Z"
        },
        "/spots/20m": {
          "count": 1234,
          "methods": {
            "GET": 1234
          },
          "lastAccess": "2025-11-09T12:30:00.000Z"
        }
      },
      "referers": [
        "https://example.com/dxspots"
      ]
    }
  ]
}
```

**Tracked Information:**
- IP address (with proxy support via X-Forwarded-For)
- User agent (browser/application identifier)
- First and last seen timestamps
- Total request count per client
- Per-endpoint statistics (count, HTTP methods, last access)
- Referrers (where traffic originates from)

**Excluded from Tracking:**
- `/health` endpoint
- `/live` endpoint
- `/analytics` endpoint itself

### API v2 Endpoints (Modern REST)

**Status:** Active when `API_V2_ENABLED=true` (default)
**Base Path:** `/api/v2`
**Authentication:** Optional API key via `X-API-Key` header
**Client Identification:** Optional `X-Client-ID` header for analytics tracking
**Parameters:** URL query parameters (not JSON body)
**Response Format:** Standardized JSON wrapper with metadata

API v2 provides a modern REST interface with:
- Standardized response format with status, version, timestamp
- Optional authentication via API key
- Optional client identification for tracking (e.g., Wavelog instance ID)
- Advanced filtering via URL query parameters (band, continent, source, age, frequency range, activity types)
- Pagination support (limit, offset)
- Consistent error handling

#### Authentication & Client Identification

Set `API_V2_KEY` in `.env` to require authentication:

```bash
# No authentication (open access)
API_V2_KEY=

# Require API key
API_V2_KEY=your-secret-api-key-here
```

When authentication is enabled, include the API key in the `X-API-Key` header:

```bash
curl -H "X-API-Key: your-secret-api-key-here" http://localhost:3000/api/v2/spots
```

**Optional Client Identification:**

Both API v1 and v2 support the `X-Client-ID` header for identifying API clients in analytics. This is useful for tracking specific Wavelog instances or other API consumers:

```bash
curl -H "X-Client-ID: wavelog-ok1abc" http://localhost:3000/api/v2/spots
```

The client ID will be tracked in analytics data alongside IP addresses and user agents, allowing you to:
- Identify which Wavelog instances are using your API
- Track usage patterns by specific clients
- Monitor API consumption per client

**Unauthenticated request (when API key is required):**
```json
{
  "status": "error",
  "version": "2.0.0",
  "timestamp": "2025-11-09T12:34:56.789Z",
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "X-API-Key header is required"
  }
}
```

#### Response Format

All API v2 endpoints return a standardized JSON wrapper:

```json
{
  "status": "success",
  "version": "2.0.0",
  "timestamp": "2025-11-09T12:34:56.789Z",
  "data": [...],
  "meta": {
    "total": 150,
    "returned": 50,
    "filters": {...}
  }
}
```

**Fields:**
- `status`: `"success"` or `"error"`
- `version`: API version (matches app version)
- `timestamp`: ISO 8601 timestamp of the response
- `data`: Response payload (array or object)
- `meta`: Metadata about the response (counts, filters, pagination)
- `error`: Error details (only present when `status: "error"`)

#### API v2: Get Spots with Filtering

```http
GET /api/v2/spots
```

Returns all spots matching the specified filters. All filters are passed as **URL query parameters**.

**Query Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `band` | string | Filter by band (e.g., "20m", "40m") | `?band=20m` |
| `continent` | string | Filter by continent code (NA, EU, AS, etc.) | `?continent=EU` |
| `source` | string | Filter by source (cluster, pota, sota, or cluster name) | `?source=pota` |
| `maxAge` | number | Maximum age in seconds | `?maxAge=300` |
| `minFreq` | number | Minimum frequency in kHz | `?minFreq=14000` |
| `maxFreq` | number | Maximum frequency in kHz | `?maxFreq=14350` |
| `contest` | boolean | Filter contest spots (true/false) | `?contest=true` |
| `pota` | boolean | Filter POTA spots (true/false) | `?pota=true` |
| `sota` | boolean | Filter SOTA spots (true/false) | `?sota=true` |
| `iota` | boolean | Filter IOTA spots (true/false) | `?iota=true` |
| `wwff` | boolean | Filter WWFF spots (true/false) | `?wwff=true` |
| `limit` | number | Maximum spots to return (default: `API_SPOT_LIMIT` from config, max: 500) | `?limit=50` |
| `offset` | number | Number of spots to skip (for pagination) | `?offset=100` |

**Default Behavior:**
- If `limit` is **not specified**: Returns up to `API_SPOT_LIMIT` spots (default: 200)
- If `limit` is **specified**: Returns up to the specified amount (max: 500)
- Use `limit=500` to get maximum spots per request
- Spots are sorted by timestamp (newest first)

**Examples:**

```bash
# Get all 20m spots from the last 5 minutes
curl http://localhost:3000/api/v2/spots?band=20m&maxAge=300

# Get POTA spots only
curl http://localhost:3000/api/v2/spots?pota=true

# Get European stations on 40m CW
curl http://localhost:3000/api/v2/spots?continent=EU&minFreq=7000&maxFreq=7040

# Get contest spots only, limit to 20
curl http://localhost:3000/api/v2/spots?contest=true&limit=20

# Pagination: Get next 50 spots
curl http://localhost:3000/api/v2/spots?limit=50&offset=50
```

**Example Response:**

```json
{
  "status": "success",
  "version": "2.0.0",
  "timestamp": "2025-11-09T12:34:56.789Z",
  "data": [
    {
      "spotter": "W1ABC",
      "spotted": "DL2XYZ",
      "frequency": 14074,
      "message": "FT8 loud and clear",
      "when": "2025-11-09T12:34:00.000Z",
      "source": "NC7J",
      "band": "20m",
      "mode": "digi",
      "submode": "FT8",
      "dxcc_spotter": {
        "cont": "NA",
        "entity": "United States",
        "flag": "🇺🇸",
        "dxcc_id": "291",
        "lotw_user": true,
        "lat": "37.09",
        "lng": "-95.71",
        "cqz": "4"
      },
      "dxcc_spotted": {
        "cont": "EU",
        "entity": "Fed. Rep. Of Germany",
        "flag": "🇩🇪",
        "dxcc_id": "230",
        "lotw_user": true,
        "lat": "51.3",
        "lng": "10.4",
        "cqz": "14",
        "sota_ref": "",
        "pota_ref": "",
        "iota_ref": "",
        "wwff_ref": "",
        "isContest": false
      }
    }
  ],
  "meta": {
    "total": 150,
    "returned": 1,
    "filters": {
      "band": "20m",
      "maxAge": 300
    }
  }
}
```

#### API v2: Get Spots by Callsign

```http
GET /api/v2/spots/:callsign
```

Returns all spots where the specified callsign appears as either spotter or spotted station.

**Example:**

```bash
curl http://localhost:3000/api/v2/spots/W1ABC
```

#### API v2: Get Spot by Frequency

```http
GET /api/v2/spot/:qrg
```

Returns the latest spot at the specified frequency (in kHz).

**Example Response:**

```json
{
  "status": "success",
  "version": "2.0.0",
  "timestamp": "2025-11-09T12:34:56.789Z",
  "data": [
    {
      "spotter": "W1ABC",
      "spotted": "DL2XYZ",
      "frequency": 14074,
      "message": "FT8",
      "when": "2025-11-09T12:30:00.000Z",
      "source": "NC7J",
      "band": "20m",
      "mode": "digi",
      "submode": "FT8"
    },
    {
      "spotter": "K2DEF",
      "spotted": "W1ABC",
      "frequency": 7074,
      "message": "Working POTA",
      "when": "2025-11-09T12:25:00.000Z",
      "source": "pota",
      "band": "40m",
      "mode": "digi",
      "submode": "FT8"
    }
  ],
  "meta": {
    "callsign": "W1ABC",
    "total": 2,
    "returned": 2
  }
}
```

**Example Response:**

```json
{
  "status": "success",
  "version": "2.0.0",
  "timestamp": "2025-11-09T12:34:56.789Z",
  "data": {
    "spotter": "W1ABC",
    "spotted": "DL2XYZ",
    "frequency": 14074,
    "message": "FT8 loud and clear",
    "when": "2025-11-09T12:34:00.000Z",
    "source": "NC7J",
    "band": "20m",
    "mode": "digi",
    "submode": "FT8",
    "dxcc_spotter": {
      "cont": "NA",
      "entity": "United States",
      "flag": "🇺🇸"
    },
    "dxcc_spotted": {
      "cont": "EU",
      "entity": "Fed. Rep. Of Germany",
      "flag": "🇩🇪"
    }
  },
  "meta": {
    "frequency": 14074
  }
}
```

**Example (spot not found):**

```json
{
  "status": "error",
  "version": "2.0.0",
  "timestamp": "2025-11-09T12:34:56.789Z",
  "error": "No spot found at this frequency",
  "data": null,
  "meta": {
    "frequency": 21074
  }
}
```

#### API v2: Mode and Submode Filtering

The `/api/v2/spots` endpoint supports filtering by operating mode and submode using query parameters.

**Mode Filter (`mode`):**
- Supports comma-separated values: `cw`, `phone`, `digi`
- Returns spots matching ANY of the specified modes (OR logic)

**Submode Filter (`submode`):**
- Supports comma-separated values: `FT8`, `FT4`, `CW`, `USB`, `LSB`, `SSB`, `AM`, `FM`, `RTTY`, `PSK31`, `PSK63`, `JT65`, `JT9`, `Q65`, etc.
- Returns spots matching ANY of the specified submodes (OR logic)

**Examples:**

```bash
# Get CW spots only
curl http://localhost:3000/api/v2/spots?mode=cw

# Get phone and CW spots (OR logic - returns all CW OR phone spots)
curl http://localhost:3000/api/v2/spots?mode=phone,cw

# Get all digital spots
curl http://localhost:3000/api/v2/spots?mode=digi

# Get FT8 spots only
curl http://localhost:3000/api/v2/spots?submode=FT8

# Get FT8 and FT4 spots (OR logic)
curl http://localhost:3000/api/v2/spots?submode=FT8,FT4

# Get all PSK spots
curl http://localhost:3000/api/v2/spots?submode=PSK31,PSK63

# Combine with other filters
curl http://localhost:3000/api/v2/spots?mode=digi&band=20m&maxAge=300
```

**Example Response:**

```json
{
  "status": "success",
  "version": "2.0.0",
  "timestamp": "2025-11-09T12:34:56.789Z",
  "data": [
    {
      "spotter": "RBN",
      "spotted": "W1ABC",
      "frequency": 14025,
      "message": "CW 25 dB",
      "when": "2025-11-09T12:30:00.000Z",
      "source": "rbn",
      "band": "20m",
      "mode": "cw",
      "submode": "CW"
    },
    {
      "spotter": "DL1ABC",
      "spotted": "W1XYZ",
      "frequency": 7040,
      "message": "SSB",
      "when": "2025-11-09T12:28:00.000Z",
      "source": "NC7J",
      "band": "40m",
      "mode": "phone",
      "submode": "LSB"
    }
  ],
  "meta": {
    "total": 2,
    "limit": 100,
    "offset": 0,
    "returned": 2,
    "filters": {
      "mode": "cw,phone"
    }
  }
}
```

#### API v2: Get Available Bands

```http
GET /api/v2/bands
```

Returns a list of all bands currently present in the spot cache with spot counts.

**Example Response:**

```json
{
  "status": "success",
  "version": "2.0.0",
  "timestamp": "2025-11-09T12:34:56.789Z",
  "data": [
    {
      "band": "20m",
      "count": 45
    },
    {
      "band": "40m",
      "count": 32
    },
    {
      "band": "80m",
      "count": 18
    }
  ],
  "meta": {
    "totalBands": 3,
    "totalSpots": 95
  }
}
```

#### API v2: Get Available Sources

```http
GET /api/v2/sources
```

Returns a list of all sources currently present in the spot cache with spot counts.

**Example Response:**

```json
{
  "status": "success",
  "version": "2.0.0",
  "timestamp": "2025-11-09T12:34:56.789Z",
  "data": [
    {
      "source": "NC7J",
      "type": "cluster",
      "count": 45
    },
    {
      "source": "DXSPOTS",
      "type": "cluster",
      "count": 38
    },
    {
      "source": "pota",
      "type": "external",
      "count": 30
    },
    {
      "source": "sota",
      "type": "external",
      "count": 22
    }
  ],
  "meta": {
    "totalSources": 4,
    "totalSpots": 135
  }
}
```

#### API v2: Get Band Activity Heatmap

```http
GET /api/v2/heatmap
GET /api/v2/heatmap?continent=EU
```

Returns band activity heatmap showing number of spots organized by DE continent (spotter), band, and DX continent (spotted station). Data is cached for 15 minutes to optimize performance.

**Query Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `continent` | string | Filter by DE continent (spotter's continent) | `?continent=EU` |

**Example Response:**

```json
{
  "status": "success",
  "version": "2.0.0",
  "timestamp": "2025-11-10T15:30:00.000Z",
  "data": {
    "continents": ["EU", "NA", "SA", "AS", "AF", "OC"],
    "bands": ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "4m", "2m", "70cm"],
    "data": {
      "EU": {
        "20m": {
          "EU": 45,
          "NA": 23,
          "AS": 12,
          "AF": 8,
          "SA": 5,
          "OC": 3
        },
        "40m": {
          "EU": 34,
          "NA": 18,
          "AS": 7
        }
      },
      "NA": {
        "20m": {
          "NA": 38,
          "EU": 29,
          "SA": 15
        }
      }
    },
    "generatedAt": "2025-11-10T15:30:00.000Z",
    "totalSpots": 1234,
    "cacheExpiresIn": 900
  },
  "meta": {
    "cached": true,
    "cacheAgeSeconds": 45,
    "cacheTTLSeconds": 900
  }
}
```

**Use Cases:**
- Generate band activity heatmaps like your attached image
- Visualize propagation patterns between continents
- Identify optimal bands for specific DE→DX continent paths
- Monitor real-time band conditions by geographic region

**Example: Get only European spotter activity:**
```bash
curl "https://your-api.com/api/v2/heatmap?continent=EU"
```

#### API v2: Get API Info

```http
GET /api/v2/info
```

Returns information about the API v2 capabilities, available filters, and configuration.

**Example Response:**

```json
{
  "status": "success",
  "version": "2.0.0",
  "timestamp": "2025-11-09T12:34:56.789Z",
  "data": {
    "name": "DXClusterAPI v2",
    "version": "2.0.0",
    "description": "Modern REST API for DX Cluster spots with advanced filtering",
    "authentication": {
      "required": false,
      "method": "X-API-Key header"
    },
    "endpoints": {
      "spots": "/api/v2/spots",
      "spotsByCallsign": "/api/v2/spots/:callsign",
      "spotByFrequency": "/api/v2/spot/:qrg",
      "bands": "/api/v2/bands",
      "sources": "/api/v2/sources",
      "info": "/api/v2/info"
    },
    "filters": {
      "band": "Filter by band (e.g., 20m, 40m)",
      "continent": "Filter by continent code (NA, EU, AS, AF, OC, SA, AN)",
      "source": "Filter by source name",
      "maxAge": "Maximum age in seconds",
      "minFreq": "Minimum frequency in kHz",
      "maxFreq": "Maximum frequency in kHz",
      "contest": "Filter contest spots (true/false)",
      "pota": "Filter POTA spots (true/false)",
      "sota": "Filter SOTA spots (true/false)",
      "iota": "Filter IOTA spots (true/false)",
      "wwff": "Filter WWFF spots (true/false)",
      "limit": "Maximum spots to return (default: 100, max: 500)",
      "offset": "Number of spots to skip (pagination)"
    },
    "features": [
      "Standardized JSON responses",
      "Optional API key authentication",
      "Advanced multi-parameter filtering",
      "Pagination support",
      "Continent-based filtering",
      "Activity type filtering (POTA/SOTA/IOTA/WWFF)",
      "Contest detection",
      "Frequency range filtering",
      "Time-based filtering (maxAge)"
    ]
  }
}
```

#### API v2 Error Handling

All errors return a standardized error response:

```json
{
  "status": "error",
  "version": "2.0.0",
  "timestamp": "2025-11-09T12:34:56.789Z",
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  }
}
```

**Common Error Codes:**
- `AUTH_REQUIRED`: API key is required but not provided
- `INVALID_API_KEY`: Provided API key is incorrect
- `INVALID_PARAMETER`: Query parameter has invalid value
- `NOT_FOUND`: Requested resource not found

#### API v2 Examples

**Complex Filtering:**

```bash
# European POTA activations on 20m from the last 10 minutes
curl "http://localhost:3000/api/v2/spots?continent=EU&pota=true&band=20m&maxAge=600"

# Contest spots on CW bands (7000-7040 kHz)
curl "http://localhost:3000/api/v2/spots?contest=true&minFreq=7000&maxFreq=7040"

# SOTA spots on VHF (144 MHz)
curl "http://localhost:3000/api/v2/spots?sota=true&minFreq=144000&maxFreq=148000"
```

**With Authentication:**

```bash
# Set API key in header
export API_KEY="your-secret-api-key-here"

curl -H "X-API-Key: $API_KEY" "http://localhost:3000/api/v2/spots?band=20m"
```

**JavaScript (fetch API):**

```javascript
// Without authentication - using URL query parameters
const response = await fetch('http://localhost:3000/api/v2/spots?band=20m&maxAge=300');
const data = await response.json();

if (data.status === 'success') {
  console.log(`Found ${data.meta.returned} spots on 20m`);
  data.data.forEach(spot => {
    console.log(`${spot.spotted} on ${spot.frequency} kHz`);
  });
}

// With authentication
const authResponse = await fetch('http://localhost:3000/api/v2/spots?pota=true', {
  headers: {
    'X-API-Key': 'your-secret-api-key-here'
  }
});
```

**Note:** API v2 uses **URL query parameters** (not JSON body). All filters are passed as query strings in the URL.

### Info Web Interface
```http
GET /info
```

Access the built-in web interface for viewing spots.

### WebSocket

Connect to the same host/port for real-time spot streaming:

```javascript
const ws = new WebSocket('ws://localhost:3000');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'spot') {
    console.log('New spot:', data.data);
  }
};
```

## Module Configuration

### Enabling/Disabling Modules

Edit your `.env` file:

```bash
# Enable/Disable API versions
API_V1_ENABLED=true
API_V2_ENABLED=true
API_V2_KEY=  # Leave empty for open access

# Enable POTA
POTA_ENABLED=true
POTA_POLLING_INTERVAL=120

# Disable SOTA
SOTA_ENABLED=false

# Disable WebSocket (for Passenger/shared hosting)
WEBSOCKET_ENABLED=false

# Other modules
CLUSTER_ENABLED=true
ENRICHMENT_ENABLED=true
MODE_CLASSIFIER_ENABLED=true
ANALYTICS_ENABLED=true
LIVE_PAGE_ENABLED=true
```

### Adding More Modules

Future modules (WWFF, etc.) can be added by:
1. Creating a new module directory (e.g., `modules/wwff/`)
2. Adding configuration to `.env.sample`
3. Initializing in `app.js` similar to POTA/SOTA

## Development

### Running in Development Mode

```bash
npm run dev
```

### Project Structure

```
DXClusterAPI/
├── index.js              # Entry point / launcher
├── app.js                # Main application
├── .env                  # Configuration (gitignored)
├── .env.sample           # Configuration template
├── package.json          # Dependencies
├── docker-compose.yaml   # Docker configuration
├── Dockerfile            # Docker image
├── .htaccess.example     # Passenger configuration example
├── lib/                  # Shared libraries
│   ├── dxcluster.js      # DX Cluster connection class (used by clusters & RBN)
│   └── utils.js          # Shared utility functions
├── modules/
│   ├── apiv1/            # API v1 module (legacy)
│   │   └── index.js
│   ├── apiv2/            # API v2 module (modern)
│   │   └── index.js
│   ├── clusters/         # Cluster connections module
│   │   └── index.js
│   ├── enrichment/       # Spot enrichment module
│   │   └── index.js
│   ├── analytics/        # API analytics module
│   │   └── index.js
│   ├── metrics/          # Prometheus metrics module
│   │   └── index.js
│   ├── rate-limiter/     # Rate limiting module
│   │   └── index.js
│   ├── pota/             # POTA module
│   │   └── index.js
│   ├── sota/             # SOTA module
│   │   └── index.js
│   ├── rbn/              # RBN module
│   │   └── index.js
│   └── modeclassifier/   # Mode classification module
│       └── index.js
├── public/
│   ├── info/
│   │   └── index.html    # Info web interface
│   ├── index.html        # Redirect to wavelog.org
│   └── robots.txt        # Search engine exclusion
├── data/                 # Data files (analytics, etc.)
└── logs/                 # Log files (auto-created)
```

### Adding a New DX Cluster

Edit your `.env` file and add to the `CLUSTERS` array:

```bash
CLUSTERS=[
  {"host":"dxspots.com","port":7300,"loginPrompt":"login:","call":"TE1ST","password":"","cluster":"DXSPOTS"},
  {"host":"dxc.nc7j.com","port":7300,"loginPrompt":"login:","call":"TE1ST","password":"","cluster":"NC7J"}
]
```

**Popular DX Clusters:**
- `dxspots.com:7300` - Fast, reliable, worldwide coverage (recommended)
- `dxc.nc7j.com:7300` - Well-established, North American focus
- `dxfun.com:8000` - Alternative cluster option

## Troubleshooting

### WebSocket Not Working in Passenger Mode

WebSocket protocol upgrades are often blocked by reverse proxies on shared hosting. The live page automatically detects this and falls back to polling mode (fetching `/spots` every 2 seconds).

**Options:**
- **Recommended:** Leave `WEBSOCKET_ENABLED=true` - the live page will auto-detect and use polling
- **Alternative:** Set `WEBSOCKET_ENABLED=false` to disable WebSocket server initialization entirely

Both approaches work on shared hosting. The polling fallback provides a seamless user experience.

### DXCC Lookups Failing

- Verify `WAVELOG_URL` and `WAVELOG_KEY` are correct
- Check network connectivity to the Wavelog server
- Review logs in `logs/` directory

### Application Won't Start

1. Check `.env` file exists and is properly formatted
2. Verify all required environment variables are set
3. Check logs: `tail -f logs/app-YYYYMMDD.log`
4. Ensure port is not already in use

### Docker Container Crashes

```bash
# Check logs
docker-compose logs

# Rebuild container
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### High Memory Usage

- Reduce `MAXCACHE` in `.env`
- Increase polling intervals for POTA/SOTA
- Limit number of connected DX clusters
- Check `SPOT_MAX_AGE` setting (default 120 minutes)

## Security & Monitoring

### Rate Limiting & DDoS Protection

The API includes built-in rate limiting to protect against abuse and DDoS attacks:

- **General endpoints:** 120 requests/minute per IP (2 req/sec)
- **Spot data endpoints:** 60 requests/minute per IP (1 req/sec)
- **Exempt endpoints:** `/health` and `/metrics` (for monitoring)

Rate limits are applied automatically to:
- API v1: `/spots`, `/spots/:band`, `/spots/source/:source`, `/spot/:qrg`
- API v2: `/api/v2/spots`, `/api/v2/spots/:callsign`

When rate limit is exceeded, clients receive:
```json
{
  "error": "Too many spot requests, please try again later"
}
```

The 60 requests/minute limit accommodates typical client polling intervals (every 59-60 seconds).

### Prometheus Metrics

Monitor your API with Prometheus metrics at `/metrics`:

```http
GET /metrics
```

**Available metrics:**
- `http_request_duration_seconds` - HTTP request latency histogram
- `dxcluster_spots_total` - Total number of cached spots
- `dxcluster_websocket_connections` - Active WebSocket connections
- `dxcluster_cluster_connections` - DX cluster connection status by cluster
- `dxcluster_spots_by_band` - Spot count per band (20m, 40m, etc.)
- Plus standard Node.js metrics (CPU, memory, event loop, GC)

**Prometheus configuration example:**
```yaml
scrape_configs:
  - job_name: 'dxcluster-api'
    scrape_interval: 30s
    static_configs:
      - targets: ['your-server.com:3000']
    metrics_path: '/metrics'
```

**Grafana dashboard tips:**
- Track request latency with `http_request_duration_seconds`
- Monitor spot cache size with `dxcluster_spots_total`
- Alert on cluster disconnections with `dxcluster_cluster_connections`
- Visualize band activity with `dxcluster_spots_by_band`

### API v2 Authentication

Protect API v2 endpoints with API key authentication:

```bash
# In .env file
API_V2_KEY=your-secret-key-here
```

Clients must include the key in requests:
```http
GET /api/v2/spots
X-API-Key: your-secret-key-here
```

Without a valid key, API v2 returns `401 Unauthorized`. API v1 remains open for backward compatibility.

### Rate Limiting

If you experience API rate limiting from POTA or SOTA:
- Increase `POTA_POLLING_INTERVAL` and `SOTA_POLLING_INTERVAL` in `.env`
- Minimum recommended: 120 seconds (2 minutes)
- POTA API has usage limits - respect them by not polling too frequently

### DXCC Cache

The application features an **aggressive DXCC caching system** optimized to minimize RAM usage on shared hosting:

**Caching Strategy:**
- **Callsign Normalization**: Strips `/P`, `/M`, `/QRP` and other portable suffixes to increase cache hits
- **Large Cache Size**: 20,000 callsigns (default)
- **Long TTL**: 7-day callsign cache with automatic cleanup
- **Concurrency Limiting**: Configurable concurrent DXCC lookups (default: 2, set via `MAX_CONCURRENT_DXCC`)
- **LRU Eviction**: Least Recently Used entries removed when cache is full
- **Failed Lookup Cache**: 5-minute cache for bad callsigns to prevent repeated failed lookups
- **Optimized Wavelog API**: Uses `lookup_v2()` endpoint for minimal PHP overhead

**Cache Hit Optimization:**
1. `W1ABC` and `W1ABC/P` → Same cache entry (normalized to `W1ABC`)
2. Full callsign lookup caches accurate DXCC + LoTW data for 7 days
3. Duplicate lookups return instantly from cache without PHP calls

**Expected Results:**
- **Cache Hit Rate**: 95%+ after warmup period
- **PHP Requests**: Reduced by 95%+ compared to no caching
- **RAM Usage**: 600MB total (was 3.3GB) on FreeBSD hosting with 1GB limit
- **PHP-FPM Processes**: Reduced from 24 to 2-3 processes

**Configuration:**
- Set `MAX_CONCURRENT_DXCC` in `.env` to control concurrent PHP requests (default: 2)
- Lower values (1-2) reduce PHP-FPM memory usage but slow spot processing
- Higher values (3-5) speed up processing but require more PHP-FPM workers
- See `DXCC_OPTIMIZATION.md` for technical details

**Memory Optimization Features:**
- Bounded spot array with automatic LRU eviction
- WebSocket ping/pong for detecting dead clients (30-second heartbeat)
- All module caches bounded with size limits (POTA: 500, SOTA: 500, RBN: 2000, Analytics: 1000 clients)
- Map-based caching for O(1) lookups instead of O(n) array scans
- Optimized spot removal using binary search (O(n log n) instead of O(n²))

**Hosting Requirements:**
- **Minimum RAM**: 1.5GB recommended (was 1GB)
- **Node.js**: v18+ recommended
- **External Service**: Wavelog PHP-FPM for DXCC lookups (can consume significant RAM if cache isn't working)

**Troubleshooting High RAM Usage:**

If you're experiencing high RAM usage (>1GB):

1. **Check if PHP-FPM is the culprit** (not Node.js):
   ```bash
   top -o res  # FreeBSD
   ps aux | grep php-fpm  # Linux
   ```
   If you see many PHP-FPM processes (>10) each using 100MB+, the issue is likely DXCC lookups.

2. **Verify DXCC cache is working**:
   ```bash
   curl http://yourserver.com/health | json_pp
   ```
   Check `cache.dxccCache` value. It should grow over time.

3. **Check live page memory details**:
   - Open live page (`/live`)
   - Click the "🧠 System Info" button
   - Review cache statistics and memory usage

4. **Reduce cache size if needed** (edit `app.js`):
   ```javascript
   const DXCC_CACHE_MAX_SIZE = 10000;  // Reduce from 20000
   ```

5. **Increase PHP-FPM cache on external server** (if you control Wavelog):
   - Configure PHP OPcache
   - Increase APCu cache size
   - Consider using Redis for DXCC caching in Wavelog

See `DXCC_OPTIMIZATION.md` for comprehensive technical documentation.

## Performance Tips

### Optimize for High-Traffic Deployments

1. **Increase cache size**: Set `MAXCACHE=500` or higher for busy servers
2. **Use WebSocket**: Enables push instead of pull for connected clients
3. **Adjust polling intervals**: Balance freshness vs server load
4. **Monitor memory**: Check `/health` endpoint regularly
5. **Enable file logging**: Set `FILE_LOGGING_ENABLED=true` for debugging
6. **Restrict browser access**: Edit CORS settings in `app.js` if needed to limit which domains can access your API

### Logging

- Application logs HTTP requests in access.log style to console (or log files if `FILE_LOGGING_ENABLED=true`)
- Use PM2 for production logging: `pm2 start index.js --name dxcluster-api`
- Log files are automatically rotated based on `LOG_RETENTION_DAYS` setting

### Production Recommendations

```bash
# Recommended .env settings for production
MODE=docker
MAXCACHE=500
POTA_POLLING_INTERVAL=120
SOTA_POLLING_INTERVAL=120
ENRICHMENT_ENABLED=true
MODE_CLASSIFIER_ENABLED=true
WEBSOCKET_ENABLED=true
FILE_LOGGING_ENABLED=true
LOG_RETENTION_DAYS=7
```

## License

MIT

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Support

For issues and questions:
- GitHub Issues: https://github.com/int2001/DXClusterAPI/issues
- Documentation: See this README

## Contributors

- [@int2001](https://github.com/int2001) - Joerg (DJ7NT) - Original project creator
- [@DB4SCW](https://github.com/DB4SCW) - Stefan (DB4SCW) - Contributor
- [@winnieXY](https://github.com/winnieXY) - Patrick Winnertz - Contributor
- [@szporwolik](https://github.com/szporwolik) - Szymon Porwolik - Version 2.0.0 refactor and enhancements
