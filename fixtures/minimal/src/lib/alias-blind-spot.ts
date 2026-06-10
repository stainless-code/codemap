// Unresolved path alias — resolver leaves `imports.resolved_path IS NULL`.
// Exercises `unimported-exports` `reason=unresolved_import_blind_spot` on `orphanHelper`.
import { orphanHelper } from "@codemap-fixture/unresolved-orphan";

void orphanHelper;
