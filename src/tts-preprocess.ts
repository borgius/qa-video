/**
 * Text preprocessing for Kokoro TTS.
 * Kokoro doesn't support SSML, so we manipulate plain text to improve pronunciation.
 */

import { cachedPath, sha } from './cache.js';
import { codeToTTS, parseMarkdown } from './markdown.js';
import { MAX_CHUNK_CHARS } from './tts.js';

// ── Audio plan types (shared by pipeline & server) ───────────────────────────

/** A single TTS synthesis unit (one voice, one WAV output). */
export interface AudioPartPlan {
  audioPath: string;
  ttsText: string;
  voice: string;
}

/** Audio plan for one question or answer slot. */
export interface AudioPlan {
  finalAudioPath: string;
  parts: AudioPartPlan[];
  isMultiPart: boolean;
}

/** A voice-tagged TTS fragment: text to synthesize and whether it uses the code voice. */
export interface TTSPart {
  text: string;
  isCode: boolean;
}

// ── Audio cache key ──────────────────────────────────────────────────────────

/**
 * Build an audio cache key. Short texts (≤ MAX_CHUNK_CHARS) use the original
 * `audio:` prefix so existing valid WAVs are reused. Long texts that require
 * chunking use `audio-chunked:` so old truncated WAVs are discarded and
 * re-synthesised at full length.
 */
function audioCacheKey(ttsText: string, voice: string): string {
  return ttsText.length > MAX_CHUNK_CHARS
    ? `audio-chunked:${ttsText}:${voice}`
    : `audio:${ttsText}:${voice}`;
}

// ── Audio plan builder ───────────────────────────────────────────────────────

/**
 * Build an audio plan for a card slot. Splits text by code blocks (fenced and
 * inline), assigning the code voice to code parts. Single-voice texts produce a
 * single-part plan; mixed texts produce a multi-part plan that requires
 * concatenation.
 *
 * Used by both the video pipeline and the web server so that audio generation
 * is identical regardless of the entry point.
 */
export function buildAudioPlan(
  text: string,
  tempDir: string,
  prefix: string,
  voice: string,
  codeVoice: string,
): AudioPlan {
  const ttsParts = splitIntoTTSParts(text);
  const hasCode = ttsParts.some(p => p.isCode);

  if (!hasCode) {
    // Single voice — one WAV
    const ttsText = ttsParts.map(p => p.text).join(' ');
    const audioPath = cachedPath(tempDir, prefix, audioCacheKey(ttsText, voice), 'wav');
    return {
      finalAudioPath: audioPath,
      parts: [{ audioPath, ttsText, voice }],
      isMultiPart: false,
    };
  }

  // Multi-part: each TTS part gets its own WAV, then concatenated
  const parts: AudioPartPlan[] = ttsParts.map((p, j) => {
    const v = p.isCode ? codeVoice : voice;
    const partPrefix = `${prefix}_${p.isCode ? 'c' : 't'}${j}`;
    return {
      audioPath: cachedPath(tempDir, partPrefix, audioCacheKey(p.text, v), 'wav'),
      ttsText: p.text,
      voice: v,
    };
  });

  // Final concatenated WAV keyed by all part hashes + voices
  const partKey = parts.map(p => sha(`${p.ttsText}:${p.voice}`)).join('|');
  const finalAudioPath = cachedPath(tempDir, prefix, `md-audio:${partKey}`, 'wav');

  return { finalAudioPath, parts, isMultiPart: true };
}

// ── TTS text splitting ───────────────────────────────────────────────────────

/**
 * Split raw Q/A text into voice-tagged TTS parts.
 * 1. Fenced code blocks (```) → isCode: true
 * 2. Inside text segments, inline code (`...`) → isCode: true
 * 3. Everything else → isCode: false
 *
 * Each part's text is already preprocessed for TTS.
 * Parts with empty text after preprocessing are omitted.
 */
export function splitIntoTTSParts(text: string): TTSPart[] {
  const mdSegments = parseMarkdown(text);
  const parts: TTSPart[] = [];

  for (const seg of mdSegments) {
    if (seg.kind === 'code') {
      const ttsText = preprocessForTTS(codeToTTS(seg));
      if (ttsText.trim()) parts.push({ text: ttsText, isCode: true });
    } else {
      // Split text segment by inline code spans
      const inlineParts = splitByInlineCode(seg.content);
      for (const ip of inlineParts) {
        const ttsText = preprocessForTTS(ip.raw);
        if (ttsText.trim()) parts.push({ text: ttsText, isCode: ip.isCode });
      }
    }
  }

  // Fallback: if everything was stripped, return the whole text as prose
  if (parts.length === 0) {
    return [{ text: preprocessForTTS(text), isCode: false }];
  }

  return parts;
}

/**
 * Split a text fragment by inline backtick code spans.
 * Returns alternating prose / inline-code chunks with their raw text.
 */
function splitByInlineCode(text: string): { raw: string; isCode: boolean }[] {
  const result: { raw: string; isCode: boolean }[] = [];
  const regex = /`([^`]+)`/g;
  let lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    if (match.index > lastIndex) {
      result.push({ raw: text.slice(lastIndex, match.index), isCode: false });
    }
    result.push({ raw: match[1], isCode: true });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    result.push({ raw: text.slice(lastIndex), isCode: false });
  }

  return result.length > 0 ? result : [{ raw: text, isCode: false }];
}

// Acronyms mapped to TTS-friendly spoken forms.
// Order matters: longer/more-specific patterns first to avoid partial matches.
const ACRONYMS: [RegExp, string][] = [
  // Multi-word / slash compounds first
  [/\bCI\/CD\b/g, 'C I / C D'],
  [/\bHTTPS\b/g, 'H T T P S'],
  [/\bHTTP\/2\b/g, 'H T T P 2'],
  [/\bHTTP\b/g, 'H T T P'],
  [/\bNoSQL\b/gi, 'no S Q L'],
  [/\bmTLS\b/g, 'mutual T L S'],
  [/\bgRPC\b/g, 'G R P C'],

  // Brand-like names with specific pronunciation
  [/\bNGINX\b/gi, 'engine X'],
  [/\bK8s\b/gi, 'Kubernetes'],
  [/\bDevOps\b/g, 'Dev Ops'],
  [/\bGitOps\b/g, 'Git Ops'],
  [/\bDevSecOps\b/g, 'Dev Sec Ops'],
  [/\bFinOps\b/g, 'Fin Ops'],
  [/\bJSON\b/g, 'Jason'],
  [/\bRBAC\b/g, 'R back'],
  [/\bCIDR\b/g, 'cider'],
  [/\bIstiod\b/g, 'Istio D'],
  [/\betcd\b/g, 'et-C-D'],
  [/\bkubectl\b/g, 'kube control'],
  [/\bkubeconfig\b/g, 'kube config'],
  [/\bHCL\b/g, 'H C L'],
  [/\bAMQP\b/g, 'A M Q P'],
  [/\bCQRS\b/g, 'C Q R S'],
  [/\bSBOMs\b/g, 'S bombs'],
  [/\bSBOM\b/g, 'S bomb'],
  [/\bSLSA\b/g, 'salsa'],
  [/\beBPF\b/g, 'E B P F'],
  [/\bWebAssembly\b/g, 'Web Assembly'],
  [/\bPromQL\b/g, 'Prom Q L'],
  [/\bLogQL\b/g, 'Log Q L'],

  // AWS / cloud services
  [/\bEC2\b/g, 'E C 2'],
  [/\bS3\b/g, 'S 3'],
  [/\bECS\b/g, 'E C S'],
  [/\bEKS\b/g, 'E K S'],
  [/\bRDS\b/g, 'R D S'],
  [/\bIAM\b/g, 'I A M'],
  [/\bECR\b/g, 'E C R'],
  [/\bALB\b/g, 'A L B'],
  [/\bSQS\b/g, 'S Q S'],
  [/\bSNS\b/g, 'S N S'],
  [/\bKMS\b/g, 'K M S'],
  [/\bFIS\b/g, 'F I S'],
  [/\bGKE\b/g, 'G K E'],

  // Plurals before singulars
  [/\bAPIs\b/g, 'Ay P Eyes'],
  [/\bVMs\b/g, 'V Ms'],
  [/\bURLs\b/g, 'U R Ls'],
  [/\bCRDs\b/g, 'C R Ds'],
  [/\bSLOs\b/g, 'S L Os'],
  [/\bSLIs\b/g, 'S L Is'],
  [/\bSLAs\b/g, 'S L As'],

  // Standard spelled-out acronyms (alphabetical)
  [/\bAPI\b/g, 'Ay P I'],
  [/\bAPM\b/g, 'A P M'],
  [/\bAWS\b/g, 'A W S'],
  [/\bCDN\b/g, 'C D N'],
  [/\bCI\b/g, 'C I'],
  [/\bCD\b/g, 'C D'],
  [/\bCLI\b/g, 'C L I'],
  [/\bCNI\b/g, 'C N I'],
  [/\bCPU\b/g, 'C P U'],
  [/\bCRD\b/g, 'C R D'],
  [/\bCSV\b/g, 'C S V'],
  [/\bCVSS\b/g, 'C V S S'],
  [/\bDNS\b/g, 'D N S'],
  [/\bDORA\b/g, 'dora'],
  [/\bGCP\b/g, 'G C P'],
  [/\bGPG\b/g, 'G P G'],
  [/\bGPU\b/g, 'G P U'],
  [/\bIaC\b/g, 'I ay C'],
  [/\bIDE\b/g, 'I D E'],
  [/\bIDP\b/g, 'I D P'],
  [/\bIP\b/g, 'I P'],
  [/\bJVM\b/g, 'J V M'],
  [/\bJWT\b/g, 'J W T'],
  [/\bKPI\b/g, 'K P I'],
  [/\bLDAP\b/g, 'L dap'],
  [/\bLFS\b/g, 'L F S'],
  [/\bMTTF\b/g, 'M T T F'],
  [/\bMTTR\b/g, 'M T T R'],
  [/\bOAM\b/g, 'O A M'],
  [/\bOCI\b/g, 'O C I'],
  [/\bOIDC\b/g, 'O I D C'],
  [/\bOPA\b/g, 'O P A'],
  [/\bOS\b/g, 'O S'],
  [/\bOWASP\b/g, 'O wasp'],
  [/\bPKI\b/g, 'P K I'],
  [/\bRPC\b/g, 'R P C'],
  [/\bRUM\b/g, 'R U M'],
  [/\bSAML\b/g, 'S A M L'],
  [/\bSDK\b/g, 'S D K'],
  [/\bSHA\b/g, 'shah'],
  [/\bSLA\b/g, 'S L A'],
  [/\bSLI\b/g, 'S L I'],
  [/\bSLO\b/g, 'S L O'],
  [/\bSOPS\b/g, 'sops'],
  [/\bSQL\b/g, 'S Q L'],
  [/\bSRE\b/g, 'S R E'],
  [/\bSSH\b/g, 'S S H'],
  [/\bSSL\b/g, 'S S L'],
  [/\bSSO\b/g, 'S S O'],
  [/\bSVN\b/g, 'S V N'],
  [/\bTCP\b/g, 'T C P'],
  [/\bTLS\b/g, 'T L S'],
  [/\bTTL\b/g, 'T T L'],
  [/\bUDP\b/g, 'U D P'],
  [/\bURL\b/g, 'U R L'],
  [/\bVM\b/g, 'V M'],
  [/\bVPC\b/g, 'V P C'],
  [/\bVPN\b/g, 'V P N'],
  [/\bWAF\b/g, 'W A F'],
  [/\bWasm\b/g, 'wasm'],
  [/\bXML\b/g, 'X M L'],
  [/\bYAML\b/g, 'YAML'], // already pronounced correctly as a word
  [/\bxDS\b/g, 'X D S'],
];

const ignoreCaseAcronyms = new Map([
  ['dora', 'dora'],
  ['wasm', 'wasm'],
  ['salsa', 'salsa'],
  ['sops', 'sops'],
  ['yaml', 'YAML'],
  ['post', 'POST'],
  ['get', 'GET'],
  ['put', 'PUT'],
  ['delete', 'DELETE'],
  ['patch', 'PATCH'],
  ['head', 'HEAD'],
  ['options', 'OPTIONS'],
  ['trace', 'TRACE'],
  ['connect', 'CONNECT'],
]);

export function preprocessForTTS(text: string): string {
  let result = text;

  // 0. Strip inline markdown markers (bold, italic, inline code)
  result = result.replace(/`([^`]*)`/g, '$1');
  result = result.replace(/\*{1,3}(.*?)\*{1,3}/g, '$1');
  result = result.replace(/_{1,3}(.*?)_{1,3}/g, '$1');

  // 0. Replace newlines with a small pause (treated as end of sentence)
  result = result.replace(/\r?\n+/g, ',, ');

  // 0b. Replace abbreviations with spoken equivalents
  result = result.replace(/\be\.g\.(,?)/gi, 'for example$1');
  result = result.replace(/\bi\.e\.(,?)/gi, 'that is$1');
  result = result.replace(/\betc\.(,?)/gi, 'et cetera$1');
  result = result.replace(/\bet al\.(,?)/gi, 'and others$1');
  result = result.replace(/\bviz\.(,?)/gi, 'namely$1');
  result = result.replace(/\bcf\.(,?)/gi, 'compare$1');
  result = result.replace(/\bvs\./gi, 'versus');
  result = result.replace(/\bapprox\./gi, 'approximately');
  result = result.replace(/\bavg\./gi, 'average');
  result = result.replace(/\bfig\./gi, 'figure');
  result = result.replace(/\bn\.b\.(,?)/gi, 'note$1');
  result = result.replace(/\bp\.s\.(,?)/gi, 'post script$1');

  // 1. Replace acronyms with TTS-friendly forms
  for (const [pattern, replacement] of ACRONYMS) {
    result = result.replace(pattern, replacement);
  }

  // 1b. Fallback: spell out unmapped uppercase acronyms (e.g., ABC -> Ay B C, HTTP2 -> H T T P 2)
  result = result.replace(
    /\b((?=[A-Z0-9]*[A-Z])[A-Z0-9]{2,})(s?)\b/g,
    (_, acronym: string, pluralS: string) => {
      const casedValue = ignoreCaseAcronyms.get(acronym.toLowerCase());
      if (casedValue) {
        return casedValue;
      }
      const spoken = acronym
        .split('')
        .map((char) => {
          if (char === 'A') return 'Ay';
          if (char === 'I') return 'Eye';
          return char;
        })
        .join(' ');
      return pluralS ? `${spoken}${pluralS}` : spoken;
    },
  );

  // 2. Replace arrow characters with a spoken pause
  result = result.replace(/\s*→\s*/g, '... ');

  // 3. Add a brief pause after colons (if not already followed by punctuation)
  result = result.replace(/:(?=[^\s,.])/g, ':, ');

  // 4. Add small pause before opening parenthesis and double pause after closing parenthesis
  result = result.replace(/(\S)\s*\(/g, '$1, (');
  result = result.replace(/\)\s*/g, ')... ');

  return result;
}
