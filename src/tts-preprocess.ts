/**
 * Text preprocessing for Kokoro TTS.
 * Kokoro doesn't support SSML, so we manipulate plain text to improve pronunciation.
 */

// Acronyms mapped to TTS-friendly spoken forms.
// Order matters: longer/more-specific patterns first to avoid partial matches.
const ACRONYMS: [RegExp, string][] = [
  // Multi-word / slash compounds first
  [/\bCI\/CD\b/g, 'C I / C D'],
  [/\bHTTPS\b/g, 'H T T P S'],
  [/\bHTTP\b/g, 'H T T P'],
  [/\bNoSQL\b/gi, 'no S Q L'],

  // Brand-like names with specific pronunciation
  [/\bNGINX\b/gi, 'engine X'],
  [/\bK8s\b/gi, 'Kubernetes'],
  [/\bDevOps\b/g, 'Dev Ops'],
  [/\bGitOps\b/g, 'Git Ops'],
  [/\bDevSecOps\b/g, 'Dev Sec Ops'],
  [/\bJSON\b/g, 'Jason'],
  [/\bRBAC\b/g, 'R back'],
  [/\bCIDR\b/g, 'cider'],

  // AWS services
  [/\bEC2\b/g, 'E C 2'],
  [/\bS3\b/g, 'S 3'],
  [/\bECS\b/g, 'E C S'],
  [/\bEKS\b/g, 'E K S'],
  [/\bRDS\b/g, 'R D S'],
  [/\bIAM\b/g, 'I A M'],

  // Plurals before singulars
  [/\bAPIs\b/g, 'A P Is'],
  [/\bVMs\b/g, 'V Ms'],
  [/\bURLs\b/g, 'U R Ls'],

  // Standard spelled-out acronyms (alphabetical)
  [/\bAPI\b/g, 'A P I'],
  [/\bAWS\b/g, 'A W S'],
  [/\bCDN\b/g, 'C D N'],
  [/\bCI\b/g, 'C I'],
  [/\bCD\b/g, 'C D'],
  [/\bCLI\b/g, 'C L I'],
  [/\bCPU\b/g, 'C P U'],
  [/\bCSV\b/g, 'C S V'],
  [/\bDNS\b/g, 'D N S'],
  [/\bGCP\b/g, 'G C P'],
  [/\bGPU\b/g, 'G P U'],
  [/\bIaC\b/g, 'I ay C'],
  [/\bIDE\b/g, 'I D E'],
  [/\bIP\b/g, 'I P'],
  [/\bJVM\b/g, 'J V M'],
  [/\bKPI\b/g, 'K P I'],
  [/\bLDAP\b/g, 'L dap'],
  [/\bMTTF\b/g, 'M T T F'],
  [/\bMTTR\b/g, 'M T T R'],
  [/\bOS\b/g, 'O S'],
  [/\bSDK\b/g, 'S D K'],
  [/\bSLA\b/g, 'S L A'],
  [/\bSLO\b/g, 'S L O'],
  [/\bSQL\b/g, 'S Q L'],
  [/\bSRE\b/g, 'S R E'],
  [/\bSSH\b/g, 'S S H'],
  [/\bSSL\b/g, 'S S L'],
  [/\bSVN\b/g, 'S V N'],
  [/\bTCP\b/g, 'T C P'],
  [/\bTLS\b/g, 'T L S'],
  [/\bUDP\b/g, 'U D P'],
  [/\bURL\b/g, 'U R L'],
  [/\bVM\b/g, 'V M'],
  [/\bVPC\b/g, 'V P C'],
  [/\bVPN\b/g, 'V P N'],
  [/\bXML\b/g, 'X M L'],
  [/\bYAML\b/g, 'YAML'], // already pronounced correctly as a word
];

export function preprocessForTTS(text: string): string {
  let result = text;

  // 1. Replace acronyms with TTS-friendly forms
  for (const [pattern, replacement] of ACRONYMS) {
    result = result.replace(pattern, replacement);
  }

  // 2. Replace arrow characters with a spoken pause
  result = result.replace(/\s*→\s*/g, '... ');

  // 3. Add a brief pause after colons (if not already followed by punctuation)
  result = result.replace(/:(?=[^\s,.])/g, ':, ');

  return result;
}
