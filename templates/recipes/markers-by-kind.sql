SELECT kind, COUNT(*) AS count
FROM markers
GROUP BY kind
ORDER BY count DESC, kind ASC
