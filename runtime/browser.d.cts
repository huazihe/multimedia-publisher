export function loadChromium(requireModule?: (name: string) => any): any;
export function resolveBrowserPath(options?: {
  executablePath?: string;
  env?: NodeJS.ProcessEnv;
  platform?: string;
  existsSync?: (filename: string) => boolean;
  chromium?: { executablePath?: () => string };
  requireModule?: (name: string) => any;
}): string;
export function resolveLoginRoot(options?: { env?: NodeJS.ProcessEnv; cwd?: string }): string;
