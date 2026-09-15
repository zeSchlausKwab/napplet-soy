type Kind = 'napplet' | 'media' | 'preview';
/** Shared by every shell surface; automatic decorative previews cannot interrupt explicit play. */
export class PlaybackCoordinator {
  private active?: { owner: object; kind: Kind; stop: () => void };
  claim(owner: object, kind: Kind, stop: () => void) {
    if (this.active?.owner === owner) return true;
    if (kind === 'preview' && this.active && this.active.kind !== 'preview') return false;
    const previous = this.active;
    this.active = { owner, kind, stop };
    previous?.stop();
    return true;
  }
  release(owner: object) {
    if (this.active?.owner === owner) this.active = undefined;
  }
}
export const playback = new PlaybackCoordinator();
