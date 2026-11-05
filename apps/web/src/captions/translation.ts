/**
 * Caption translation: which OPUS-MT models get from one language to another.
 * A pair with its own model translates directly; any other goes through
 * English (two models), which covers every language with a model to and from
 * English.
 */
import { byName } from './languages';

/**
 * Translation models: OPUS-MT (Helsinki-NLP, University of Helsinki), one per
 * language pair, in Transformers.js's ONNX conversions (`Xenova/opus-mt-*`).
 * Pinned revisions and the 8-bit download per pair, in MB. Licences (all
 * permissive) are listed in docs/DEPENDENCIES.md; ru-en, zh-en and en-de are
 * CC BY 4.0, which asks for the credit shown in the dialog.
 */
export const TRANSLATION_PAIRS: Record<string, { revision: string; downloadMb: number }> = {
  'hi-en': { revision: '99853100ed9d932987a6816e8cf7b1b6742a6116', downloadMb: 109 },
  'es-en': { revision: 'eadfd7c658a9d8929ac3b8e996b68a68e2c7d480', downloadMb: 113 },
  'fr-en': { revision: '6b166a182780e118c997879d0ad5be4b53671644', downloadMb: 107 },
  'de-en': { revision: '399dfd68706739fffd503f876093e455ae268a06', downloadMb: 106 },
  'it-en': { revision: 'fd0b89b9c052adc1f2f64152f555aa17353728be', downloadMb: 129 },
  'nl-en': { revision: '82c42d95d1508037cbe7172d85fd4e940a2f3584', downloadMb: 115 },
  'ru-en': { revision: 'afe8c6c738ec81b6d033fd8f44f9678a639a7c67', downloadMb: 111 },
  'uk-en': { revision: 'b2ad6afa424aaeff8913ff350860b7a7b7c0a607', downloadMb: 110 },
  'ar-en': { revision: '09c7556866400dcc53562ba8d7035119e7d9a2c1', downloadMb: 111 },
  'zh-en': { revision: '39d480d52a9ea3065a1f117adfe4dbc55de10e6f', downloadMb: 113 },
  'vi-en': { revision: '541dfd72ec07e8f1563795e0224408ad8d729e80', downloadMb: 102 },
  'id-en': { revision: 'c38ef36c843b71177da903442835c3c870975fd6', downloadMb: 103 },
  'cs-en': { revision: 'c9f7336d1cf49ba5b7a412cba3b86999fa781716', downloadMb: 111 },
  'da-en': { revision: '6496d5e47a016552357be8f06294096609256ac4', downloadMb: 107 },
  'fi-en': { revision: 'a623e4812687be788e3ab720c8a950ab64704793', downloadMb: 108 },
  'sv-en': { revision: '63a40256869b6a2b29a84e47aa7f03524fa5f3a2', downloadMb: 104 },
  'hu-en': { revision: 'c9e8a7617fb4cb4fca3785c5bb22cfe457cde00b', downloadMb: 111 },
  'af-en': { revision: '0eba4e40af86c6ad316a58fc9a7ed1134b05fd90', downloadMb: 105 },
  'ja-en': { revision: '1a906cfaaf7c8f4193f67f5885c082aa6dbd9d16', downloadMb: 109 },
  'ko-en': { revision: 'd9fa1ac6008242100fecb4fff9b0a5917a1be81f', downloadMb: 113 },
  'pl-en': { revision: 'aeaf0e003b045248c28a559a5ce6027b54ebdaba', downloadMb: 111 },
  'th-en': { revision: '7f0406b972f742985cfbe3be8f61dead9f1bc0e3', downloadMb: 110 },
  'et-en': { revision: '58104952b730220eb7a9cdbbe19533a064f40dc0', downloadMb: 107 },
  'en-hi': { revision: '7aad72006a1588a9c3485ed6203aed99eebbc872', downloadMb: 110 },
  'en-es': { revision: '4b002a4c7edd54a7ced58877258b87f7efd3f892', downloadMb: 113 },
  'en-fr': { revision: '28726206f80896b90035bd99cccd5cc1e151f916', downloadMb: 107 },
  'en-de': { revision: '1ca130c44c4c5441ef16d48aae521a424ab644f7', downloadMb: 106 },
  'en-it': { revision: '075406e3c8c2c30634d4a1bd8f00c21d9e162011', downloadMb: 129 },
  'en-nl': { revision: 'c3a0541231a7329b4492809fc2bd7ab7d2ceb0bc', downloadMb: 115 },
  'en-ru': { revision: 'e050376e960175e8ddc5cff85025dc8436cddd68', downloadMb: 111 },
  'en-uk': { revision: 'e6ca587292984b343fd829b6430ed55858496525', downloadMb: 110 },
  'en-ar': { revision: '034a684356c19021a187cda4d7f823298b913921', downloadMb: 111 },
  'en-zh': { revision: '046f55aec303cdee3e0318604406d4df20f1e8ea', downloadMb: 113 },
  'en-vi': { revision: '30bcd461c0d7338ad106b36314d3eedc2d4e998c', downloadMb: 101 },
  'en-id': { revision: 'b3b41f654c2fb3286d007dee1da7b0f47fd27d82', downloadMb: 103 },
  'en-cs': { revision: 'ed163ca109a93297e2f055eb3397bd33230141ad', downloadMb: 111 },
  'en-da': { revision: '33862dc071a5cc43e821e60742553c501c587e77', downloadMb: 107 },
  'en-fi': { revision: '4e5799273dbd7cce94c1e99cc9d3acb9f191b8eb', downloadMb: 113 },
  'en-sv': { revision: '33d522d806c041cdebecd549c558d22a2b9b4ea4', downloadMb: 104 },
  'en-hu': { revision: '1b7df958c1bd8f094eff1ce76d536468923ed7e3', downloadMb: 111 },
  'en-af': { revision: '3d48312617d092d77cb5aef9f9e9636ad639dd8d', downloadMb: 105 },
  'en-ro': { revision: '3d816891778276930df2a45cbfb70689b3fe8981', downloadMb: 108 },
  'de-es': { revision: 'd339419ee3bda301bdcd00249d4436b74664ee7e', downloadMb: 109 },
  'de-fr': { revision: 'e783da03d247c4d16778e938530e9b5d7bd1523d', downloadMb: 109 },
  'es-de': { revision: '7f493e4b81b684478396f37de4c1ebc28ecd5855', downloadMb: 109 },
  'es-fr': { revision: '3bef5f612825d503f6fb85e0527a1fe30f2578c2', downloadMb: 123 },
  'es-it': { revision: '596c67cda7cb919f0d67221f3a31bd7df79f19d0', downloadMb: 107 },
  'es-ru': { revision: '268ccd60bde3cabde17068d482ca6930512f1a85', downloadMb: 111 },
  'fr-de': { revision: '7eea1996b4480d073cf560fcba6d4480aaf9a2bb', downloadMb: 109 },
  'fr-es': { revision: '962338be51033b548c13dbb6f4da3ddb8c8aba0e', downloadMb: 123 },
  'fr-ru': { revision: 'c2ec732b045ae9f0e1ae1ea9267840145a8c03fe', downloadMb: 112 },
  'it-es': { revision: '0eba27fe6da2208231ea5e7047b0f62241ffc2bb', downloadMb: 107 },
  'it-fr': { revision: '7843e3b7137d19face19cb32e27256888d26fe84', downloadMb: 107 },
  'ru-es': { revision: '9cb5fb9fae4d5c0c731dcc3ba74c4e0a87f15eb0', downloadMb: 111 },
  'ru-fr': { revision: 'c7275f468246036d24bfe14ce8465e94e1037af9', downloadMb: 112 },
  'ru-uk': { revision: '6d8a744ed6eafd9003bcc2b052c4575de0485e1e', downloadMb: 106 },
  'uk-ru': { revision: 'cfb76ccd207734d7847679664fa4538cda5ed597', downloadMb: 106 },
  'da-de': { revision: '3784087953108e4ee9957c8f9eff11c0bf0cabda', downloadMb: 105 },
  'fi-de': { revision: '6d93339597e19574f543259315d2400939067c1e', downloadMb: 107 },
  'nl-fr': { revision: '6c8ebb68522ffd80cf3474b2dc44f4b5f741e9cd', downloadMb: 106 },
};

export const PIVOT = 'en';

/** The models to run, in order, from `from` to `to`; null if there's no route. */
export function translationRoute(from: string, to: string): string[] | null {
  if (from === to) return null;
  const direct = `${from}-${to}`;
  if (direct in TRANSLATION_PAIRS) return [direct];
  const first = `${from}-${PIVOT}`;
  const second = `${PIVOT}-${to}`;
  return first in TRANSLATION_PAIRS && second in TRANSLATION_PAIRS ? [first, second] : null;
}

/** The one-time download for a route, in MB. */
export function routeDownloadMb(route: readonly string[]): number {
  return route.reduce((mb, pair) => mb + TRANSLATION_PAIRS[pair]!.downloadMb, 0);
}

/** Languages captions can be translated from, by name. */
export function sourceLanguages(): string[] {
  const codes = new Set(Object.keys(TRANSLATION_PAIRS).map((p) => p.split('-')[0]!));
  return byName([...codes]);
}

/** Languages `from` can be translated into, by name. */
export function targetLanguages(from: string): string[] {
  const codes = new Set(Object.keys(TRANSLATION_PAIRS).map((p) => p.split('-')[1]!));
  codes.add(PIVOT);
  return byName([...codes].filter((to) => translationRoute(from, to) !== null));
}

/** The Hugging Face repository of a pair's model. */
export const pairRepo = (pair: string) => `Xenova/opus-mt-${pair}`;

export type TranslationStage = 'model' | 'translate';

/** Main thread -> translation worker. */
export type ToTranslationWorker = {
  type: 'start';
  /** One entry per caption. */
  texts: string[];
  /** Pairs to run in order (from `translationRoute`). */
  route: string[];
};

/** Translation worker -> main thread. */
export type FromTranslationWorker =
  | { type: 'progress'; stage: TranslationStage; fraction: number; step: number; steps: number }
  | { type: 'done'; texts: string[] }
  | { type: 'error'; message: string };

/** Captions are one line of text for translation (their line breaks are layout). */
export const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
