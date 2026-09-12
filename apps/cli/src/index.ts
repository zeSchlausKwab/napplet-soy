import { scaffold } from './scaffold';
const [command, name, ...options] = process.argv.slice(2);
try {
  if (
    command !== 'new' ||
    !name ||
    options.some((v, i) => (i === 0 ? v !== '--template' : i !== 1)) ||
    (options[0] === '--template' && !options[1])
  ) {
    console.log(
      'Usage: bun run napplet new <folder> [--template soft-orbit]\n\nCreates a local Git project, agent instructions, and a sandboxed preview.',
    );
    process.exit(command && command !== '--help' ? 1 : 0);
  }
  const directory = await scaffold(process.cwd(), name, options[1] ?? 'soft-orbit');
  console.log(
    `\nYour napplet is ready at ${directory}\n\n  cd ${name}\n  bun run dev\n\nOpen your coding agent in that folder and make something weird.\nLocal creation is ready; public publishing is still under construction.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
