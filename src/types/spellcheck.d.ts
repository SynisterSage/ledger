declare module 'nspell' {
  type SpellDictionary = unknown;
  type NSpell = {
    correct(word: string): boolean;
    suggest(word: string): string[];
  };

  export default function nspell(dictionary: SpellDictionary): NSpell;
}

declare module 'dictionary-en-us' {
  type DictionaryFactory = (callback: (error: Error | null, dictionary?: unknown) => void) => void;
  const dictionary: DictionaryFactory;
  export default dictionary;
}
