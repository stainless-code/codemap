WITH params(symbol, replacement_message, in_file) AS (
  SELECT ?, ?, ?
),
deprecated_symbols AS (
  SELECT
    s.id,
    s.name,
    s.file_path,
    s.line_start,
    s.doc_comment,
    CASE
      WHEN instr(s.doc_comment, char(10)) > 0 THEN
        substr(s.doc_comment, 1, instr(s.doc_comment, char(10)) - 1)
      ELSE
        s.doc_comment
    END AS first_doc_line,
    (
      LENGTH(s.doc_comment) - LENGTH(REPLACE(s.doc_comment, char(10), ''))
    ) AS doc_line_count,
    (
      LENGTH(
        CASE
          WHEN instr(s.doc_comment, '@deprecated') > 0 THEN
            substr(s.doc_comment, 1, instr(s.doc_comment, '@deprecated') - 1)
          ELSE
            ''
        END
      ) - LENGTH(
        REPLACE(
          CASE
            WHEN instr(s.doc_comment, '@deprecated') > 0 THEN
              substr(s.doc_comment, 1, instr(s.doc_comment, '@deprecated') - 1)
            ELSE
              ''
          END,
          char(10),
          ''
        )
      )
    ) AS deprecated_doc_line_index
  FROM symbols s
  CROSS JOIN params p
  WHERE s.name = p.symbol
    AND s.doc_comment LIKE '%@deprecated%'
    AND (p.in_file IS NULL OR s.file_path LIKE p.in_file || '%')
),
doc_rows AS (
  SELECT
    d.file_path,
    (d.line_start - (2 + d.doc_line_count - d.deprecated_doc_line_index)) AS line_start,
    (d.line_start - (2 + d.doc_line_count - d.deprecated_doc_line_index)) AS line_end,
    (' * ' || d.first_doc_line) AS before_pattern,
    (' * @deprecated ' || p.replacement_message) AS after_pattern,
    'deprecated_jsdoc' AS location_kind,
    0 AS chain_depth
  FROM deprecated_symbols d
  CROSS JOIN params p
  WHERE d.first_doc_line LIKE '%@deprecated%'
)
SELECT *
FROM doc_rows
ORDER BY file_path, line_start;
