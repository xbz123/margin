'use strict';

// One build-time source for runtime, renderer and package metadata (PLAN.md AG-20).
const identities = {
  temp: Object.freeze({ variant: 'temp', name: 'temp', appId: 'io.github.xbz123.temp' }),
  local: Object.freeze({ variant: 'local', name: 'Natively Local', appId: 'local.natively.desktop' }),
  release: Object.freeze({ variant: 'release', name: 'Margin', appId: 'io.github.xbz123.margin' }),
};

function selectIdentity(env = process.env) {
  const variant = env.MARGIN_APP_VARIANT || 'temp';
  if (!Object.hasOwn(identities, variant)) throw new Error(`Unknown app identity: ${variant}`);
  if (variant === 'release' && (env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true')) {
    throw new Error('The release identity may only be built or tested in GitHub Actions (S15)');
  }
  return identities[variant];
}

module.exports = { selectIdentity };
