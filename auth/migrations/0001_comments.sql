-- Run once in the lemoncat-comments D1 console. Safe to run again.
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  article_slug TEXT NOT NULL,
  author_id TEXT NOT NULL CHECK(author_id GLOB 'github:[0-9]*'),
  author_login TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 2000),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
);
CREATE INDEX IF NOT EXISTS comments_article_order ON comments(article_slug,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS comments_author_recent ON comments(author_id,created_at DESC);
CREATE TABLE IF NOT EXISTS comment_rate_limits (
  author_id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  last_post_at INTEGER NOT NULL
);
