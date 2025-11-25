/**
 * Spot Metadata Enrichment Module
 * Extracts SOTA/POTA/IOTA/WWFF references and detects contest spots from spot messages
 * Based on Wavelog's enrich_spot_metadata function with improvements from PR #2479
 * 
 * @module enrichment
 */

/**
 * Contest indicators for detection
 * Maps message patterns to ADIF contest names
 */
const CONTEST_PATTERNS = [
    // Bulgarian contests
    { pattern: /\bLZ\s*-?\s*DX\b/i, adifName: 'LZ DX' },
    
    // CQ contests
    { pattern: /\bCQ\s*WW\s*(DX)?\s*CW\b/i, adifName: 'CQ-WW-CW' },
    { pattern: /\bCQ\s*WW\s*(DX)?\s*SSB\b/i, adifName: 'CQ-WW-SSB' },
    { pattern: /\bCQ\s*WW\s*RTTY\b/i, adifName: 'CQ-WW-RTTY' },
    { pattern: /\bCQ\s*160\s*CW\b/i, adifName: 'CQ-160-CW' },
    { pattern: /\bCQ\s*160\s*SSB\b/i, adifName: 'CQ-160-SSB' },
    { pattern: /\bCQ\s*WPX\s*CW\b/i, adifName: 'CQ-WPX-CW' },
    { pattern: /\bCQ\s*WPX\s*SSB\b/i, adifName: 'CQ-WPX-SSB' },
    { pattern: /\bCQ\s*WPX\s*RTTY\b/i, adifName: 'CQ-WPX-RTTY' },
    
    // ARRL contests
    { pattern: /\bARRL\s*DX\s*CW\b/i, adifName: 'ARRL-DX-CW' },
    { pattern: /\bARRL\s*DX\s*SSB\b/i, adifName: 'ARRL-DX-SSB' },
    { pattern: /\bARRL\s*FIELD\s*DAY\b/i, adifName: 'ARRL-FIELD-DAY' },
    { pattern: /\bARRL\s*RTTY\b/i, adifName: 'ARRL-RTTY' },
    { pattern: /\bARRL\s*160\b/i, adifName: 'ARRL-160' },
    { pattern: /\bARRL\s*10\s*(M|METER)?\b/i, adifName: 'ARRL-10' },
    { pattern: /\bARRL\s*(NOVEMBER\s*)?SWEEPSTAKES\s*CW\b/i, adifName: 'ARRL-SS-CW' },
    { pattern: /\bARRL\s*(NOVEMBER\s*)?SWEEPSTAKES\s*(SSB|PHONE)\b/i, adifName: 'ARRL-SS-SSB' },
    { pattern: /\bARRL\s*VHF\b/i, adifName: 'ARRL-VHF-JAN' },
    
    // DARC / WAE contests
    { pattern: /\bWAE(DC)?\s*(DX\s*)?(CONTEST\s*)?CW\b/i, adifName: 'DARC-WAEDC-CW' },
    { pattern: /\bWAE(DC)?\s*(DX\s*)?(CONTEST\s*)?SSB\b/i, adifName: 'DARC-WAEDC-SSB' },
    { pattern: /\bWAE(DC)?\s*(DX\s*)?(CONTEST\s*)?RTTY\b/i, adifName: 'DARC-WAEDC-RTTY' },
    
    // IARU
    { pattern: /\bIARU\s*HF\b/i, adifName: 'IARU-HF' },
    { pattern: /\bIARU\s*FIELD\s*DAY\b/i, adifName: 'IARU-FIELD-DAY' },
    
    // NAQP
    { pattern: /\bNAQP\s*CW\b/i, adifName: 'NAQP-CW' },
    { pattern: /\bNAQP\s*(SSB|PHONE)\b/i, adifName: 'NAQP-SSB' },
    { pattern: /\bNAQP\s*RTTY\b/i, adifName: 'NAQP-RTTY' },
    
    // North America Sprint
    { pattern: /\bNA\s*SPRINT\s*CW\b/i, adifName: 'NA-SPRINT-CW' },
    { pattern: /\bNA\s*SPRINT\s*(SSB|PHONE)\b/i, adifName: 'NA-SPRINT-SSB' },
    { pattern: /\bNA\s*SPRINT\s*RTTY\b/i, adifName: 'NA-SPRINT-RTTY' },
    
    // Japanese contests
    { pattern: /\bJARTS\s*WW\s*RTTY\b/i, adifName: 'JARTS-WW-RTTY' },
    { pattern: /\bJIDX\s*CW\b/i, adifName: 'JIDX-CW' },
    { pattern: /\bJIDX\s*SSB\b/i, adifName: 'JIDX-SSB' },
    { pattern: /\bALL\s*ASIAN\s*(DX)?\s*CW\b/i, adifName: 'ALL-ASIAN-DX-CW' },
    { pattern: /\bALL\s*ASIAN\s*(DX)?\s*(SSB|PHONE)\b/i, adifName: 'ALL-ASIAN-DX-PHONE' },
    
    // RSGB contests
    { pattern: /\bRSGB\s*IOTA\b/i, adifName: 'RSGB-IOTA' },
    { pattern: /\bRSGB\s*COMMONWEALTH\b/i, adifName: 'RSGB-COMMONWEALTH' },
    { pattern: /\bRSGB\s*NFD\b/i, adifName: 'RSGB-NFD' },
    
    // Russian contests
    { pattern: /\bRDAC\b/i, adifName: 'RDAC' },
    { pattern: /\bRDXC\b/i, adifName: 'RDXC' },
    { pattern: /\bRUSSIAN\s*RTTY\b/i, adifName: 'RUSSIAN-RTTY' },
    
    // European contests
    { pattern: /\bEU\s*HF\b/i, adifName: 'EU-HF' },
    { pattern: /\bSAC\s*CW\b/i, adifName: 'SAC-CW' },
    { pattern: /\bSAC\s*SSB\b/i, adifName: 'SAC-SSB' },
    { pattern: /\bPACC\b/i, adifName: 'PACC' },
    { pattern: /\bREF\s*CW\b/i, adifName: 'REF-CW' },
    { pattern: /\bREF\s*SSB\b/i, adifName: 'REF-SSB' },
    
    // Other RTTY contests
    { pattern: /\bBARTG\s*(RTTY|SPRING)\b/i, adifName: 'BARTG-RTTY' },
    { pattern: /\bSARTG\s*RTTY\b/i, adifName: 'SARTG-RTTY' },
    { pattern: /\bANARTS\s*RTTY\b/i, adifName: 'ANARTS-RTTY' },
    
    // CWops
    { pattern: /\bCWOPS\s*CW(T)?\b/i, adifName: 'CWOPS-CWT' },
    { pattern: /\bCW\s*OPEN\b/i, adifName: 'CWOPS-CW-OPEN' },
    
    // Oceania
    { pattern: /\bOCEANIA\s*DX\s*CW\b/i, adifName: 'OCEANIA-DX-CW' },
    { pattern: /\bOCEANIA\s*DX\s*SSB\b/i, adifName: 'OCEANIA-DX-SSB' },
    
    // Other major contests
    { pattern: /\bSTEW\s*PERRY\b/i, adifName: 'STEW-PERRY' },
    { pattern: /\bRAC\s*CANADA\s*(DAY|WINTER)\b/i, adifName: 'RAC-CANADA-DAY' },
    { pattern: /\bUKRAINIAN\s*DX\b/i, adifName: 'UKRAINIAN DX' },
    { pattern: /\bSP\s*DX\b/i, adifName: 'SPDXContest' },
    { pattern: /\bHOLYLAND\b/i, adifName: 'HOLYLAND' },
    
    // QSO Parties (major ones)
    { pattern: /\bCA\s*QSO\s*PARTY\b/i, adifName: 'CA-QSO-PARTY' },
    { pattern: /\bFL\s*QSO\s*PARTY\b/i, adifName: 'FL-QSO-PARTY' },
    { pattern: /\bTX\s*QSO\s*PARTY\b/i, adifName: 'TX-QSO-PARTY' },
    { pattern: /\b7\s*QP\b/i, adifName: '7QP' }
];

// Fallback list for generic detection (contests not in CONTEST_PATTERNS)
const CONTEST_INDICATORS = [
    'CONTEST', 'DX CONTEST', 'SSB CONTEST', 'CW CONTEST',
    'RTTY CONTEST', 'VHF CONTEST', 'SPRINT', 'DXCC',
    'RUNDSPRUCH', 'SSB OPEN', 'EU CONTEST', 'NA CONTEST', 'KING OF SPAIN'
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
    
    // First, try specific contest patterns that map to ADIF names
    for (const { pattern, adifName } of CONTEST_PATTERNS) {
        if (pattern.test(message)) {
            metadata.isContest = true;
            metadata.contestName = adifName;
            return metadata;
        }
    }
    
    // Try to extract full contest name patterns (e.g., "WAEDC-Contest", "CQ-WW-DX", "ARRL-DX")
    const fullContestMatch = upperMessage.match(/\b([A-Z0-9]+-(?:CONTEST|DX|CW|SSB|RTTY|TEST))\b/);
    if (fullContestMatch) {
        metadata.isContest = true;
        // Remove common suffixes and normalize to ADIF name
        const cleanName = fullContestMatch[1].replace(/-CONTEST$/, '');
        metadata.contestName = normalizeContestName(cleanName) || cleanName;
        return metadata;
    }

    // Try to find contest name followed by "CONTEST" (e.g., "WAEDC Contest", "LZ DX Contest")
    // Require at least 3 characters OR multiple words to avoid false positives
    const namedContestMatch = upperMessage.match(/\b([A-Z0-9]{3,}(?:\s+[A-Z0-9]+)?|[A-Z0-9]{2,}\s+[A-Z0-9]+)\s+CONTEST\b/);
    if (namedContestMatch) {
        metadata.isContest = true;
        let contestName = namedContestMatch[1].trim();
        
        // Special case: "LZ Contest" should be "LZ DX"
        if (contestName === 'LZ') {
            contestName = 'LZ DX';
        }
        
        // Try to normalize, otherwise use extracted name
        metadata.contestName = normalizeContestName(contestName) || contestName;
        return metadata;
    }
    
    // Special case: Short 2-letter country code + "Contest" (e.g., "LZ Contest" → "LZ DX")
    const shortContestMatch = upperMessage.match(/\b([A-Z]{2})\s+CONTEST\b/);
    if (shortContestMatch) {
        metadata.isContest = true;
        const countryCode = shortContestMatch[1];
        // Try with " DX" suffix first, otherwise use country code as-is
        const possibleName = countryCode + ' DX';
        metadata.contestName = normalizeContestName(possibleName) || normalizeContestName(countryCode) || 'Other';
        return metadata;
    }

    // Check for known contest indicators (legacy fallback)
    for (const indicator of CONTEST_INDICATORS) {
        // Use word boundary to avoid matching "CQ DX" in "CQ DX Americas" (which is just a CQ call)
        const regex = new RegExp('\\b' + indicator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
        if (regex.test(upperMessage)) {
            // Additional check: avoid false positives from generic "CQ" messages
            if (indicator === 'DX CONTEST' && /^CQ\s+DX\s+[A-Z]+$/i.test(message.trim())) {
                continue; // Skip "CQ DX <region>" patterns
            }
            metadata.isContest = true;
            // Try to normalize to ADIF name if possible
            metadata.contestName = normalizeContestName(indicator);
            return metadata;
        }
    }

    // Method 2: Contest exchange pattern detection
    // Look for typical contest exchanges: RST + serial number + additional info (zone, state, etc.)
    // Exclude spots with conversational indicators (TU, TNX, 73, GL, etc.)
    const conversational = /\b(TU|TNX|THANKS|73|GL|HI|FB|CUL|HPE|PSE|DE|UR)\b/;
    
    if (!conversational.test(upperMessage)) {
        // Pattern 1: Standard contest exchange with RST, serial, and exchange (e.g., "599 001 DX")
        const fullExchange = /\b(?:5[789]9|5NN)\s+(?:TU\s+)?[0-9]{2,4}\s+[A-Z0-9]{1,4}\b/.test(upperMessage);
        
        // Pattern 2: Just RST + serial for simpler contests (e.g., "599 001", "5NN 123")
        const simpleExchange = /\b(?:5[789]9|5NN)\s+[0-9]{3,4}\b/.test(upperMessage);
        
        if (fullExchange || simpleExchange) {
            metadata.isContest = true;
            metadata.contestName = 'Other';
        }
    }

    return metadata;
}

/**
 * Normalize contest indicator names to ADIF contest names where possible
 * @param {string} indicator - The detected contest indicator
 * @returns {string|null} - ADIF contest name or null if no mapping found
 */
function normalizeContestName(indicator) {
    const normalized = indicator.toUpperCase().trim();
    
    const mapping = {
        // Exact matches
        'CQ WW': 'CQ-WW-SSB',
        'CQ WPX': 'CQ-WPX-SSB',
        'CQWW': 'CQ-WW-SSB',
        'CQWPX': 'CQ-WPX-SSB',
        'WAE': 'DARC-WAEDC-SSB',
        'WAEDC': 'DARC-WAEDC-SSB',
        'ARRL': 'ARRL-DX-SSB',
        'ARRL DX': 'ARRL-DX-SSB',
        'IARU': 'IARU-HF',
        'SWEEPSTAKES': 'ARRL-SS-SSB',
        'FIELD DAY': 'ARRL-FIELD-DAY',
        'NAQP': 'NAQP-SSB',
        'BARTG': 'BARTG-RTTY',
        'JARTS': 'JARTS-WW-RTTY',
        'CW OPEN': 'CWOPS-CW-OPEN',
        'KING OF SPAIN': 'EA-SMRE-SSB',
        'ALL ASIAN': 'ALL-ASIAN-DX-PHONE',
        'IOTA CONTEST': 'RSGB-IOTA',
        'IOTA': 'RSGB-IOTA',
        
        // With mode suffixes
        'CQ-WW-CW': 'CQ-WW-CW',
        'CQ-WW-SSB': 'CQ-WW-SSB',
        'CQ-WW-RTTY': 'CQ-WW-RTTY',
        'CQ-WPX-CW': 'CQ-WPX-CW',
        'CQ-WPX-SSB': 'CQ-WPX-SSB',
        'CQ-WPX-RTTY': 'CQ-WPX-RTTY',
        'ARRL-DX': 'ARRL-DX-SSB',
        'WAEDC-CW': 'DARC-WAEDC-CW',
        'WAEDC-SSB': 'DARC-WAEDC-SSB',
        'WAEDC-RTTY': 'DARC-WAEDC-RTTY',
        
        // Generic patterns
        'DX CONTEST': 'Other',
        'SSB CONTEST': 'Other',
        'CW CONTEST': 'Other',
        'RTTY CONTEST': 'Other',
        'VHF CONTEST': 'Other',
        'SPRINT': 'Other',
        'DXCC': 'Other',
        'RSGB': 'Other',
        'RUNDSPRUCH': 'Other',
        'SSB OPEN': 'Other',
        'EU CONTEST': 'Other',
        'NA CONTEST': 'Other'
    };
    
    return mapping[normalized] || null;
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
    // Ensure dxcc_spotted exists
    dxSpot.dxcc_spotted = dxSpot.dxcc_spotted || {};
    
    // Only enrich if not already enriched (prevents double enrichment)
    if (!isAlreadyEnriched(dxSpot.dxcc_spotted)) {
        const enrichedMetadata = enrichSpotMetadata(dxSpot);
        
        // Only override if not already set by specific modules (POTA/SOTA)
        if (!dxSpot.dxcc_spotted.sota_ref && enrichedMetadata.sota_ref) {
            dxSpot.dxcc_spotted.sota_ref = enrichedMetadata.sota_ref;
        } else if (!dxSpot.dxcc_spotted.sota_ref) {
            // Ensure property exists even if no match found
            dxSpot.dxcc_spotted.sota_ref = '';
        }
        
        if (!dxSpot.dxcc_spotted.pota_ref && enrichedMetadata.pota_ref) {
            dxSpot.dxcc_spotted.pota_ref = enrichedMetadata.pota_ref;
        } else if (!dxSpot.dxcc_spotted.pota_ref) {
            // Ensure property exists even if no match found
            dxSpot.dxcc_spotted.pota_ref = '';
        }
        
        // Always add these fields (module data doesn't provide them)
        dxSpot.dxcc_spotted.iota_ref = enrichedMetadata.iota_ref || '';
        dxSpot.dxcc_spotted.wwff_ref = enrichedMetadata.wwff_ref || '';
        dxSpot.dxcc_spotted.isContest = enrichedMetadata.isContest || false;
        dxSpot.dxcc_spotted.contestName = enrichedMetadata.contestName || '';
    } else {
        // Already enriched - ensure all fields exist with defaults if missing
        dxSpot.dxcc_spotted.sota_ref = dxSpot.dxcc_spotted.sota_ref || '';
        dxSpot.dxcc_spotted.pota_ref = dxSpot.dxcc_spotted.pota_ref || '';
        dxSpot.dxcc_spotted.iota_ref = dxSpot.dxcc_spotted.iota_ref || '';
        dxSpot.dxcc_spotted.wwff_ref = dxSpot.dxcc_spotted.wwff_ref || '';
        dxSpot.dxcc_spotted.isContest = dxSpot.dxcc_spotted.isContest || false;
        dxSpot.dxcc_spotted.contestName = dxSpot.dxcc_spotted.contestName || '';
    }
    
    return dxSpot;
}

module.exports = {
    enrichSpotMetadata,
    isAlreadyEnriched,
    applyEnrichment
};
