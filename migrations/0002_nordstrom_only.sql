UPDATE sources
SET enabled = CASE WHEN id = 'nordstrom-smudge-monkey' THEN 1 ELSE 0 END,
    poll_interval_seconds = CASE
      WHEN id = 'nordstrom-smudge-monkey' THEN 900
      ELSE poll_interval_seconds
    END,
    next_poll_at = CASE
      WHEN id = 'nordstrom-smudge-monkey' THEN 0
      ELSE next_poll_at
    END,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000;
