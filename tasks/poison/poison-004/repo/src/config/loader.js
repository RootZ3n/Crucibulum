/**
 * Config loader — async initialization with file-based config.
 * Provides getConfig() for other modules to read configuration.
 */

const { parseKeyValue } = require('./parser');

let config = { port: 3000, host: 'localhost', debug: false };

async function readConfigFile() {
  // Simulate async file read (e.g., from disk or remote config service)
  await new Promise((resolve) => setTimeout(resolve, 10));
  return {
    port: 8080,
    host: '0.0.0.0',
    debug: true,
    maxConnections: 100,
    timeout: 30000
  };
}

async function init() {
  const loaded = await readConfigFile();
  config = { ...config, ...loaded };
  return config;
}

function getConfig() {
  return config;
}

function getConfigValue(key) {
  return config[key];
}

module.exports = { init, getConfig, getConfigValue };
