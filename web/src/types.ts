export interface YamlConfig {
  name?: string;
  description?: string;
  questionDelay?: number;
  answerDelay?: number;
  cardGap?: number;
  voice?: string;
  fontSize?: number;
  backgroundColor?: string;
  questionColor?: string;
  answerColor?: string;
  textColor?: string;
}

export interface YamlCard {
  question: string;
  answer: string;
}

export interface FileInfo {
  name: string;
  filename: string;
  title: string;
  description: string;
  questionCount: number;
}

export interface FileDetail {
  name: string;
  title: string;
  config: YamlConfig;
  questions: YamlCard[];
}
