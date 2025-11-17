/**
 * Mode Classifier Module
 * Intelligently classifies amateur radio transmission modes and submodes
 * based on frequency, message content, and program-specific information
 * 
 * Categories:
 * - cw: Morse code transmissions
 * - phone: Voice transmissions (SSB, AM, FM)
 * - digi: Digital modes (FT8, RTTY, PSK, etc.)
 * 
 * @module modeclassifier
 */

class ModeClassifier {
    constructor(config = {}) {
        this.enabled = config.enabled !== false;
        
        // Mode classification constants
        this.modes = {
            CW: ['CW', 'A1A'],
            PHONE: ['SSB', 'LSB', 'USB', 'AM', 'FM', 'SAM', 'DSB', 'J3E', 'A3E', 'PHONE'],
            WSJT: ['FT8', 'FT4', 'JT65', 'JT65B', 'JT6C', 'JT6M', 'JT9', 'JT9-1', 
                   'Q65', 'QRA64', 'FST4', 'FST4W', 'WSPR', 'MSK144', 'ISCAT',
                   'ISCAT-A', 'ISCAT-B', 'JS8', 'JTMS', 'FSK441', 'JT4', 'OPERA'],
            // Enhanced PSK mode list from Wavelog PR #2514
            PSK: ['PSK', 'QPSK', '8PSK', 'PSK31', 'PSK63', 'PSK125', 'PSK250', 'PSK500',
                  'BPSK31', 'BPSK63', 'BPSK125', 'BPSK250', 'QPSK31', 'QPSK63', 'QPSK125',
                  '8PSK125', '8PSK250', '8PSK500', '8PSK1000', 'PSK10', 'PSK1000',
                  'PSKAM', 'PSKAM10', 'PSKAM31', 'PSKAM50', 'PSKFEC31'],
            DIGITAL_OTHER: ['RTTY', 'NAVTEX', 'SITORB', 'DIGI', 'DYNAMIC', 'RTTYFSK', 'RTTYM'],
            DIGITAL_MODES: ['OLIVIA', 'CONTESTIA', 'THOR', 'THROB', 'MFSK', 'MFSK8', 'MFSK16',
                           'HELL', 'MT63', 'DOMINO', 'PACKET', 'PACTOR', 'CLOVER', 'AMTOR',
                           'SITOR', 'SSTV', 'FAX', 'CHIP', 'CHIP64', 'ROS'],
            DIGITAL_VOICE: ['DIGITALVOICE', 'DSTAR', 'C4FM', 'DMR', 'FREEDV', 'M17'],
            DIGITAL_HF: ['VARA', 'ARDOP']
        };
        
        // LSB/USB threshold (below 10 MHz = LSB, above = USB)
        this.lsbUsbThreshold = 10000; // kHz
        
        // Statistics
        this.stats = {
            classified: 0,
            fromMessage: 0,
            fromProgramMode: 0,
            fromFrequency: 0,
            unknown: 0
        };
    }

    /**
     * Classify a spot's mode and submode
     * Priority order (based on Wavelog PR #2514):
     * 1. Program-specific modes (POTA/SOTA/WWFF/IOTA) - most reliable
     * 2. Message content (especially RBN)
     * 3. Explicit mode field
     * 4. Frequency-based guess (band plan)
     * 
     * @param {Object} spot - Spot object with frequency, message, and optional mode fields
     * @returns {Object} {mode: 'cw'|'phone'|'digi', submode: 'CW'|'USB'|'FT8'|etc, confidence: 0-1}
     */
    classifySpot(spot) {
        if (!this.enabled || !spot) {
            return { mode: null, submode: null, confidence: 0 };
        }

        this.stats.classified++;

        // Priority 1: Check for program-specific modes (POTA, SOTA, WWFF, IOTA)
        // These are most reliable as they come directly from activators
        // Fixes Wavelog PR #2514 issues with POTA/SOTA SSB mode handling
        if (spot.dxcc_spotted) {
            const programMode = spot.dxcc_spotted.pota_mode || 
                               spot.dxcc_spotted.sota_mode || 
                               spot.dxcc_spotted.wwff_mode || 
                               spot.dxcc_spotted.iota_mode;
            
            if (programMode && programMode.trim() !== '') {
                this.stats.fromProgramMode++;
                return this.classifyFromModeField(programMode, spot.frequency);
            }
        }
        
        // Also check additional_data for backward compatibility
        if (spot.additional_data) {
            const programMode = spot.additional_data.pota_mode || 
                               spot.additional_data.sota_mode;
            
            if (programMode && programMode.trim() !== '') {
                this.stats.fromProgramMode++;
                return this.classifyFromModeField(programMode, spot.frequency);
            }
        }

        // Priority 2: Parse message for mode indicators (especially for RBN)
        if (spot.message) {
            const messageResult = this.classifyFromMessage(spot.message, spot.frequency);
            if (messageResult.mode) {
                this.stats.fromMessage++;
                return messageResult;
            }
        }

        // Priority 3: Use mode field if provided
        if (spot.mode) {
            return this.classifyFromModeField(spot.mode, spot.frequency);
        }

        // Priority 4: Guess from frequency (band plan)
        if (spot.frequency) {
            this.stats.fromFrequency++;
            return this.classifyFromFrequency(spot.frequency);
        }

        this.stats.unknown++;
        return { mode: 'phone', submode: 'SSB', confidence: 0.3 };
    }

    /**
     * Classify mode from message text (e.g., RBN messages like "CW 25 dB" or "RTTY 44 dB")
     */
    classifyFromMessage(message, frequency) {
        const upperMessage = message.toUpperCase();

        // CW detection
        if (/\bCW\b/.test(upperMessage)) {
            return { mode: 'cw', submode: 'CW', confidence: 1.0 };
        }

        // WSJT-X modes
        const wsjt = this.modes.WSJT.find(m => new RegExp(`\\b${m}\\b`).test(upperMessage));
        if (wsjt) {
            return { mode: 'digi', submode: wsjt, confidence: 1.0 };
        }

        // RTTY and variants
        if (/\bRTTY\b/.test(upperMessage)) {
            return { mode: 'digi', submode: 'RTTY', confidence: 1.0 };
        }

        // PSK modes
        const psk = this.modes.PSK.find(m => new RegExp(`\\b${m}\\b`).test(upperMessage));
        if (psk) {
            return { mode: 'digi', submode: psk, confidence: 1.0 };
        }

        // Phone modes
        if (/\bLSB\b/.test(upperMessage)) {
            return { mode: 'phone', submode: 'LSB', confidence: 1.0 };
        }
        if (/\bUSB\b/.test(upperMessage)) {
            return { mode: 'phone', submode: 'USB', confidence: 1.0 };
        }
        if (/\bSSB\b/.test(upperMessage)) {
            const ssbMode = this.determineSSBMode(frequency);
            return { mode: 'phone', submode: ssbMode, confidence: 0.8 };
        }
        if (/\bAM\b/.test(upperMessage)) {
            return { mode: 'phone', submode: 'AM', confidence: 1.0 };
        }
        if (/\bFM\b/.test(upperMessage)) {
            return { mode: 'phone', submode: 'FM', confidence: 1.0 };
        }

        // Other digital modes
        const digital = this.modes.DIGITAL_MODES.find(m => new RegExp(`\\b${m}\\b`).test(upperMessage));
        if (digital) {
            return { mode: 'digi', submode: digital, confidence: 1.0 };
        }

        return { mode: null, submode: null, confidence: 0 };
    }

    /**
     * Classify mode from explicit mode field
     * Enhanced for Wavelog PR #2514: better SSB/LSB/USB handling for POTA/SOTA
     */
    classifyFromModeField(modeField, frequency) {
        const modeUpper = modeField.toUpperCase().trim();

        // CW modes
        if (this.modes.CW.includes(modeUpper)) {
            return { mode: 'cw', submode: 'CW', confidence: 1.0 };
        }

        // Phone modes - enhanced SSB handling
        if (this.modes.PHONE.includes(modeUpper)) {
            let submode = modeUpper;
            
            // For generic SSB/PHONE, determine LSB/USB from frequency
            // This is critical for POTA/SOTA spots per Wavelog PR #2514
            if (modeUpper === 'SSB' || modeUpper === 'PHONE') {
                submode = this.determineSSBMode(frequency);
            }
            
            return { mode: 'phone', submode: submode, confidence: 1.0 };
        }

        // WSJT-X family
        if (this.modes.WSJT.includes(modeUpper)) {
            return { mode: 'digi', submode: modeUpper, confidence: 1.0 };
        }

        // PSK family - enhanced with more variants per Wavelog PR #2514
        if (this.modes.PSK.some(m => modeUpper.includes(m))) {
            // Try to find exact match first
            const exactMatch = this.modes.PSK.find(m => modeUpper === m);
            if (exactMatch) {
                return { mode: 'digi', submode: exactMatch, confidence: 1.0 };
            }
            // Otherwise use the input mode
            return { mode: 'digi', submode: modeUpper, confidence: 1.0 };
        }

        // Other digital modes
        if (this.modes.DIGITAL_OTHER.includes(modeUpper)) {
            // For generic "DIGI" mode, try to determine actual submode from frequency
            if (modeUpper === 'DIGI' && frequency) {
                const freqResult = this.classifyFromFrequency(frequency);
                // If frequency suggests a specific digital mode, use it
                if (freqResult.mode === 'digi' && freqResult.submode !== 'RTTY') {
                    return { mode: 'digi', submode: freqResult.submode, confidence: 0.8 };
                }
            }
            return { mode: 'digi', submode: modeUpper, confidence: 1.0 };
        }

        if (this.modes.DIGITAL_MODES.includes(modeUpper)) {
            return { mode: 'digi', submode: modeUpper, confidence: 1.0 };
        }

        if (this.modes.DIGITAL_VOICE.includes(modeUpper)) {
            return { mode: 'digi', submode: modeUpper, confidence: 1.0 };
        }

        if (this.modes.DIGITAL_HF.includes(modeUpper)) {
            return { mode: 'digi', submode: modeUpper, confidence: 1.0 };
        }

        // Unknown mode - guess from frequency
        return this.classifyFromFrequency(frequency);
    }

    /**
     * Classify mode from frequency using band plan knowledge
     */
    classifyFromFrequency(frequency) {
        if (!frequency) {
            return { mode: 'phone', submode: 'SSB', confidence: 0.3 };
        }

        const freqKhz = frequency;

        // CW segments (approximate - varies by region)
        const cwRanges = [
            [1800, 1840],   // 160m
            [3500, 3600],   // 80m
            [7000, 7040],   // 40m
            [10100, 10150], // 30m
            [14000, 14070], // 20m
            [18068, 18110], // 17m
            [21000, 21070], // 15m
            [24890, 24930], // 12m
            [28000, 28070]  // 10m
        ];

        for (const [start, end] of cwRanges) {
            if (freqKhz >= start && freqKhz <= end) {
                return { mode: 'cw', submode: 'CW', confidence: 0.7 };
            }
        }

        // Digital segments (FT8, RTTY, PSK)
        const digiRanges = [
            [1838, 1843],   // 160m FT8
            [3573, 3583],   // 80m FT8/RTTY
            [7035, 7045],   // 40m RTTY
            [7070, 7080],   // 40m FT8
            [10130, 10150], // 30m digital
            [14070, 14099], // 20m FT8/RTTY
            [18100, 18110], // 17m FT8
            [21070, 21099], // 15m FT8
            [24915, 24929], // 12m FT8
            [28070, 28120]  // 10m FT8
        ];

        for (const [start, end] of digiRanges) {
            if (freqKhz >= start && freqKhz <= end) {
                // Check for FT8 calling frequencies
                const ft8Freqs = [1840, 3573, 7074, 10136, 14074, 18100, 21074, 24915, 28074];
                for (const ft8Freq of ft8Freqs) {
                    if (Math.abs(freqKhz - ft8Freq) < 5) {
                        return { mode: 'digi', submode: 'FT8', confidence: 0.8 };
                    }
                }
                
                // Check for FT4 calling frequencies
                const ft4Freqs = [3575.5, 7047.5, 10140, 14080, 18104, 21140, 24919, 28180];
                for (const ft4Freq of ft4Freqs) {
                    if (Math.abs(freqKhz - ft4Freq) < 5) {
                        return { mode: 'digi', submode: 'FT4', confidence: 0.8 };
                    }
                }
                
                // Check for WSPR beacon frequencies
                const wsprFreqs = [1836.6, 3568.6, 5287.2, 7038.6, 10138.7, 14095.6, 18104.6, 21094.6, 24924.6, 28124.6];
                for (const wsprFreq of wsprFreqs) {
                    if (Math.abs(freqKhz - wsprFreq) < 1) {
                        return { mode: 'digi', submode: 'WSPR', confidence: 0.9 };
                    }
                }
                
                // Check for PSK31 calling frequencies
                const psk31Freqs = [3580, 7070, 10142, 14070, 18100, 21080, 24920, 28120];
                for (const psk31Freq of psk31Freqs) {
                    if (Math.abs(freqKhz - psk31Freq) < 3) {
                        return { mode: 'digi', submode: 'PSK31', confidence: 0.7 };
                    }
                }
                
                return { mode: 'digi', submode: 'RTTY', confidence: 0.6 };
            }
        }

        // Everything else is phone - determine LSB/USB
        const submode = this.determineSSBMode(freqKhz);
        return { mode: 'phone', submode: submode, confidence: 0.6 };
    }

    /**
     * Determine LSB or USB based on frequency
     * Below 10 MHz = LSB, above = USB
     */
    determineSSBMode(frequency) {
        if (!frequency) return 'SSB';
        return frequency < this.lsbUsbThreshold ? 'LSB' : 'USB';
    }

    /**
     * Get classification statistics
     */
    getStats() {
        return { ...this.stats };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            classified: 0,
            fromMessage: 0,
            fromProgramMode: 0,
            fromFrequency: 0,
            unknown: 0
        };
    }
}

module.exports = ModeClassifier;
