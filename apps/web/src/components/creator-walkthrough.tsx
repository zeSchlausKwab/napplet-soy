import { walkthrough } from '@/lib/creator-walkthrough';

export function WalkthroughVideo({ autoPlay = false }: { autoPlay?: boolean }) {
  return (
    <div className="creator-walkthrough">
      <video
        controls
        muted
        playsInline
        autoPlay={autoPlay}
        preload="none"
        width={1280}
        height={800}
        poster={walkthrough.poster}
        aria-label="From idea to remix: a 30-second creator walkthrough"
      >
        <source src={walkthrough.video} type="video/mp4" />
        <track kind="captions" src={walkthrough.captions} srcLang="en" label="English" default />
        <a href={walkthrough.video}>Download the walkthrough</a>
      </video>
      <ol className="walkthrough-steps" aria-label="Create with napplet soyLI">
        {walkthrough.scenes.map(({ title, detail }) => (
          <li key={title}>
            <strong>{title}</strong>
            <span>{detail}</span>
          </li>
        ))}
      </ol>
      <p className="walkthrough-note">Your tools, your pace. No website account needed.</p>
    </div>
  );
}
