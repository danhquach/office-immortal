export function cloudProblems(build: {
  html: string;
  paths: string[];
  read: (path: string) => string;
}): string[];
export function debugProblems(build: { paths: string[]; read: (path: string) => string }): string[];
