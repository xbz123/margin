'use strict';
const path = require('node:path');
const { assertDiagnosticEnv, afterPack } = require('./package-inventory.cjs');
assertDiagnosticEnv();
const config = require('../../electron-builder.config.cjs');
module.exports = {
  ...config,
  directories: { ...config.directories, output: path.join(process.env.RUNNER_TEMP, 'margin-package-inventory', 'package') },
  afterPack,
  afterSign: null,
  afterAllArtifactBuild: null,
  publish: null,
  forceCodeSigning: false,
  mac: { ...config.mac, identity: null, notarize: false },
};
