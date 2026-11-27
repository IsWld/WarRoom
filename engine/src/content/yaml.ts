import { YAMLParseError, parse } from 'yaml';
import type { TextParser } from './types.ts';

/**
 * YAML 1.2 parser for content files. On a syntax error it throws an Error with a `line`
 * property so the loader can point modders at the exact line.
 */
export const parseYaml: TextParser = (text) => {
  try {
    return parse(text);
  } catch (error) {
    if (error instanceof YAMLParseError) {
      const wrapped = new Error(error.message.split('\n')[0] ?? error.message) as Error & {
        line?: number;
      };
      const line = error.linePos?.[0]?.line;
      if (line !== undefined) wrapped.line = line;
      throw wrapped;
    }
    throw error;
  }
};
