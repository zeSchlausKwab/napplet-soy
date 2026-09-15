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
        'Paste the command above. napplet soyLI sets up your project and coding skills.',
    },
    {
      title: 'Vibe code',
      caption: 'Open the folder in your coding tool. Run soyli dev.',
      detail:
        'Open the folder in your coding tool. Run soyli dev and try your ideas.',
    },
    {
      title: 'Publish',
      caption: 'Build, review your posting, then publish with your Nostr identity.',
      detail:
        'Run soyli build. Check your posting preview, then soyli publish. The CLI creates or connects your Nostr identity.',
    },
    {
      title: 'Play',
      caption: 'Open your share link. Play it. Pass it around.',
      detail:
        'Open your share link, play it and pass it around.',
    },
    {
      title: 'Remix',
      caption: 'Choose Remix this. Copy the install-and-remix command. Make it yours.',
      detail:
        'Choose “Remix this” on a napplet. Paste its command and make it yours.',
    },
  ],
} as const;
