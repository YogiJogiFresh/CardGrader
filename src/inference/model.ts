import { InferenceSession, OnnxValue } from 'onnxruntime-react-native';

export type ModelInputs = Readonly<Record<string, OnnxValue>>;
export type ModelOutputs = Readonly<Record<string, OnnxValue>>;

export interface ModelRunner {
  load(modelPath: string): Promise<void>;
  run(inputs: ModelInputs, outputNames?: readonly string[]): Promise<ModelOutputs>;
}

export class OnnxModelRunner implements ModelRunner {
  private session: InferenceSession | null = null;

  async load(modelPath: string): Promise<void> {
    this.session = await InferenceSession.create(modelPath);
  }

  async run(
    inputs: ModelInputs,
    outputNames?: readonly string[],
  ): Promise<ModelOutputs> {
    if (!this.session) {
      throw new Error('The grading model must be loaded before inference.');
    }

    if (outputNames) {
      return this.session.run(inputs, [...outputNames]);
    }

    return this.session.run(inputs);
  }
}
