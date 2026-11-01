COPY customers FROM 'duckdb-export-csv/customers.csv' (FORMAT 'csv', force_not_null ('email', 'name', 'created_at', 'id'), quote '"', delimiter ',', header 1);
COPY products FROM 'duckdb-export-csv/products.csv' (FORMAT 'csv', force_not_null ('sku', 'title', 'id'), quote '"', delimiter ',', header 1);
COPY tags FROM 'duckdb-export-csv/tags.csv' (FORMAT 'csv', force_not_null ('label', 'id'), quote '"', delimiter ',', header 1);
COPY "weird name" FROM 'duckdb-export-csv/weird_name.csv' (FORMAT 'csv', force_not_null 'id', quote '"', delimiter ',', header 1);
COPY orders FROM 'duckdb-export-csv/orders.csv' (FORMAT 'csv', force_not_null ('customer_id', 'ordered_at', 'status', 'total', 'id'), quote '"', delimiter ',', header 1);
COPY order_items FROM 'duckdb-export-csv/order_items.csv' (FORMAT 'csv', force_not_null ('order_id', 'line_no', 'product_id', 'quantity'), quote '"', delimiter ',', header 1);
COPY product_tags FROM 'duckdb-export-csv/product_tags.csv' (FORMAT 'csv', force_not_null ('product_id', 'tag_id'), quote '"', delimiter ',', header 1);
COPY shipments FROM 'duckdb-export-csv/shipments.csv' (FORMAT 'csv', force_not_null ('order_id', 'line_no', 'id'), quote '"', delimiter ',', header 1);
