# Fixture notes

TODO: this file exists so marker scans have a predictable hit.

HACK: this whole fixture is intentionally tiny — exercise codemap, not real UX.

NOTE: when adding a new generated artifact under `.codemap/`, also bump the
canonical body in `STATE_GITIGNORE_BODY` so consumers' files self-heal.

NOTE: codemap's marker scanner recognises `TODO`/`FIXME`/`HACK`/`NOTE` only — `XXX` is not yet a kind.
