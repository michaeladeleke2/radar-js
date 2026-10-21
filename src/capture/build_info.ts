/** The radar-js build that is running: version, git commit, and whether the working tree had uncommitted changes. */
export const BUILD = {
  version: typeof __RADAR_JS_VERSION__ === 'string' ? __RADAR_JS_VERSION__ : 'unknown',
  commit: typeof __RADAR_JS_COMMIT__ === 'string' ? __RADAR_JS_COMMIT__ : 'unknown',
  dirty: typeof __RADAR_JS_DIRTY__ === 'boolean' ? __RADAR_JS_DIRTY__ : false,
};
