#!/usr/bin/env node
import { runCLI } from './installation.mjs';
try { await runCLI(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
