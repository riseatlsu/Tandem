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
  demoModels: ((env.VITE_DEMO_MODELS as string) || 'gpt-5-nano,gpt-5-mini,gpt-4.1-mini').split(',').map((s) => s.trim()).filter(Boolean),
};

/** Rough input price (USD per 1M tokens) used only to pick the demo's default model; unknown models rank last. */
const MODEL_PRICE: Record<string, number> = {
  'gpt-5-nano': 0.05, 'gpt-4.1-nano': 0.1, 'gpt-4o-mini': 0.15, 'gpt-5-mini': 0.25, 'gpt-4.1-mini': 0.4, 'gpt-5': 1.25, 'gpt-4.1': 2, 'gpt-4o': 2.5,
};
/** The demo starts on the cheapest allowed model; visitors can switch in the AI partner's model picker. */
export const DEFAULT_DEMO_MODEL = [...CONFIG.demoModels].sort((a, b) => (MODEL_PRICE[a] ?? Infinity) - (MODEL_PRICE[b] ?? Infinity))[0] ?? 'gpt-5-nano';
/** Multi-arm tasks are too hard for the smallest model: the demo starts them on gpt-5-mini when it's allowed. */
export const DEFAULT_MULTI_ARM_MODEL = CONFIG.demoModels.includes('gpt-5-mini') ? 'gpt-5-mini' : DEFAULT_DEMO_MODEL;
