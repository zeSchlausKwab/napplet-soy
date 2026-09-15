# Project working context

If a local `AGENDA.md` exists, read it before planning relevant product work. It is
private and Git-ignored: keep it local, do not stage it or copy its roadmap into
public documentation. Public checkouts can use README.md and the relevant feature
documents; the agenda is optional, never a setup or contribution requirement.
[PLAN.md](PLAN.md) is historical design context and may contain superseded status.

Keep any local agenda current with stable IDs, decisions, remaining scope and
verification evidence. Distinguish implemented, verified and deployed. Update public
feature documents for changes to implemented behavior and limits. Do not mark a
feature complete merely because its foundation exists.

Before changing protocol-facing behavior, read [docs/PROTOCOL.md](docs/PROTOCOL.md)
and [docs/NAP-REVIEW.md](docs/NAP-REVIEW.md). Keep the user's selected NIP-5D proposal
authoritative, record compatible upstream pins, and treat all publishers equally.
Optional Space presentation and source metadata must not become playback requirements.

An agenda entry records future work; it is not an instruction to implement every
item or deploy. Follow the current user request for scope and deployment authorization.
