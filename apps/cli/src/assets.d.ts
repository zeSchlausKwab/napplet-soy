// Bun embeds text imports in standalone CLI builds.
declare module '*.md' {
  const text: string;
  export default text;
}
