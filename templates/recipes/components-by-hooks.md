React components with the most hooks (comma count on stored JSON array)

Hook count uses comma tally + 1 on the stored JSON array (Codemap emits flat `["useFoo","useBar"]` shapes). Avoids SQLite JSON1 (`json_array_length`) so the recipe runs on any SQLite build the CLI already supports.
