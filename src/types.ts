export interface YoutubeInfo {
  videoId: string;
  url: string;
  uploadedAt: string;       // ISO 8601 timestamp
  privacy?: string;
  contentSha?: string;      // SHA of questions+answers, used as YouTube tag for dedup
}

export interface YamlConfig {
  name?: string;            // video title (used for YouTube upload)
  description?: string;     // video description (used for YouTube upload)
  questionDelay?: number;   // seconds of silence after question TTS
  answerDelay?: number;     // seconds of silence after answer TTS
  cardGap?: number;         // seconds between cards
  voice?: string;           // kokoro voice name
  fontSize?: number;
  backgroundColor?: string;
  questionColor?: string;
  answerColor?: string;
  textColor?: string;
  youtube?: YoutubeInfo;    // populated after successful YouTube upload
}

export interface YamlCard {
  question: string;
  answer: string;
}

export interface YamlInput {
  config: YamlConfig;
  questions: YamlCard[];
}

export interface Segment {
  type: 'question' | 'answer';
  text: string;
  cardIndex: number;
  totalCards: number;
  audioPath: string;
  imagePath: string;
  audioDuration: number; // seconds
  totalDuration: number; // audio + padding
}

export interface PipelineConfig {
  inputPath: string;
  outputPath: string;
  voice: string;
  tempDir: string;
  questionDelay: number;
  answerDelay: number;
  cardGap: number;
  fontSize: number;
  backgroundColor: string;
  questionColor: string;
  answerColor: string;
  textColor: string;
  width: number;
  height: number;
  force: boolean;
}

export const DEFAULT_CONFIG: Omit<PipelineConfig, 'inputPath' | 'outputPath' | 'tempDir'> = {
  voice: 'af_heart',
  questionDelay: 2,
  answerDelay: 3,
  cardGap: 1,
  fontSize: 52,
  backgroundColor: '#1a1a2e',
  questionColor: '#16213e',
  answerColor: '#0f3460',
  textColor: '#ffffff',
  width: 1920,
  height: 1080,
  force: false,
};
