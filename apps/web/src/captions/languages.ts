/** English names of the languages the captions features offer, by ISO 639-1 code. */
export const LANGUAGE_NAMES: Record<string, string> = {
  af: 'Afrikaans',
  ar: 'Arabic',
  bn: 'Bengali',
  cs: 'Czech',
  da: 'Danish',
  de: 'German',
  en: 'English',
  es: 'Spanish',
  et: 'Estonian',
  fi: 'Finnish',
  fr: 'French',
  hi: 'Hindi',
  hu: 'Hungarian',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  mr: 'Marathi',
  nl: 'Dutch',
  pl: 'Polish',
  pt: 'Portuguese',
  ro: 'Romanian',
  ru: 'Russian',
  sv: 'Swedish',
  ta: 'Tamil',
  te: 'Telugu',
  th: 'Thai',
  tr: 'Turkish',
  uk: 'Ukrainian',
  ur: 'Urdu',
  vi: 'Vietnamese',
  zh: 'Chinese',
};

/** Languages offered by name for speech; Whisper understands many more when detecting. */
export const SPEECH_LANGUAGES = [
  'en',
  'hi',
  'bn',
  'ur',
  'ta',
  'te',
  'mr',
  'es',
  'fr',
  'de',
  'pt',
  'it',
  'nl',
  'ru',
  'uk',
  'pl',
  'tr',
  'ar',
  'id',
  'vi',
  'ja',
  'ko',
  'zh',
];

/** Languages sorted by name, English first (the most common choice). */
export function byName(codes: readonly string[]): string[] {
  return [...codes].sort((a, b) =>
    a === 'en' ? -1 : b === 'en' ? 1 : LANGUAGE_NAMES[a]!.localeCompare(LANGUAGE_NAMES[b]!),
  );
}
