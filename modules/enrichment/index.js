/**
 * Spot Metadata Enrichment Module
 * Extracts SOTA/POTA/IOTA/WWFF references and detects contest spots from spot messages
 * Based on Wavelog's enrich_spot_metadata function with improvements from PR #2479
 * 
 * @module enrichment
 */

/**
 * Contest indicators for detection
 */
const CONTEST_INDICATORS = [
    'CONTEST', 'CQ WW', 'CQ WPX', 'ARRL', 'IARU', 'CQWW', 'CQWPX',
    'SWEEPSTAKES', 'FIELD DAY', 'DX CONTEST', 'SSB CONTEST', 'CW CONTEST',
    'RTTY CONTEST', 'VHF CONTEST', 'SPRINT', 'DXCC', 'WAE', 'IOTA CONTEST',
    'NAQP', 'BARTG', 'RSGB', 'RUNDSPRUCH', 'JARTS', 'CW OPEN', 'SSB OPEN',
    'EU CONTEST', 'NA CONTEST', 'KING OF SPAIN', 'ALL ASIAN', 'LZ DX'
];

/**
 * Enrich spot metadata with park references and contest detection
 * Extracts SOTA/POTA/IOTA/WWFF references and detects contest spots
 * 
 * @param {object} spot - Spot object with message property
 * @returns {object} - Enriched metadata object with references and contest flags
 */
function enrichSpotMetadata(spot) {
    // Initialize metadata fields
    const metadata = {
        sota_ref: '',
        pota_ref: '',
        iota_ref: '',
        wwff_ref: '',
        isContest: false,
        contestName: ''
    };

    // Early exit if no message
    const message = spot.message || '';
    if (!message) {
        return metadata;
    }

    const upperMessage = message.toUpperCase();

    // SOTA format: XX/YY-### or XX/YY-#### (e.g., "G/LD-001", "W4G/NG-001", "DL/KW-044")
    // Only extract if not already present
    const sotaMatch = upperMessage.match(/\b([A-Z0-9]{1,3}\/[A-Z]{2}-\d{3,4})\b/);
    if (sotaMatch) {
        metadata.sota_ref = sotaMatch[1];
    }

    // IOTA format: XX-### (e.g., "EU-005", "NA-001", "OC-123")
    // Check IOTA before POTA as it's more specific
    const iotaMatch = upperMessage.match(/\b((?:AF|AN|AS|EU|NA|OC|SA)-\d{3})\b/);
    if (iotaMatch) {
        metadata.iota_ref = iotaMatch[1];
    }

    // WWFF format: XXFF-#### or KFF-#### (e.g., "GIFF-0001", "K1FF-0123", "ON4FF-0050", "KFF-6731")
    // Check WWFF before POTA to avoid conflicts
    const wwffMatch = upperMessage.match(/\b((?:[A-Z0-9]{2,4}FF|KFF)-\d{4})\b/);
    if (wwffMatch) {
        metadata.wwff_ref = wwffMatch[1];
    }

    // POTA format: XX-#### (e.g., "US-4306", "K-1234", "DE-0277")
    // Must not match WWFF patterns (ending in FF) - checked last to avoid conflicts
    const potaMatch = upperMessage.match(/\b([A-Z0-9]{1,5}-\d{4,5})\b/);
    if (potaMatch && !potaMatch[1].includes('FF-')) {
        metadata.pota_ref = potaMatch[1];
    }

    // Contest detection - more strict to avoid false positives
    
    // Special handling for LZ DX Contest with various formats
    if (/\bLZ\s*-?\s*DX\b/i.test(upperMessage)) {
        metadata.isContest = true;
        metadata.contestName = 'LZ DX';
        return metadata;
    }
    
    // First, try to extract full contest name patterns (e.g., "WAEDC-Contest", "CQ-WW-DX", "ARRL-DX")
    const fullContestMatch = upperMessage.match(/\b([A-Z0-9]+-(?:CONTEST|DX|CW|SSB|RTTY|TEST))\b/);
    if (fullContestMatch) {
        metadata.isContest = true;
        // Remove common suffixes to get cleaner contest name
        metadata.contestName = fullContestMatch[1].replace(/-CONTEST$/, '');
        return metadata;
    }

    // Try to find contest name followed by "CONTEST" (e.g., "WAEDC Contest")
    const namedContestMatch = upperMessage.match(/\b([A-Z0-9]{2,})\s+CONTEST\b/);
    if (namedContestMatch) {
        metadata.isContest = true;
        metadata.contestName = namedContestMatch[1];
        return metadata;
    }

    // Check for known contest indicators
    for (const indicator of CONTEST_INDICATORS) {
        // Use word boundary to avoid matching "CQ DX" in "CQ DX Americas" (which is just a CQ call)
        const regex = new RegExp('\\b' + indicator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
        if (regex.test(upperMessage)) {
            // Additional check: avoid false positives from generic "CQ" messages
            if (indicator === 'DX CONTEST' && /^CQ\s+DX\s+[A-Z]+$/i.test(message.trim())) {
                continue; // Skip "CQ DX <region>" patterns
            }
            metadata.isContest = true;
            metadata.contestName = indicator;
            return metadata;
        }
    }

    // Method 2: Contest exchange pattern - must have RST AND serial AND no conversational words
    // Exclude spots with conversational indicators (TU, TNX, 73, GL, etc.)
    const conversational = /\b(TU|TNX|THANKS|73|GL|HI|FB|CUL|HPE|PSE|DE)\b/;
    
    if (!conversational.test(upperMessage)) {
        // Look for typical contest exchange: RST + number (but not just any 599)
        // Must be followed by more structured exchange (not just "ur 599")
        if (/\b(?:599|5NN)\s+(?:TU\s+)?[0-9]{2,4}\b/.test(upperMessage) &&
            !/\bUR\s+599\b/.test(upperMessage)) {
            metadata.isContest = true;
            metadata.contestName = 'CONTEST';
        }
    }

    return metadata;
}

/**
 * Check if enrichment is needed for a spot
 * Returns true if the spot already has all enrichment fields populated
 * 
 * @param {object} dxccSpotted - The dxcc_spotted object
 * @returns {boolean} - True if already enriched, false if needs enrichment
 */
function isAlreadyEnriched(dxccSpotted) {
    if (!dxccSpotted) return false;
    
    // Check if all enrichment fields are present (even if empty)
    // This indicates the spot has been through enrichment before
    return (
        'sota_ref' in dxccSpotted &&
        'pota_ref' in dxccSpotted &&
        'iota_ref' in dxccSpotted &&
        'wwff_ref' in dxccSpotted &&
        'isContest' in dxccSpotted
        // Note: contestName is optional, not checked
    );
}

/**
 * Apply enrichment to a DX spot object
 * 
 * @param {object} dxSpot - The spot object to enrich
 * @param {string} spot_source - Source of the spot (cluster, pota, sota)
 * @returns {object} - The enriched spot object
 */
function applyEnrichment(dxSpot, spot_source = "cluster") {
    // Only enrich if not already enriched (prevents double enrichment)
    if (!isAlreadyEnriched(dxSpot.dxcc_spotted)) {
        const enrichedMetadata = enrichSpotMetadata(dxSpot);
        
        // Merge enriched metadata into dxcc_spotted (preserve existing data)
        dxSpot.dxcc_spotted = dxSpot.dxcc_spotted || {};
        
        // Only override if not already set by specific modules
        if (!dxSpot.dxcc_spotted.sota_ref && enrichedMetadata.sota_ref) {
            dxSpot.dxcc_spotted.sota_ref = enrichedMetadata.sota_ref;
        }
        if (!dxSpot.dxcc_spotted.pota_ref && enrichedMetadata.pota_ref) {
            dxSpot.dxcc_spotted.pota_ref = enrichedMetadata.pota_ref;
        }
        
        // Always add IOTA, WWFF, and contest detection (module data doesn't provide these)
        dxSpot.dxcc_spotted.iota_ref = enrichedMetadata.iota_ref;
        dxSpot.dxcc_spotted.wwff_ref = enrichedMetadata.wwff_ref;
        dxSpot.dxcc_spotted.isContest = enrichedMetadata.isContest;
        if (enrichedMetadata.contestName) {
            dxSpot.dxcc_spotted.contestName = enrichedMetadata.contestName;
        }
    } else {
        // Already enriched - ensure all fields exist with defaults if missing
        dxSpot.dxcc_spotted.sota_ref = dxSpot.dxcc_spotted.sota_ref || '';
        dxSpot.dxcc_spotted.pota_ref = dxSpot.dxcc_spotted.pota_ref || '';
        dxSpot.dxcc_spotted.iota_ref = dxSpot.dxcc_spotted.iota_ref || '';
        dxSpot.dxcc_spotted.wwff_ref = dxSpot.dxcc_spotted.wwff_ref || '';
        dxSpot.dxcc_spotted.isContest = dxSpot.dxcc_spotted.isContest || false;
    }
    
    return dxSpot;
}

module.exports = {
    enrichSpotMetadata,
    isAlreadyEnriched,
    applyEnrichment
};
