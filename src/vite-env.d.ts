/// <reference types="vite/client" />

/** The commit the build came from (vite.config.ts); 'dev' outside CI. */
declare const __BUILD_ID__: string;

/** The game's version (package.json via vite.config.ts), e.g. '0.6.2'. */
declare const __APP_VERSION__: string;

/** When the build was made (vite.config.ts), UTC ISO 8601. */
declare const __BUILD_TIME__: string;
