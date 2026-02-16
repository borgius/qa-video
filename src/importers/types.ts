import { YamlCard, YamlConfig } from '../types.js';

export interface ImportResult {
  config: YamlConfig;
  questions: YamlCard[];
}

export interface ImportDriver {
  /** Unique driver name (used in --from flag) */
  readonly name: string;
  /** File extensions this driver handles */
  readonly extensions: string[];
  /** Human-readable description */
  readonly description: string;
  /** Extract Q&A pairs from the source file */
  extract(filePath: string): Promise<ImportResult>;
}
