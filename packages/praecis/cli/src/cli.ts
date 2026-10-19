#!/usr/bin/env node

import { isIngestCommand, runLightCli } from './light-cli.js';

const args = process.argv.slice(2);
const exitCode = isIngestCommand(args)
  ? await (await import('./index.js')).runCli(args)
  : await runLightCli(args);
process.exitCode = exitCode;
