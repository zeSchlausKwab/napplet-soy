import { createFileRoute } from '@tanstack/react-router';
import release from '../../../cli/distribution/version.json';
export const Route = createFileRoute('/cli')({ component: CliHelp });
function CliHelp() {
  return (
    <section className="create-page">
      <span className="eyebrow">YOUR TOOLS, YOUR CODE</span>
      <h1>
        A tiny idea.
        <br />A working project<span className="coral">.</span>
      </h1>
      <p className="create-intro">
        Install the creator CLI, open your favorite coding agent, and make something.
      </p>
      <div className="terminal-box">
        <code>curl -fsSL https://napplet.soy/install.sh | sh -s -- new my-napplet</code>
      </div>
      <p className="command-note">
        The installer checks the download’s SHA-256 checksum and installs in your home folder. It
        needs no sudo and leaves shell profiles alone. Follow its PATH instruction if needed, then
        run:
      </p>
      <div className="terminal-box">
        <code>
          cd my-napplet
          <br />
          napplet-space dev
          <br />
          napplet-space build
          <br />
          napplet-space publish
        </code>
      </div>
      <div className="creation-steps">
        <article>
          <span>01</span>
          <h2>No runtime setup</h2>
          <p>
            The CLI prepares a private Node/pnpm toolchain and installs the starter’s locked
            dependencies. No global Bun, Node, or npm installation is needed. The TypeScript project
            builds into a self-contained HTML napplet.
          </p>
        </article>
        <article>
          <span>02</span>
          <h2>Your creator identity</h2>
          <p>
            Create an identity or connect a remote signer. Credentials stay in your OS credential
            store. Set it up later if you just want to experiment.
          </p>
        </article>
        <article>
          <span>03</span>
          <h2>A check before sharing</h2>
          <p>
            In the dev preview, switch to Listing to inspect the screenshot, title, description,
            tags and upload destinations. Capture a screenshot there before sharing.
          </p>
          <p>
            The first check or publication downloads a pinned Chromium browser into your cache.
            Future checks reuse it. Use <code>napplet-space check</code> without publishing.
          </p>
        </article>
      </div>
      <h2>The upstream starter, with skills included</h2>
      <p className="command-note">
        New projects use a pinned version of{' '}
        <a href="https://github.com/napplet/boilerplate">napplet/boilerplate</a>, including its SDK,
        Vite plugin, documentation, and eight official Napplet skills. Open your coding agent in the
        project folder; AGENTS.md and CLAUDE.md point it to the instructions. Run{' '}
        <code>napplet-space run verify</code> for the upstream checks or{' '}
        <code>napplet-space run test:conformance</code> for its reference harness.
      </p>
      <p className="command-note">
        For an existing creation, run <code>napplet-space skills update</code> in its folder after
        updating the CLI. This adds the bundled skills and preserves your edits. The project’s{' '}
        <code>docs/napplet-space.md</code> explains publishing and supported host capabilities.
        Explicit example starters remain available through <code>--template</code>.
      </p>
      <div className="creation-steps">
        <article>
          <h2>macOS</h2>
          <p>
            Apple Silicon and modern Intel (AVX2) builds. Git comes with Apple Command Line Tools:
            run <code>xcode-select --install</code> if it is missing. Creator credentials use your
            login Keychain.
          </p>
        </article>
        <article>
          <h2>Linux</h2>
          <p>
            Use an ARM64 or x86-64 (SSE4.2) glibc desktop distribution, such as Ubuntu 24.04, with
            Git and an unlocked Secret Service keyring. Headless servers need a D-Bus/keyring
            session for creator identity. Chromium also needs system browser libraries.
          </p>
        </article>
        <article>
          <h2>Need a hand?</h2>
          <p>
            Run <code>napplet-space doctor</code> for Git and browser diagnostics. Run{' '}
            <code>napplet-space account check</code> to verify your signer. Alpine/musl and native
            Windows packages are not supported yet.
          </p>
        </article>
      </div>
      <p className="command-note">
        On Ubuntu 24.04, Chromium’s system libraries can be installed with{' '}
        <code>
          sudo apt-get install libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64
          libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1
          libasound2t64
        </code>
        . The CLI never runs sudo for you.
      </p>
      <h2>Downloads · {release.version}</h2>
      <p className="command-note">
        Extract the whole archive, including its lib folder. Keep them together. These downloads
        include the Bun runtime.
      </p>
      <ul>
        {(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'] as const).map((platform) => (
          <li key={platform}>
            <a href={`/cli/download/${release.version}/napplet-space-${platform}.tar.gz`}>
              {platform.replace('darwin', 'macOS')}
            </a>
            {' · '}
            <a href={`/cli/download/${release.version}/napplet-space-${platform}.tar.gz.sha256`}>
              SHA-256
            </a>
          </li>
        ))}
      </ul>
      <p className="command-note">
        <a href="/install.sh">Inspect the installer</a> · <a href="/create">Choose a starter</a>
      </p>
    </section>
  );
}
