-- The day's pages are summed over every day's 'reads' counter. Without this the sum walked
-- the whole table, which also holds one line for each minute Search was asked in.
CREATE INDEX limits_by_name ON limits (name, day);
