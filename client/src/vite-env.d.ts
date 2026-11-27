// Minimal typing for the Vite features the client uses, so the project typechecks without
// depending on Vite's own type package.
interface ImportMetaGlobOptions {
  query?: string;
  import?: string;
  eager?: boolean;
}

interface ImportMeta {
  glob(pattern: string | string[], options?: ImportMetaGlobOptions): Record<string, unknown>;
}
