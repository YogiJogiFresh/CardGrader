import * as ort from 'onnxruntime-web';

export type WebExecutionProvider = 'webgpu' | 'wasm';

export interface WebModelSession {
  provider: WebExecutionProvider;
  session: ort.InferenceSession;
}

export async function createWebModelSession(
  modelUrl: string,
): Promise<WebModelSession> {
  if ('gpu' in navigator) {
    try {
      return {
        provider: 'webgpu',
        session: await ort.InferenceSession.create(modelUrl, {
          executionProviders: ['webgpu'],
        }),
      };
    } catch (error) {
      console.warn('WebGPU model initialization failed; using WASM.', error);
    }
  }

  return {
    provider: 'wasm',
    session: await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
    }),
  };
}
