import { initializeAppIdentity } from './margin/appIdentity';
import { installMainLogging } from './logging';

// Static imports in main are bundled ahead of its body. Load them only after
// identity setup: CredentialsManager fixes its path when its module is evaluated.
const enableFileLogging = installMainLogging();
initializeAppIdentity();
enableFileLogging();
require('./main');
