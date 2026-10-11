export function cloudProblems(build: {
  html: string;
  paths: string[];
  read: (path: string) => string;
}): string[];
