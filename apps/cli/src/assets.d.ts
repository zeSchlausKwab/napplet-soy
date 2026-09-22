// Bun embeds text imports in standalone CLI builds.
declare module '*.md' {
  const text: string;
  export default text;
}
declare module '*.sh' {
  const text: string;
  export default text;
}
