COPY customers FROM 'duckdb-export-parquet/customers.parquet' (FORMAT 'parquet');
COPY products FROM 'duckdb-export-parquet/products.parquet' (FORMAT 'parquet');
COPY tags FROM 'duckdb-export-parquet/tags.parquet' (FORMAT 'parquet');
COPY "weird name" FROM 'duckdb-export-parquet/weird_name.parquet' (FORMAT 'parquet');
COPY orders FROM 'duckdb-export-parquet/orders.parquet' (FORMAT 'parquet');
COPY order_items FROM 'duckdb-export-parquet/order_items.parquet' (FORMAT 'parquet');
COPY product_tags FROM 'duckdb-export-parquet/product_tags.parquet' (FORMAT 'parquet');
COPY shipments FROM 'duckdb-export-parquet/shipments.parquet' (FORMAT 'parquet');
