-- ============================================================
-- BVC ERP — local database bootstrap
-- ============================================================
-- Creates the database + user that backend/.env expects.
-- Idempotent — safe to re-run.
--
-- Usage (Windows PowerShell, from the backend directory):
--
--   mysql -u root -p < scripts\create_local_db.sql
--
-- Enter your MySQL root password when prompted. When it exits
-- silently, you're done.
-- ============================================================

CREATE DATABASE IF NOT EXISTS vending_erp
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- Drop the user first so we can idempotently reset the password
-- even if it already exists with a different one.
DROP USER IF EXISTS 'erpdbuser'@'localhost';

CREATE USER 'erpdbuser'@'localhost'
  IDENTIFIED BY 'Erp@123';

GRANT ALL PRIVILEGES ON vending_erp.* TO 'erpdbuser'@'localhost';

FLUSH PRIVILEGES;

-- Sanity check — should print one row
SELECT
  User    AS user,
  Host    AS host,
  plugin  AS auth_plugin
FROM mysql.user
WHERE User = 'erpdbuser';
