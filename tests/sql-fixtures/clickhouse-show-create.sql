CREATE TABLE shop.customers
(
    `id` UInt32,
    `email` String,
    `name` String,
    `country` FixedString(2),
    `created_at` DateTime,
    `notes` Nullable(String)
)
ENGINE = MergeTree
ORDER BY id
SETTINGS index_granularity = 8192
COMMENT 'People who bought something'
;
CREATE TABLE shop.orders
(
    `id` UInt32,
    `customer_id` UInt32,
    `ordered_at` DateTime,
    `status` Enum8('paid' = 1, 'shipped' = 2, 'cancelled' = 3),
    `total` Decimal(10, 2)
)
ENGINE = MergeTree
ORDER BY id
SETTINGS index_granularity = 8192
;
CREATE TABLE shop.order_items
(
    `order_id` UInt32,
    `line_no` UInt32,
    `product_id` UInt32,
    `quantity` UInt32,
    `labels` Array(String)
)
ENGINE = MergeTree
ORDER BY (order_id, line_no)
SETTINGS index_granularity = 8192
;
