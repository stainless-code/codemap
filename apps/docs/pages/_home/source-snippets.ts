export interface CliSnippet {
  id: string;
  lang: string;
  code: string;
}

/** Single hero CLI example — no live demo islands. */
export const cliSnippet: CliSnippet = {
  id: "find-symbol-definitions",
  lang: "bash",
  code: "codemap query --recipe find-symbol-definitions --params name=createCodemap",
};
