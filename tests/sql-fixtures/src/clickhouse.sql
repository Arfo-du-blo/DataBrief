-- Source database for ClickHouse ("shop"). ClickHouse has no foreign keys; the names still correspond.
CREATE DATABASE shop;
CREATE TABLE shop.customers (
  id UInt32, email String, name String, country FixedString(2), created_at DateTime, notes Nullable(String)
) ENGINE = MergeTree ORDER BY id COMMENT 'People who bought something';
CREATE TABLE shop.orders (
  id UInt32, customer_id UInt32, ordered_at DateTime, status Enum8('paid' = 1, 'shipped' = 2, 'cancelled' = 3), total Decimal(10, 2)
) ENGINE = MergeTree ORDER BY id;
CREATE TABLE shop.order_items (
  order_id UInt32, line_no UInt32, product_id UInt32, quantity UInt32, labels Array(String)
) ENGINE = MergeTree ORDER BY (order_id, line_no);
INSERT INTO shop.customers VALUES
 (1, 'ana.secret@example.com', 'Ana García', 'ES', '2024-01-15 09:30:00', 'CONFIDENTIAL_NOTE_123'),
 (2, 'bob@example.com', 'Bob O\'Brien', 'IE', '2024-02-01 18:45:10', 'Line one\nline two; with semicolon -- not a comment'),
 (3, 'zoe@example.com', 'Zoë 😀', 'FR', '2024-03-10 00:00:00', NULL),
 (4, 'dan@example.com', 'Dan "The Man" Smith', 'US', '2024-03-11 12:00:00', 'back\\slash path C:\\temp'),
 (6, 'confidential_segment_x@example.com', 'CONFIDENTIAL_CUSTOMER_74291', 'GB', '2024-04-02 08:00:00', 'CONFIDENTIAL_SEGMENT_X');
INSERT INTO shop.orders VALUES (1, 1, '2024-05-01 10:00:00', 'paid', 25.00), (2, 1, '2024-05-03 11:30:00', 'shipped', 8.00), (5, 6, '2024-05-06 13:00:00', 'paid', 12.50);
INSERT INTO shop.order_items VALUES (1, 1, 1, 2, ['organic', 'coffee']), (1, 2, 2, 1, []), (5, 1, 1, 1, ['gift']);
