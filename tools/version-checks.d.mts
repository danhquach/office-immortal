export function bumpProblems(versions: { base: string; head: string; locks: string[] }): string[];
export function pushedBranches(lines: string): string[];
export function tagProblems(release: { tag: string; version: string }): string[];
