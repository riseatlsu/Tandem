const env = import.meta.env;
export const CONFIG = {
  firebase: env.VITE_FIREBASE_API_KEY ? {
    apiKey: env.VITE_FIREBASE_API_KEY as string,
    authDomain: (env.VITE_FIREBASE_AUTH_DOMAIN as string) || `${env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
    projectId: env.VITE_FIREBASE_PROJECT_ID as string,
    appId: env.VITE_FIREBASE_APP_ID as string,
  } : null,
  /** Base URL of the llmProxy function (or the mock LLM in tests), without /v1. */
  llmProxyUrl: (env.VITE_LLM_PROXY_URL as string | undefined)?.replace(/\/$/, '') ?? '',
  functionsUrl: (env.VITE_FUNCTIONS_URL as string | undefined)?.replace(/\/$/, '') ?? '',
  useEmulators: env.VITE_USE_EMULATORS === 'true',
  appVersion: (env.VITE_APP_VERSION as string) || 'dev',
  demoModels: ((env.VITE_DEMO_MODELS as string) || 'gpt-5-mini,gpt-5-nano,gpt-4.1-mini').split(',').map((s) => s.trim()).filter(Boolean),
};
