import { Link } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';

const questions = [
  {
    id: 'how-it-works',
    question: 'How does this work?',
    answer: (
      <p>
        A napplet is a small web creation with a signed Nostr listing. Relays help clients discover
        it, Blossom hosts its files, and this client verifies and runs it in a sandbox. soyLI turns
        a local project into that publication and shares its Git source. Compatible clients can
        discover the same napplet; it belongs to its creator’s key, not a website login.
      </p>
    ),
  },
  {
    id: 'account-needed',
    question: 'Do I need an account to create or contribute?',
    answer: (
      <p>
        No website account or sign-in is needed to create, remix or propose changes. soyLI can
        create a Nostr signing identity or connect one you already use. Browsing and playing also
        need no site login. Likes and comments require sign-in; sharing links and anonymous zaps do
        not.
      </p>
    ),
  },
  {
    id: 'change-identity',
    question: 'How do I change identities?',
    answer: (
      <>
        <p>
          In soyLI, run <code>soyli account list</code>, then{' '}
          <code>soyli account use YOUR_ACCOUNT_ID</code> with the account ID or npub you want.
          Existing projects keep their creator binding, so switch back to that creator when
          publishing them.
        </p>
        <p>
          On the website, open the identity button and select a saved identity or connect another.
          Website and CLI selections are separate.{' '}
          <Link to="/docs" hash="identities">
            Identity commands and backups
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    id: 'anonymous-napplets',
    question: 'Can I post anonymous napplets?',
    answer: (
      <>
        <p>
          You can publish under a separate pseudonym without providing a real name, email or
          profile. Every napplet still has a public signing key, and publications under that key can
          be linked together. Publishing is pseudonymous, not a guarantee of anonymity.
        </p>
        <p>
          Public source, Git authorship and commit history can reveal identifying information;
          infrastructure providers can also see connection information. A fresh key alone does not
          remove those links. The{' '}
          <Link to="/docs" hash="identities">
            identity guide
          </Link>{' '}
          explains creating another key and the release status of <code>account create --new</code>.
        </p>
      </>
    ),
  },
  {
    id: 'reused-key',
    question: 'Why did account create return the same key?',
    answer: (
      <p>
        It reuses your selected identity so repeat setup does not replace it.{' '}
        <code>account backup</code> saves or locates that same key’s backup. A different identity
        needs explicit creation with <code>account create --new</code>; previous identities and
        backups are retained. This option currently awaits a packaged CLI release. See the{' '}
        <Link to="/docs" hash="identities">
          source-checkout instructions
        </Link>{' '}
        to use it now.
      </p>
    ),
  },
  {
    id: 'private-key',
    question: 'Where is my private key, and how do I back it up?',
    answer: (
      <p>
        soyLI signs with your OS credential store and saves an owner-only, unencrypted nsec backup
        outside your project. <code>soyli account backup</code> prints its location; encrypted
        exports are also available. On the website, key creation includes an encrypted recovery
        download. Remote signers keep the creator key themselves. Preserve a private backup: this
        site cannot recover a lost key for you.{' '}
        <Link to="/docs" hash="identities">
          Backup and restore instructions
        </Link>
        .
      </p>
    ),
  },
  {
    id: 'tools-needed',
    question: 'Do I need Bun, Node or a particular AI tool?',
    answer: (
      <p>
        No global Bun or Node installation is needed. The macOS and Linux soyLI downloads include
        their runtime and prepare the project toolchain. You need Git and a supported system
        credential store to publish. Use any editor or coding agent you prefer; new projects include
        Napplet skills and guidance. An AI subscription is not included or required.{' '}
        <Link to="/create" hash="platforms">
          Setup requirements
        </Link>
        .
      </p>
    ),
  },
  {
    id: 'public-code',
    question: 'Is my code public?',
    answer: (
      <p>
        Yes, when you share it through soyLI. Publishing or proposing shares source and pushed Git
        history, including earlier versions of files. Editing and making local checkpoints do not
        upload anything. New projects use MIT; check and preserve the existing license when
        remixing. Keep credentials and private notes out of the repository.{' '}
        <Link to="/docs" hash="workflow">
          The edit-to-publish workflow
        </Link>
        .
      </p>
    ),
  },
  {
    id: 'remix-or-contribute',
    question: 'What is the difference between a remix and a proposal?',
    answer: (
      <p>
        A remix gives you a local copy to work on. From the same copy, publish an independent
        napplet or propose improvements to the original author, or do both. A proposal includes
        source changes and a playable preview; the author decides whether to merge and release it.
        Proposals require a Git-backed original.{' '}
        <Link to="/docs" hash="collaboration">
          Remix and contribution commands
        </Link>
        .
      </p>
    ),
  },
  {
    id: 'own-infrastructure',
    question: 'Can I use my own relay or file server?',
    answer: (
      <p>
        Yes. <code>soyli config</code> shows publishing destinations, and{' '}
        <code>soyli config init</code> makes editable local overrides. Choose compatible Nostr,
        Blossom and GRASP services. The website’s Network settings control your browsing providers
        separately.{' '}
        <Link to="/docs" hash="destinations">
          See the defaults and how to change them
        </Link>
        .
      </p>
    ),
  },
  {
    id: 'readable-link',
    question: 'How do I get a readable link or share the fullscreen player?',
    answer: (
      <p>
        Open your napplet page, connect the creator identity and choose Named link to claim{' '}
        <code>/@your-handle/your-slug</code>. It follows future releases. The Share control also
        offers a player link that opens directly in the immersive view. Portable Nostr addresses
        continue to work without a named route.
      </p>
    ),
  },
  {
    id: 'remove-content',
    question: 'Can a napplet be removed everywhere?',
    answer: (
      <p>
        This site’s administrators can hide content here. That does not erase copies held by other
        clients, relays or file servers. Published code and files can be copied and remixed, so
        there is no universal undo for a public release.
      </p>
    ),
  },
];

export function AboutFaq() {
  return (
    <section id="faq" className="about-section" aria-labelledby="about-faq">
      <div className="about-section-heading">
        <span className="eyebrow">04 / A FEW GOOD QUESTIONS</span>
        <h2 id="about-faq">Before you make something.</h2>
      </div>
      <div className="about-faq-layout">
        <div className="about-faq-intro">
          <p>Keys, code, credit. Here’s how the pieces fit together.</p>
          <Link to="/docs">Open the soyLI field guide →</Link>
        </div>
        <div className="about-faq-list">
          {questions.map(({ id, question, answer }) => (
            <details key={id} id={`faq-${id}`}>
              <summary>
                {question}
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <div>{answer}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
