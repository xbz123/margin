'use strict';
// electron-builder config for the AG-25 CI build (scripts/build-local.cjs): the
// normal config with a dedicated output directory, no publishing and no identity
// signing. The normal afterPack hook verifies notices and signs ad hoc.
const config = require('../../electron-builder.config.cjs');
if (!process.env.MARGIN_PACKAGE_OUT) throw new Error('MARGIN_PACKAGE_OUT is required');
module.exports = {
  ...config,
  directories: { ...config.directories, output: process.env.MARGIN_PACKAGE_OUT },
  publish: null,
  forceCodeSigning: false,
  // A test-only SQLite extension built by better-sqlite3; nothing loads it.
  files: [...config.files, '!**/better-sqlite3/build/Release/test_extension.node'],
  mac: { ...config.mac, identity: null, notarize: false },
};
