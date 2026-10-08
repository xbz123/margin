import { initializeAppIdentity } from './margin/appIdentity';

// Static imports in main are bundled ahead of its body. Load them only after
// identity setup: CredentialsManager fixes its path when its module is evaluated.
initializeAppIdentity();
require('./main');
