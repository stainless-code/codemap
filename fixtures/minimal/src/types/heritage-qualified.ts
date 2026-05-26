import type { Animal } from "./hierarchy";

export interface ImportedMammal extends Animal {
  imported: true;
}

namespace pkg {
  export interface QualifiedBase {
    q: boolean;
  }
}

export interface QualifiedChild extends pkg.QualifiedBase {}
