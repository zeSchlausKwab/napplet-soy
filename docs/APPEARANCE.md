# Appearance

The website and `soyli dev` workshop have one appearance button. It cycles **Light →
Dark → Auto → Light**; its sun, moon or monitor shows the selected preference.
Auto is the initial setting and follows the operating system. The button is available
without signing in, with a keyboard label naming the current mode and the next choice.

The selection is stored in this browser under `napplet.soy.appearance.v1`. Tabs on
the same origin update together. If storage is blocked, the choice works for the
current page. Local preview ports and the public website are separate origins;
they do not share browser preferences. An inline head script resolves appearance
before the page's CSS and hydration, and sets native controls' color scheme.

Light mode uses warm cream, sage sections, dark ink and a deep green header. Dark
mode uses forest surfaces and warm light text. Muted text, borders, inputs, menus,
dialogs, social actions, source views and player chrome use semantic color tokens.
Coral likes, gold zaps, mint comments and blue sharing have colored hover/focus
feedback. Disabled, busy and failed actions retain their distinct states. Reduced
motion removes the decorative lift and transition. The appearance target is 44px.

The landing page adds a coral headline, blue/coral/mint soyLI benefit panels and
gold featured accents. Its starter terminal plays a brief light sweep and caret
animation on entry, finishing within three seconds. The real command remains
visible, selectable and copyable throughout; it is not simulated typing.

Create, zap, remix, source, share and surprise actions have an opt-in colored
hover/focus lift, glint and short icon animation. Pointer hover is limited to
fine pointers, keyboard focus gets equivalent feedback, and touch presses retain
color feedback. Reduced motion disables the new decorative animations and lift.
Disabled, busy and failed actions do not receive these effects. Motion is CSS-only;
it does not change navigation, signing, payment or publishing behavior.

Creator images, videos, promotional artwork, QR codes and game contents are never
inverted. Terminal/code panels retain their own readable dark palette. Appearance
is not an account setting, project configuration change or reason to restart a player.

## Napplet integration

Both website playback and the local workshop use the same NAP-THEME source:

```ts
const apply = (theme) => {
  document.body.style.background = theme.colors.background;
  document.body.style.color = theme.colors.text;
  document.documentElement.style.setProperty('--primary', theme.colors.primary);
};
apply(await window.napplet.theme.get());
const subscription = window.napplet.theme.onChanged(apply);
// When the napplet no longer needs updates:
subscription.close();
```

`theme.get` returns the current snapshot. A resolved color change emits
`{ type: 'theme.changed', theme }` without an ID, following the
[pinned NAP-THEME contract](https://github.com/napplet/naps/blob/a040914b4bbd3a5cd8a14b0f316a723c968ebfb2/naps/NAP-THEME.md).
Changing Auto to an explicit mode with the same colors does not emit a duplicate.
Notifications start after `shell.ready`, survive signing-account changes and stop
when the player closes. They never recreate the frame or reset game/config state.
The host supplies three hex colors and the title `napplet.soy`; font/media theme
properties are optional and are not supplied. A napplet can retain its own art direction.

## Verification

After `bun run build`, run `bun test tests/services/appearance.test.ts` and
`bun test packages/runtime/src/host.test.ts`. Browser checks cover OS changes,
manual overrides, reload, a second tab, blocked storage, pre-hydration appearance,
portal surfaces, keyboard focus, reduced motion, 320/390px layouts, live website gameplay continuity, and the real
pinned shim's get/onChanged/unsubscribe in local preview with preserved score and
settings. Core text/accent color pairs are measured at 4.5:1 or higher in both
palettes. Screenshots are local outputs under `.local/appearance/`.
The checks also exercise terminal copying/expansion, finite animation, reduced
motion, the remix dialog, source destination and the main action hover states.

These checks exercise desktop Chromium with mobile viewports. They do not claim
physical-phone, Safari or Firefox qualification, or that a third-party napplet
will adopt the supplied colors.
