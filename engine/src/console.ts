/**
 * Debug console: turns typed lines into engine commands or client actions.
 *
 *   tag GER            play as Germany (client action)
 *   annex POL          the player's country annexes Poland
 *   annex GER POL      Germany annexes Poland
 *   owner 123 GER      province id 123 becomes German (owner and controller)
 *   control 123 GER    province id 123 becomes German-controlled
 *   speed 3            set game speed 0–5 (client action; 0 pauses)
 *   help               list commands
 */
import type { Command } from './commands.ts';

export type ConsoleResult =
  | { kind: 'commands'; commands: Command[]; message: string }
  | { kind: 'tag'; tag: string; message: string }
  | { kind: 'speed'; speed: number; message: string }
  | { kind: 'help'; message: string }
  | { kind: 'error'; message: string };

export interface ConsoleContext {
  /** Tag of the player's country, if any. */
  playerTag: string | null;
  isCountry(tag: string): boolean;
  /** Province id from provinces.csv → dense province index, or undefined. */
  provinceIndex(id: number): number | undefined;
}

export const CONSOLE_HELP = [
  'tag <TAG>                 play as a country',
  'annex [<TAG>] <TARGET>    annex a country (defaults to your country)',
  'owner <province> <TAG>    give a province to a country',
  'control <province> <TAG>  give control of a province to a country',
  'speed <0-5>               set game speed (0 pauses)',
  'help                      show this list',
].join('\n');

export function parseConsoleLine(line: string, ctx: ConsoleContext): ConsoleResult {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { kind: 'error', message: 'Type a command, or "help".' };
  const [name, ...args] = words;
  const tagArg = (i: number) => args[i]?.toUpperCase();

  switch (name!.toLowerCase()) {
    case 'help':
      return { kind: 'help', message: CONSOLE_HELP };

    case 'tag': {
      const tag = tagArg(0);
      if (!tag) return { kind: 'error', message: 'Usage: tag <TAG>' };
      if (!ctx.isCountry(tag)) return { kind: 'error', message: `Unknown country "${tag}"` };
      return { kind: 'tag', tag, message: `Now playing as ${tag}` };
    }

    case 'annex': {
      const [country, target] =
        args.length >= 2 ? [tagArg(0), tagArg(1)] : [ctx.playerTag ?? undefined, tagArg(0)];
      if (!target) return { kind: 'error', message: 'Usage: annex [<TAG>] <TARGET>' };
      if (!country)
        return {
          kind: 'error',
          message: 'Pick a country first with "tag", or name both countries.',
        };
      for (const t of [country, target]) {
        if (!ctx.isCountry(t)) return { kind: 'error', message: `Unknown country "${t}"` };
      }
      return {
        kind: 'commands',
        commands: [{ type: 'Annex', country, target }],
        message: `${country} annexes ${target}`,
      };
    }

    case 'owner':
    case 'control': {
      const id = Number(args[0]);
      const tag = tagArg(1);
      if (!Number.isInteger(id) || !tag)
        return { kind: 'error', message: `Usage: ${name} <province> <TAG>` };
      const index = ctx.provinceIndex(id);
      if (index === undefined) return { kind: 'error', message: `No province with id ${id}` };
      if (!ctx.isCountry(tag)) return { kind: 'error', message: `Unknown country "${tag}"` };
      const type = name === 'owner' ? 'SetOwner' : 'SetController';
      return {
        kind: 'commands',
        commands: [{ type, province: index, country: tag }],
        message: `Province ${id} → ${tag} (${name})`,
      };
    }

    case 'speed': {
      const speed = Number(args[0]);
      if (!Number.isInteger(speed) || speed < 0 || speed > 5)
        return { kind: 'error', message: 'Usage: speed <0-5>' };
      return { kind: 'speed', speed, message: speed === 0 ? 'Paused' : `Speed ${speed}` };
    }

    default:
      return { kind: 'error', message: `Unknown command "${name}". Type "help".` };
  }
}
