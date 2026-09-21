import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { network, saveNetwork } from '@/lib/network';
import { Button } from '@/components/ui/button';
import { MultiplayerSettings } from '../../../../packages/runtime/src/multiplayer-settings';
import { siteHead } from '@/lib/site-head';
export const Route = createFileRoute('/network')({
  head: ({ match }) =>
    siteHead(
      match.context.clientPolicy.siteOrigin,
      '/network',
      'Your connections — napplet.soy',
      'Choose the Nostr relays, Blossom storage and multiplayer connections used by this browser.',
    ),
  component: Network,
});
function Network() {
  const [relays, setRelays] = useState(''),
    [blossom, setBlossom] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    const n = network();
    setRelays(n.relays.join('\n'));
    setBlossom(n.blossom.join('\n'));
  }, []);
  const lines = (s: string) =>
    s
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  return (
    <section className="create-page">
      <span className="eyebrow">YOUR CONNECTIONS</span>
      <h1>Choose your infrastructure.</h1>
      <p>
        This browser reads and publishes Nostr events directly to these relays. Files load from
        their published Blossom locations; your servers are fallbacks. These settings stay on this
        device.
      </p>
      <form
        className="community-form"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            saveNetwork({ relays: lines(relays), blossom: lines(blossom) });
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <label>
          Nostr relays · one URL per line
          <textarea
            aria-label="Nostr relays"
            rows={5}
            value={relays}
            onChange={(e) => setRelays(e.target.value)}
            spellCheck={false}
          />
        </label>
        <label>
          Blossom servers · one URL per line
          <textarea
            aria-label="Blossom servers"
            rows={4}
            value={blossom}
            onChange={(e) => setBlossom(e.target.value)}
            spellCheck={false}
          />
        </label>
        <p>
          Use WSS and HTTPS on the live web. Storage and Lightning providers must allow browser
          requests (CORS). Site names, featured selections and moderation belong to napplet.soy.
        </p>
        <div className="social-actions">
          <Button type="submit">Save and reload</Button>
          <Button type="button" variant="outline" onClick={() => saveNetwork(null)}>
            Use site defaults
          </Button>
        </div>
        {error && <p role="alert">{error}</p>}
      </form>
      <MultiplayerSettings />
    </section>
  );
}
