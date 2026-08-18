#!/usr/bin/env node
'use strict';

const { runCli } = require('../lib/deploy.js');

runCli(process.argv.slice(2)).catch((error) => {
  console.error(String(error && error.stack ? error.stack : error));
  process.exit(1);
});
