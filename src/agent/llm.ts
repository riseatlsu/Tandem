import { ChatOpenAI } from '@langchain/openai';
import { CONFIG } from '../config';

export interface LlmAuth { getToken(): Promise<string | null>; sessionId(): string | null }

/** ChatOpenAI pointed at our Firebase llmProxy (OpenAI-compatible). The real API key lives only on the server. */
export function makeModel(model: string, auth: LlmAuth) {
  return new ChatOpenAI({
    model,
    apiKey: 'server-side',
    streaming: true,
    streamUsage: true,
    useResponsesApi: false,
    maxRetries: 1,
    timeout: 60_000,
    configuration: {
      baseURL: `${CONFIG.llmProxyUrl}/v1`,
      dangerouslyAllowBrowser: true,
      fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        headers.delete('authorization');
        const tok = await auth.getToken();
        if (tok) headers.set('X-Firebase-Token', tok);
        const sid = auth.sessionId();
        if (sid) headers.set('X-Session-Id', sid);
        return fetch(url, { ...init, headers });
      },
    },
  });
}
