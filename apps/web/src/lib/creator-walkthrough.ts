export const walkthrough = {
  seconds: 30,
  video: '/walkthrough/creator.mp4',
  poster: '/walkthrough/creator.webp',
  captions: '/walkthrough/creator.en.vtt',
  scenes: [
    {
      title: 'Install',
      caption: 'Create, remix and publish without a website account.',
      detail:
        'Paste the starter command into a terminal. The CLI prepares a project with Napplet skills. Follow its PATH instruction if shown. macOS or Linux and Git are required; no Bun or Node installation is needed.',
    },
    {
      title: 'Vibe code',
      caption: 'Open the folder in your coding tool. Run napplet-space dev.',
      detail:
        'Open my-napplet in the AI coding tool you already use. Run napplet-space dev inside that folder, make changes and try the sandbox preview.',
    },
    {
      title: 'Publish',
      caption: 'Build, review your posting, then publish with your Nostr identity.',
      detail:
        'Run napplet-space build. Review the title, description, screenshot and publishing destinations in the posting preview. Run napplet-space publish. The CLI can create or connect a Nostr signing identity; no website sign-in is needed.',
    },
    {
      title: 'Play',
      caption: 'Open your share link. Play it. Pass it around.',
      detail:
        'Open the link returned by the CLI and play your napplet in the browser. Share it so other people can explore it and inspect the source.',
    },
    {
      title: 'Remix',
      caption: 'Choose Remix this. Copy the install-and-remix command. Make it yours.',
      detail:
        'On a napplet page, choose Remix this and paste its install-and-remix command into your terminal. It also works without an installed CLI. Open the new folder in your coding tool and follow your idea.',
    },
  ],
} as const;
