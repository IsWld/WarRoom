import { NO_COUNTRY, type GameState } from './state.ts';

/**
 * Every change to the game goes through a command. Commands are plain JSON so they can be
 * logged, saved, replayed and (later) sent over the network.
 */
export type Command =
  | { type: 'SetController'; province: number; country: string }
  | { type: 'SetOwner'; province: number; country: string };

export type CommandType = Command['type'];

/** Returns a reason the command is invalid in this state, or null if it is valid. */
export function validateCommand(state: GameState, command: Command): string | null {
  switch (command.type) {
    case 'SetController':
    case 'SetOwner': {
      if (!isProvince(state, command.province)) {
        return `Province ${command.province} does not exist`;
      }
      const index = state.countryTags.indexOf(command.country);
      if (index < 0) return `Unknown country "${command.country}"`;
      if (index === NO_COUNTRY && command.type === 'SetOwner') {
        return 'A province cannot be owned by nobody through SetOwner';
      }
      return null;
    }
    default:
      return `Unknown command type "${(command as { type: unknown }).type}"`;
  }
}

/** Applies a command that has already passed validateCommand. */
export function applyCommand(state: GameState, command: Command): void {
  switch (command.type) {
    case 'SetController': {
      state.provinces.controller[command.province] = state.countryTags.indexOf(command.country);
      return;
    }
    case 'SetOwner': {
      const index = state.countryTags.indexOf(command.country);
      state.provinces.owner[command.province] = index;
      state.provinces.controller[command.province] = index;
      return;
    }
  }
}

function isProvince(state: GameState, province: number): boolean {
  return Number.isInteger(province) && province >= 0 && province < state.provinces.count;
}
