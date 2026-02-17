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

export function preprocessForTTS(text: string): string {
  let result = text;

  // 1. Replace acronyms with TTS-friendly forms
  for (const [pattern, replacement] of ACRONYMS) {
    result = result.replace(pattern, replacement);
  }

  // 1b. Fallback: spell out unmapped uppercase acronyms (e.g., ABC -> Ay B C, HTTP2 -> H T T P 2)
  result = result.replace(/\b((?=[A-Z0-9]*[A-Z])[A-Z0-9]{2,})(s?)\b/g, (_, acronym: string, pluralS: string) => {
    const spoken = acronym
      .split('')
      .map((char) => {
        if (char === 'A') return 'Ay';
        if (char === 'I') return 'Eye';
        return char;
      })
      .join(' ');
    return pluralS ? `${spoken}${pluralS}` : spoken;
  });

  // 2. Replace arrow characters with a spoken pause
  result = result.replace(/\s*→\s*/g, '... ');

  // 3. Add a brief pause after colons (if not already followed by punctuation)
  result = result.replace(/:(?=[^\s,.])/g, ':, ');

  return result;
}
