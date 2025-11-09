#!/usr/bin/env node
"use strict";

// ================================================================
// DXClusterAPI Launcher
// ================================================================
// This file serves as the entry point for the application.
// It determines the runtime mode and launches accordingly:
//   - Native/Docker: Runs the server directly
//   - Passenger: Exports the Express app for Passenger to manage
// ================================================================

// Load environment variables first
require('dotenv').config();

// Detect runtime mode
const mode = process.env.MODE || 'native';

console.log(`Starting DXClusterAPI in ${mode.toUpperCase()} mode...`);

if (mode === 'passenger') {
    // For Passenger mode: require app.js (which initializes everything and exports the app)
    // Then export it so Passenger can use it
    const app = require('./app.js');
    module.exports = app;
} else {
    // For Docker and Native modes: just require app.js which starts its own server
    require('./app.js');
}
