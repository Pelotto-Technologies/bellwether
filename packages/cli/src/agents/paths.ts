/** Forward slashes, so `sh` accepts the path on Windows (Git Bash) as well as Unix. */
export function posixPath(p: string): string {
  return p.replace(/\\/g, '/');
}
