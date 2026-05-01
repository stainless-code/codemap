All indexed files with content_hash (input for staleness checks)

Powers the `codemap validate` CLI: callers diff this list against on-disk content to detect stale entries without paying to re-read every file.
