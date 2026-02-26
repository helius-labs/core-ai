import { version } from './version.js';
import { CLI_USER_AGENT } from './http.js';

export { CLI_USER_AGENT };

export const VERSION = version;

// Re-export auth constants from SDK for any remaining local usage
export { PAYMENT_AMOUNT } from "helius-sdk/auth/constants";
