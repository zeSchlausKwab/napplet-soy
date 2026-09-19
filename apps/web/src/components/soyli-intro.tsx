import { BookOpen, Film, ShieldCheck } from 'lucide-react';

/** Shared spelling, pronunciation and supplied artwork across creator entry points. */
export function SoyliIdentity({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`soyli-identity${compact ? ' soyli-identity-compact' : ''}`}>
      <img
        className="soyli-mascot"
        src="/brand/soy-mascot.png"
        width={1254}
        height={1254}
        alt="soyLI’s smiling tofu mascot"
        decoding="async"
      />
      <div className="soyli-dictionary">
        <div className="soyli-name-line">
          <strong className="soyli-wordmark">
            soy<span>LI</span>
          </strong>
          <span className="soyli-ipa" aria-label="Pronounced soy, el, eye">
            /ˌsɔɪ.ɛlˈaɪ/
          </span>
        </div>
        <span className="soyli-say">
          say “soy–el–eye” <span>· a play on CLI</span>
        </span>
        <span className="soyli-definition">The command line for the agentic age.</span>
      </div>
    </div>
  );
}

export function SoyliBenefits() {
  return (
    <ul className="soyli-benefits" aria-label="What soyLI does">
      <li>
        <BookOpen size={18} aria-hidden="true" />
        <div>
          <h3>Context for your agent</h3>
          <p>
            A working project, skills and protocol guidance. Simple commands, with the context
            built in.
          </p>
        </div>
      </li>
      <li>
        <Film size={18} aria-hidden="true" />
        <div>
          <h3>Covers & preview clips</h3>
          <p>
            Tools for your agent to capture images, record video previews and check the listing.
            Less time on the fiddly bits.
          </p>
        </div>
      </li>
      <li>
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <h3>Checks before publishing</h3>
          <p>
            Validate metadata, files and supported capabilities, then test startup in the host.
            Conformance checks are included too.
          </p>
        </div>
      </li>
    </ul>
  );
}
