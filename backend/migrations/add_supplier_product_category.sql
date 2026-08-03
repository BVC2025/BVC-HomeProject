-- Migration: add CATEGORY_ID to supplier_product
-- Run once against the live database before restarting the server.
-- Safe to re-run: IF NOT EXISTS guard prevents duplicate-column errors.

ALTER TABLE supplier_product
  ADD COLUMN IF NOT EXISTS CATEGORY_ID VARCHAR(36) NULL,
  ADD INDEX ix_sup_prod_category_id (CATEGORY_ID);

-- Foreign key (add separately so the index above exists first)
ALTER TABLE supplier_product
  ADD CONSTRAINT fk_sup_prod_category
    FOREIGN KEY (CATEGORY_ID)
    REFERENCES inventory_category (ID)
    ON DELETE SET NULL
    ON UPDATE CASCADE;
